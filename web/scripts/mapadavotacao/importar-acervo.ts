/**
 * Prepara os dados do Mapa da Votação a partir do acervo no GCS, no contrato "eleicoes-presidente" (v2).
 *
 *   origem:  gs://dbi-app-br-arquivos/orgs/mapa-da-votacao/acervo/dados_eleicoes/   (só leitura)
 *   saída:   <pasta de trabalho>/saida/<grupo>/{f_votacao,d_municipio,d_candidato}.parquet
 *
 * O acervo tem votos por SEÇÃO; aqui eles são somados por município, cargo, ano, turno e candidato.
 * Um grupo de cargos por dashboard, para cada um carregar só o que usa:
 *   presidente · governador-senador · deputados · prefeito-vereador
 *
 * Aptos e abstenção: perfil_comparecimento_abstencao (2016–2024, por município e zona); 2026 vem do
 * pacote da Fase 1 (sample-data/eleicoes-presidente, mesmo TSE); 2010 e 2014 não têm fonte e ficam
 * sem linha de abstenção (as medidas mostram "—", nunca 0%).
 *
 * Processa um arquivo por vez e guarda cada parcial: rodar de novo retoma de onde parou.
 *
 * Uso: npm run mapadavotacao:importar -- <pasta de trabalho>
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { Storage, type Bucket } from "@google-cloud/storage";

const BUCKET = "dbi-app-br-arquivos";
const ACERVO = "orgs/mapa-da-votacao/acervo/dados_eleicoes/";
const KEY_FILE = path.join(process.cwd(), "secrets", "gcs-key.json");
const PACOTE_2026 = path.join(process.cwd(), "sample-data", "eleicoes-presidente", "f_votacao.parquet");
const WORK = path.resolve(process.argv[2] ?? path.join(process.cwd(), "sample-data", "acervo-trabalho"));

/** Rótulo do cargo a partir do trecho do nome do arquivo. */
const CARGOS: Record<string, string> = {
  presidente: "PRESIDENTE",
  governador: "GOVERNADOR",
  senador: "SENADOR",
  deputado_federal: "DEPUTADO FEDERAL",
  deputado_estadual: "DEPUTADO ESTADUAL",
  deputado_distrital: "DEPUTADO DISTRITAL",
  prefeito: "PREFEITO",
  vereador: "VEREADOR",
};

const GRUPOS: Record<string, readonly string[]> = {
  presidente: ["PRESIDENTE"],
  "governador-senador": ["GOVERNADOR", "SENADOR"],
  deputados: ["DEPUTADO FEDERAL", "DEPUTADO ESTADUAL", "DEPUTADO DISTRITAL"],
  "prefeito-vereador": ["PREFEITO", "VEREADOR"],
};

const grupoDoCargo = (cargo: string): string => {
  const g = Object.entries(GRUPOS).find(([, cs]) => cs.includes(cargo));
  if (!g) throw new Error(`cargo sem grupo: ${cargo}`);
  return g[0];
};

const VOTACAO = /^vw_f_votacao_secao_uf_([a-z]{2})_([a-z_]+?)_(\d{4})_t([12])\.parquet$/;
const PERFIL = /^perfil_comparecimento_abstencao_(\d{4})_[a-z]{2}\.parquet$/;
const CANDIDATOS = /^dim_candidatos_[a-z]{2}\.parquet$/;

interface Arquivo { key: string; parte: string }

const q = (p: string): string => `'${p.replace(/\\/g, "/").replace(/'/g, "''")}'`;

async function listar(bucket: Bucket, prefix: string): Promise<{ pastas: string[]; arquivos: string[] }> {
  const pastas: string[] = [];
  const arquivos: string[] = [];
  let pageToken: string | undefined;
  do {
    const [files, next, resp] = await bucket.getFiles({ prefix, delimiter: "/", autoPaginate: false, maxResults: 1000, pageToken });
    arquivos.push(...files.map((f) => f.name));
    pastas.push(...(((resp as { prefixes?: string[] } | undefined)?.prefixes) ?? []));
    pageToken = (next as { pageToken?: string } | null)?.pageToken;
  } while (pageToken);
  return { pastas, arquivos };
}

/** Separa o que importar: votos por grupo, perfis de comparecimento e cadastros de candidatos. */
async function inventario(bucket: Bucket): Promise<{ votos: Arquivo[]; perfis: Arquivo[]; candidatos: Arquivo[] }> {
  const votos: Arquivo[] = [];
  const perfis: Arquivo[] = [];
  const candidatos: Arquivo[] = [];
  const { pastas } = await listar(bucket, ACERVO);
  for (const pasta of pastas) {
    const uf = pasta.slice(ACERVO.length, -1);
    for (const key of (await listar(bucket, pasta)).arquivos) {
      const nome = key.slice(pasta.length);
      const v = VOTACAO.exec(nome);
      if (v) {
        const cargo = CARGOS[v[2]];
        if (!cargo) continue;
        // Presidente vem da pasta BR (o país inteiro por arquivo); nas UFs ele se repetiria.
        if ((cargo === "PRESIDENTE") !== (uf === "BR")) continue;
        votos.push({ key, parte: path.join("votos", grupoDoCargo(cargo), nome) });
        continue;
      }
      if (PERFIL.test(nome)) perfis.push({ key, parte: path.join("perfil", nome) });
      else if (CANDIDATOS.test(nome) || (uf === "BR" && nome === "dim_candidatos_br.parquet")) {
        candidatos.push({ key, parte: path.join("candidatos", `${uf}_${nome}`) });
      }
    }
  }
  return { votos, perfis, candidatos };
}

function cargoDoArquivo(nome: string): { cargo: string; ano: number; turno: number } {
  const v = VOTACAO.exec(path.basename(nome));
  if (!v) throw new Error(`nome inesperado: ${nome}`);
  return { cargo: CARGOS[v[2]], ano: Number(v[3]), turno: Number(v[4]) };
}

/** SQL que reduz cada tipo de arquivo à sua parcial (já somada, pequena). */
function sqlParcial(tipo: "votos" | "perfil" | "candidatos", origem: string, destino: string, nome: string): string {
  const src = `read_parquet(${q(origem)})`;
  if (tipo === "votos") {
    const { cargo, ano, turno } = cargoDoArquivo(nome);
    return `COPY (
      SELECT ${ano} AS ano, ${turno} AS turno, '${cargo}' AS cargo, sg_uf,
        TRY_CAST(split_part(chave_local, '|', 2) AS INTEGER) AS cd_municipio_tse,
        CASE
          WHEN regexp_matches(sq_candidato, '^[0-9]+$') THEN 'candidato'
          WHEN sq_candidato = '-3' THEN 'legenda'
          WHEN upper(nm_votavel) LIKE '%BRANCO%' THEN 'branco'
          WHEN upper(nm_votavel) LIKE '%NULO%' OR sq_candidato IS NOT NULL OR nm_votavel IS NULL THEN 'nulo'
          ELSE 'candidato' -- 2010 e 2014: sem sequencial, só o nome completo
        END AS categoria,
        CASE WHEN regexp_matches(sq_candidato, '^[0-9]+$') THEN '${ano}-' || sq_candidato END AS cd_candidato,
        CASE WHEN sq_candidato IS NULL THEN upper(trim(nm_votavel)) END AS nm_votavel,
        SUM(qt_votos)::BIGINT AS votos
      FROM ${src} GROUP BY ALL
    ) TO ${q(destino)} (FORMAT parquet, COMPRESSION zstd)`;
  }
  if (tipo === "perfil") {
    return `COPY (
      SELECT ANO_ELEICAO::INTEGER AS ano, NR_TURNO::INTEGER AS turno, SG_UF AS sg_uf,
        TRY_CAST(CD_MUNICIPIO AS INTEGER) AS cd_municipio_tse,
        SUM(QT_APTOS)::BIGINT AS aptos, SUM(QT_COMPARECIMENTO)::BIGINT AS comparecimento,
        SUM(QT_ABSTENCAO)::BIGINT AS abstencao
      FROM ${src} GROUP BY ALL
    ) TO ${q(destino)} (FORMAT parquet, COMPRESSION zstd)`;
  }
  return `COPY (
    SELECT TRY_CAST(ano_eleicao AS INTEGER) AS ano, upper(trim(ds_cargo)) AS cargo, sg_uf,
      split_part(chave_candidato, '|', 6) AS sq, nm_urna_candidato AS nome, nm_candidato AS nome_completo,
      sg_partido AS partido, CAST(nr_candidato AS VARCHAR) AS numero, ds_sit_tot_turno AS situacao,
      TRY_CAST(split_part(chave_candidato, '|', 2) AS INTEGER) AS turno
    FROM ${src} WHERE regexp_matches(split_part(chave_candidato, '|', 6), '^[0-9]+$')
  ) TO ${q(destino)} (FORMAT parquet, COMPRESSION zstd)`;
}

async function baixarParciais(conn: DuckDBConnection, bucket: Bucket, tipo: "votos" | "perfil" | "candidatos", arquivos: Arquivo[]): Promise<void> {
  const tmp = path.join(WORK, "tmp");
  await mkdir(tmp, { recursive: true });
  let feitos = 0;
  for (const a of arquivos) {
    const destino = path.join(WORK, "parciais", a.parte);
    feitos += 1;
    if (existsSync(destino)) continue; // retomada
    await mkdir(path.dirname(destino), { recursive: true });
    const local = path.join(tmp, path.basename(a.key));
    await bucket.file(a.key).download({ destination: local });
    try {
      await conn.run(sqlParcial(tipo, local, `${destino}.tmp`, a.key));
      await rm(destino, { force: true });
      await rename(`${destino}.tmp`, destino);
    } finally {
      await rm(local, { force: true });
    }
    if (feitos % 25 === 0 || feitos === arquivos.length) console.log(`  ${tipo}: ${feitos}/${arquivos.length}`);
  }
}

async function baixarDimensao(bucket: Bucket, nome: string): Promise<string> {
  const destino = path.join(WORK, "parciais", nome);
  if (!existsSync(destino)) {
    await mkdir(path.dirname(destino), { recursive: true });
    await bucket.file(ACERVO + nome).download({ destination: destino });
  }
  return destino;
}

/** Junta as parciais de um grupo no contrato final. */
async function montarGrupo(conn: DuckDBConnection, grupo: string, dimMunicipios: string, dimPartidos: string): Promise<void> {
  const parciais = path.join(WORK, "parciais");
  const pastaVotos = path.join(parciais, "votos", grupo);
  if (!existsSync(pastaVotos) || (await readdir(pastaVotos)).length === 0) {
    console.log(`  ${grupo}: sem arquivos de votos, pulando`);
    return;
  }
  const out = path.join(WORK, "saida", grupo);
  await mkdir(out, { recursive: true });
  const glob = (p: string): string => `${q(path.join(p, "*.parquet"))}, union_by_name = true`;
  const temPerfil = existsSync(path.join(parciais, "perfil"));
  const temPacote = existsSync(PACOTE_2026);

  await conn.run(`CREATE OR REPLACE TEMP TABLE mun AS
    SELECT sg_uf, TRY_CAST(cd_municipio_tse AS INTEGER) AS cd_municipio_tse, cd_municipio_ibge
    FROM read_parquet(${q(dimMunicipios)})`);
  // Candidato pelo nome completo, para os anos em que o arquivo de votos não traz o sequencial.
  await conn.run(`CREATE OR REPLACE TEMP TABLE cand_nome AS
    SELECT ano, cargo, upper(trim(nome_completo)) AS nm, min(ano || '-' || sq) AS cd_candidato
    FROM read_parquet(${glob(path.join(parciais, "candidatos"))}) WHERE nome_completo IS NOT NULL GROUP BY ALL`);
  // Só os arquivos sem sequencial (2010 e 2014) trazem nm_votavel; nos outros grupos a coluna não existe.
  const colunas = (await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet(${glob(pastaVotos)})`)).getRowObjectsJson()
    .map((r) => String((r as { column_name: string }).column_name));
  const nmVotavel = colunas.includes("nm_votavel") ? "v.nm_votavel" : "NULL::VARCHAR";
  // Votos somados por município IBGE (exterior = 'ZZ'; voto em trânsito de 2010 = 'VT').
  await conn.run(`CREATE OR REPLACE TEMP TABLE votos AS
    SELECT v.ano, v.turno, v.cargo, v.sg_uf, v.cd_municipio_tse,
      CASE WHEN v.sg_uf IN ('ZZ', 'VT') THEN v.sg_uf ELSE m.cd_municipio_ibge END AS cd_municipio,
      v.categoria, COALESCE(v.cd_candidato, c.cd_candidato) AS cd_candidato, SUM(v.votos)::BIGINT AS votos
    FROM read_parquet(${glob(pastaVotos)}) v
    LEFT JOIN mun m ON m.sg_uf = v.sg_uf AND m.cd_municipio_tse = v.cd_municipio_tse
    LEFT JOIN cand_nome c ON v.cd_candidato IS NULL AND ${nmVotavel} IS NOT NULL
      AND c.ano = v.ano AND c.cargo = v.cargo AND c.nm = ${nmVotavel}
    GROUP BY ALL`);
  const [{ semCand }] = (await conn.runAndReadAll(`SELECT COUNT(*)::INTEGER AS "semCand" FROM votos WHERE categoria = 'candidato' AND cd_candidato IS NULL`)).getRowObjectsJson() as { semCand: number }[];
  if (semCand > 0) console.warn(`  ${grupo}: ${semCand} linhas de candidato sem cadastro`);
  const [{ sem }] = (await conn.runAndReadAll(`SELECT COUNT(*)::INTEGER AS sem FROM votos WHERE cd_municipio IS NULL`)).getRowObjectsJson() as { sem: number }[];
  if (sem > 0) console.warn(`  ${grupo}: ${sem} linhas sem município IBGE (descartadas)`);

  // Abstenção por cargo/eleição: perfil do TSE (por município TSE) ou o pacote de 2026 (por IBGE).
  const fontes: string[] = [];
  if (temPerfil) {
    fontes.push(`SELECT e.ano, e.turno, e.cargo, e.cd_municipio, SUM(p.abstencao)::BIGINT AS votos
      FROM (SELECT DISTINCT ano, turno, cargo, sg_uf, cd_municipio_tse, cd_municipio FROM votos WHERE cd_municipio IS NOT NULL AND sg_uf <> 'VT') e
      JOIN read_parquet(${glob(path.join(parciais, "perfil"))}) p
        ON p.ano = e.ano AND p.turno = e.turno AND p.sg_uf = e.sg_uf AND p.cd_municipio_tse = e.cd_municipio_tse
      WHERE e.ano <> 2026 GROUP BY ALL`);
  }
  if (temPacote) {
    fontes.push(`SELECT e.ano, e.turno, e.cargo, e.cd_municipio, SUM(p.votos)::BIGINT AS votos
      FROM (SELECT DISTINCT ano, turno, cargo, cd_municipio FROM votos WHERE ano = 2026 AND cd_municipio IS NOT NULL) e
      JOIN read_parquet(${q(PACOTE_2026)}) p
        ON p.ano = e.ano AND p.turno = e.turno AND p.cd_municipio = e.cd_municipio AND p.categoria = 'abstencao'
      GROUP BY ALL`);
  }
  const abstencao = fontes.length
    ? `SELECT ano, turno, cargo, cd_municipio, 'abstencao' AS categoria, NULL::VARCHAR AS cd_candidato, votos FROM (${fontes.join(" UNION ALL ")})`
    : `SELECT NULL::INTEGER AS ano, NULL::INTEGER AS turno, NULL AS cargo, NULL AS cd_municipio, NULL AS categoria, NULL::VARCHAR AS cd_candidato, NULL::BIGINT AS votos WHERE false`;

  await conn.run(`COPY (
      SELECT ano, turno, cargo, cd_municipio, categoria, cd_candidato, votos FROM votos WHERE cd_municipio IS NOT NULL
      UNION ALL ${abstencao}
      ORDER BY cargo, ano, turno, cd_municipio
    ) TO ${q(path.join(out, "f_votacao.parquet"))} (FORMAT parquet, COMPRESSION zstd)`);

  // Candidatos citados nos votos, com a cor e o espectro do partido.
  await conn.run(`COPY (
      WITH cand AS (
        SELECT ano || '-' || sq AS cd_candidato, ano, cargo, sg_uf, nome, nome_completo, partido, numero, situacao, turno
        FROM read_parquet(${glob(path.join(parciais, "candidatos"))})
      ), um AS (
        SELECT cd_candidato, arg_min(ano, turno) AS ano, arg_min(cargo, turno) AS cargo, arg_min(sg_uf, turno) AS uf,
          arg_min(nome, turno) AS nome, arg_min(nome_completo, turno) AS nome_completo, arg_min(partido, turno) AS partido,
          arg_min(numero, turno) AS numero, arg_max(situacao, turno) AS situacao
        FROM cand GROUP BY cd_candidato
      ), usados AS (SELECT DISTINCT cd_candidato FROM votos WHERE cd_candidato IS NOT NULL)
      SELECT u.cd_candidato, c.ano, c.cargo, c.uf, COALESCE(c.nome, 'Candidato ' || u.cd_candidato) AS nome,
        c.nome_completo, c.partido, c.numero,
        COALESCE(CASE WHEN regexp_matches(p.cor_hex, '^#[0-9A-Fa-f]{6}$') THEN lower(p.cor_hex) END, '#94a3b8') AS cor,
        p.espectro_politico AS espectro, NULLIF(c.situacao, '#NULO') AS situacao
      FROM usados u LEFT JOIN um c USING (cd_candidato)
      LEFT JOIN read_parquet(${q(dimPartidos)}) p ON upper(p.sigla) = upper(c.partido)
      ORDER BY u.cd_candidato
    ) TO ${q(path.join(out, "d_candidato.parquet"))} (FORMAT parquet, COMPRESSION zstd)`);

  await conn.run(`COPY (
      SELECT cd_municipio_ibge AS cd_municipio, nm_municipio_ibge AS nome, sg_uf AS uf, uf_regiao AS regiao,
        COALESCE(eh_capital, false) AS capital, populacao_estimada::BIGINT AS populacao
      FROM read_parquet(${q(dimMunicipios)}) WHERE cd_municipio_ibge IS NOT NULL
      UNION ALL SELECT 'ZZ', 'Exterior', 'ZZ', 'Exterior', false, NULL
      UNION ALL SELECT 'VT', 'Voto em trânsito', 'VT', 'Voto em trânsito', false, NULL
      ORDER BY cd_municipio
    ) TO ${q(path.join(out, "d_municipio.parquet"))} (FORMAT parquet, COMPRESSION zstd)`);

  const resumo = (await conn.runAndReadAll(`SELECT cargo, ano, turno, COUNT(*)::INTEGER AS linhas,
      SUM(votos) FILTER (WHERE categoria <> 'abstencao')::BIGINT AS votos,
      SUM(votos) FILTER (WHERE categoria = 'abstencao')::BIGINT AS abstencao
    FROM read_parquet(${q(path.join(out, "f_votacao.parquet"))}) GROUP BY ALL ORDER BY ALL`)).getRowObjectsJson();
  console.log(`  ${grupo}:`);
  for (const r of resumo) console.log(`    ${JSON.stringify(r)}`);
}

async function main(): Promise<void> {
  if (!existsSync(KEY_FILE)) throw new Error(`Credencial não encontrada: ${KEY_FILE}`);
  const bucket = new Storage({ keyFilename: KEY_FILE }).bucket(BUCKET);
  console.log(`Pasta de trabalho: ${WORK}`);
  const inv = await inventario(bucket);
  console.log(`Inventário: ${inv.votos.length} arquivos de votos, ${inv.perfis.length} perfis, ${inv.candidatos.length} cadastros de candidatos`);

  const instance = await DuckDBInstance.create(":memory:", { threads: "2", memory_limit: "1GB" });
  const conn = await instance.connect();
  try {
    await baixarParciais(conn, bucket, "candidatos", inv.candidatos);
    await baixarParciais(conn, bucket, "perfil", inv.perfis);
    await baixarParciais(conn, bucket, "votos", inv.votos);
    const dimMunicipios = await baixarDimensao(bucket, "dim_municipios.parquet");
    const dimPartidos = await baixarDimensao(bucket, "dim_partidos.parquet");
    if (!existsSync(PACOTE_2026)) console.warn(`Sem ${PACOTE_2026}: 2026 ficará sem abstenção (rode npm run mapadavotacao:parquets).`);
    console.log("Montando os grupos…");
    for (const grupo of Object.keys(GRUPOS)) await montarGrupo(conn, grupo, dimMunicipios, dimPartidos);
  } finally {
    conn.closeSync();
  }
  console.log(`Pronto: ${path.join(WORK, "saida")}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
