/**
 * Gera os arquivos do contrato "eleicoes-presidente" v2, só presidente 2022/2026 (organização Mapa da Votação), a partir dos
 * pacotes que o mapadavotacao-insight já monta com os dados abertos do TSE e as estimativas do IBGE
 * (scripts/eleicoes2026presidente/gerar_dados_painel.js e gerar_populacao.js naquele repositório).
 *
 * Saída em sample-data/eleicoes-presidente/: f_votacao, d_municipio e d_candidato em Parquet,
 * prontos para subir em Dados → Publicar.
 *
 * Uso: npm run mapadavotacao:parquets [-- <pasta data/eleicoes2026presidente do mapadavotacao-insight>]
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";

const DEFAULT_SRC = path.resolve(process.cwd(), "../../mapadavotacao-insight/public/data/eleicoes2026presidente");
const SRC = path.resolve(process.argv[2] ?? DEFAULT_SRC);
const OUT_DIR = path.join(process.cwd(), "sample-data", "eleicoes-presidente");
/** 2026 fica na pasta base; os outros anos, numa subpasta com o ano. */
const ANOS = [{ ano: 2026, pasta: "." }, { ano: 2022, pasta: "2022" }] as const;

const turnoSchema = z.object({
  aptos: z.array(z.number()),
  comp: z.array(z.number()),
  brancos: z.array(z.number()),
  nulos: z.array(z.number()),
  votos: z.record(z.string(), z.array(z.number())),
});
const pacoteSchema = z.object({
  eleicao: z.object({ ano: z.number(), cargo: z.string() }),
  candidatos: z.array(z.object({
    id: z.string(),
    nome: z.string(),
    nomeCompleto: z.string(),
    partido: z.string(),
    numero: z.string(),
    cor: z.string().regex(/^#[0-9a-f]{6}$/i),
    segundoTurno: z.boolean(),
  })),
  municipios: z.object({
    ibge: z.array(z.string()),
    nome: z.array(z.string()),
    uf: z.array(z.string()),
    regiao: z.array(z.string()),
    capital: z.array(z.number()),
  }),
  t1: turnoSchema,
  t2: turnoSchema,
});
const populacaoSchema = z.object({ populacao: z.array(z.number().nullable()) });
type Pacote = z.infer<typeof pacoteSchema>;

interface Voto { ano: number; turno: number; cargo: string; cd_municipio: string; categoria: string; cd_candidato: string | null; votos: number }
interface Municipio { cd_municipio: string; nome: string; uf: string; regiao: string; capital: boolean; populacao: number | null }
interface Candidato { cd_candidato: string; ano: number; cargo: string; uf: string; nome: string; nome_completo: string; partido: string; numero: string; cor: string; espectro: string | null; situacao: string | null }

async function lerJson<T>(arquivo: string, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(JSON.parse(await readFile(arquivo, "utf8")));
  if (!parsed.success) throw new Error(`${arquivo}: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

function checarColunas(p: Pacote, ano: number): void {
  const n = p.municipios.ibge.length;
  for (const t of [p.t1, p.t2]) {
    const tamanhos = [t.aptos, t.comp, t.brancos, t.nulos, ...Object.values(t.votos)].map((a) => a.length);
    if (tamanhos.some((x) => x !== n)) throw new Error(`${ano}: colunas com tamanho diferente de ${n} municípios`);
  }
}

/** Uma linha por município × turno × candidato (só votos > 0), mais brancos, nulos e abstenção. */
function votosDoAno(p: Pacote, ano: number): Voto[] {
  const linhas: Voto[] = [];
  const { ibge } = p.municipios;
  ([[1, p.t1], [2, p.t2]] as const).forEach(([turno, t]) => {
    for (let i = 0; i < ibge.length; i++) {
      const base = { ano, turno, cargo: "PRESIDENTE", cd_municipio: ibge[i] };
      let nominais = 0;
      for (const [cd, votos] of Object.entries(t.votos)) {
        if (votos[i] > 0) linhas.push({ ...base, categoria: "candidato", cd_candidato: `${ano}-${cd}`, votos: votos[i] });
        nominais += votos[i];
      }
      if (nominais + t.brancos[i] + t.nulos[i] !== t.comp[i]) {
        throw new Error(`${ano} T${turno} ${ibge[i]}: votos não somam o comparecimento`);
      }
      // Abstenção = aptos − comparecimento (no exterior o pacote não traz a abstenção separada).
      linhas.push({ ...base, categoria: "branco", cd_candidato: null, votos: t.brancos[i] });
      linhas.push({ ...base, categoria: "nulo", cd_candidato: null, votos: t.nulos[i] });
      linhas.push({ ...base, categoria: "abstencao", cd_candidato: null, votos: Math.max(0, t.aptos[i] - t.comp[i]) });
    }
  });
  return linhas;
}

async function main(): Promise<void> {
  const votos: Voto[] = [];
  const municipios = new Map<string, Municipio>();
  const candidatos: Candidato[] = [];

  for (const { ano, pasta } of ANOS) {
    const dir = path.join(SRC, pasta);
    const pacote = await lerJson(path.join(dir, "dados.json"), pacoteSchema);
    const { populacao } = await lerJson(path.join(dir, "populacao.json"), populacaoSchema);
    if (pacote.eleicao.ano !== ano) throw new Error(`${dir}: pacote é de ${pacote.eleicao.ano}, esperado ${ano}`);
    checarColunas(pacote, ano);
    votos.push(...votosDoAno(pacote, ano));

    const m = pacote.municipios;
    m.ibge.forEach((cd, i) => {
      if (municipios.has(cd)) return; // o ano mais recente (2026, lido primeiro) prevalece
      municipios.set(cd, {
        cd_municipio: cd, nome: m.nome[i], uf: m.uf[i], regiao: m.regiao[i],
        capital: m.capital[i] === 1, populacao: populacao[i] ?? null,
      });
    });
    candidatos.push(...pacote.candidatos.map((c) => ({
      cd_candidato: `${ano}-${c.id}`, ano, cargo: "PRESIDENTE", uf: "BR", nome: c.nome, nome_completo: c.nomeCompleto,
      partido: c.partido, numero: c.numero, cor: c.cor, espectro: null, situacao: c.segundoTurno ? "2º TURNO" : null,
    })));
    console.log(`${ano}: ${m.ibge.length} municípios, ${pacote.candidatos.length} candidatos`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const tmp = path.join(OUT_DIR, "_tmp");
  await mkdir(tmp, { recursive: true });
  const nd = (rows: readonly object[]): string => rows.map((r) => JSON.stringify(r)).join("\n");
  const duckPath = (p: string): string => `'${p.replace(/\\/g, "/").replace(/'/g, "''")}'`;

  const tabelas = [
    { nome: "f_votacao", linhas: votos, ordem: "ano, turno, cd_municipio",
      colunas: "{ano: 'INTEGER', turno: 'INTEGER', cargo: 'VARCHAR', cd_municipio: 'VARCHAR', categoria: 'VARCHAR', cd_candidato: 'VARCHAR', votos: 'BIGINT'}" },
    { nome: "d_municipio", linhas: [...municipios.values()], ordem: "cd_municipio",
      colunas: "{cd_municipio: 'VARCHAR', nome: 'VARCHAR', uf: 'VARCHAR', regiao: 'VARCHAR', capital: 'BOOLEAN', populacao: 'BIGINT'}" },
    { nome: "d_candidato", linhas: candidatos, ordem: "ano, cd_candidato",
      colunas: "{cd_candidato: 'VARCHAR', ano: 'INTEGER', cargo: 'VARCHAR', uf: 'VARCHAR', nome: 'VARCHAR', nome_completo: 'VARCHAR', partido: 'VARCHAR', numero: 'VARCHAR', cor: 'VARCHAR', espectro: 'VARCHAR', situacao: 'VARCHAR'}" },
  ];

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    for (const t of tabelas) {
      const json = path.join(tmp, `${t.nome}.ndjson`);
      await writeFile(json, nd(t.linhas));
      const out = path.join(OUT_DIR, `${t.nome}.parquet`);
      await conn.run(`COPY (SELECT * FROM read_json(${duckPath(json)}, format = 'newline_delimited', columns = ${t.colunas}) ORDER BY ${t.ordem})
        TO ${duckPath(out)} (FORMAT parquet, COMPRESSION zstd)`);
      console.log(`${t.nome}.parquet: ${t.linhas.length.toLocaleString("pt-BR")} linhas`);
    }
  } finally {
    conn.closeSync();
    await rm(tmp, { recursive: true, force: true });
  }
  console.log(`Arquivos em ${OUT_DIR}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
