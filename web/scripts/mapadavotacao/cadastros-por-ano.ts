/**
 * Põe na pasta de cada cliente-ano do Mapa da Votação os cadastros que o "Votos Válidos" pede, já que o
 * engate de um dashboard de cliente só enxerga a pasta daquele cliente:
 *
 *   clientes/<ano>/brutos/cadastros/municipios.parquet   cópia de brutos/cadastros/municipios.parquet
 *   clientes/<ano>/brutos/cadastros/partidos.parquet     cópia de brutos/cadastros/partidos.parquet
 *   clientes/<ano>/brutos/candidatos.parquet             candidatos daquele ano: os cadastros por UF
 *                                                       (brutos/tse-tratado/candidatos/<UF>.parquet) + BR
 *
 * Uso: npm run mapadavotacao:cadastros-por-ano [-- aplicar]   (sem "aplicar" só mostra o que faria)
 */
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { Storage } from "@google-cloud/storage";
import { ANOS } from "./organizar-por-ano";

const ORG = "orgs/mapa-da-votacao/";
const KEY_FILE = path.join(process.cwd(), "secrets", "gcs-key.json");
const WORK = path.join(process.cwd(), "sample-data", "cadastros-por-ano");
const q = (p: string): string => `'${p.replace(/\\/g, "/").replace(/'/g, "''")}'`;

async function main(): Promise<void> {
  const aplicar = process.argv[2] === "aplicar";
  const bucket = new Storage({ keyFilename: KEY_FILE }).bucket("dbi-app-br-arquivos");

  // Cadastros iguais para todos os anos: cópia dentro do Google.
  for (const ano of ANOS) {
    for (const nome of ["municipios", "partidos"]) {
      const de = `${ORG}brutos/cadastros/${nome}.parquet`;
      const para = `${ORG}clientes/${ano}/brutos/cadastros/${nome}.parquet`;
      console.log(`${aplicar ? "copiando" : "copiaria"} ${de.slice(ORG.length)} → ${para.slice(ORG.length)}`);
      if (aplicar) await bucket.file(de).copy(bucket.file(para));
    }
  }

  // Candidatos: um arquivo por ano, só com as candidaturas daquele ano (UFs + BR).
  const [arquivos] = await bucket.getFiles({ prefix: `${ORG}brutos/tse-tratado/candidatos/` });
  const porUf = arquivos.filter((f) => /\/[A-Z]{2}\.parquet$/.test(f.name));
  console.log(`cadastros de candidatos: ${porUf.length} arquivos (UFs + BR)`);
  await mkdir(WORK, { recursive: true });
  for (const f of porUf) {
    const local = path.join(WORK, path.basename(f.name));
    if (!existsSync(local)) await f.download({ destination: local });
  }
  const conn = await (await DuckDBInstance.create(":memory:", { threads: "2", memory_limit: "1GB" })).connect();
  try {
    for (const ano of ANOS) {
      const out = path.join(WORK, `candidatos_${ano}.parquet`);
      await conn.run(`COPY (SELECT * FROM read_parquet(${q(path.join(WORK, "[A-Z][A-Z].parquet"))}, union_by_name = true)
        WHERE ano_eleicao = '${ano}' ORDER BY sg_uf, chave_candidato) TO ${q(out)} (FORMAT parquet, COMPRESSION zstd)`);
      const [{ n }] = (await conn.runAndReadAll(`SELECT COUNT(*)::INTEGER AS n FROM read_parquet(${q(out)})`)).getRowObjectsJson() as { n: number }[];
      const para = `${ORG}clientes/${ano}/brutos/candidatos.parquet`;
      console.log(`${ano}: ${n.toLocaleString("pt-BR")} candidaturas → ${aplicar ? "" : "(enviaria) "}${para.slice(ORG.length)}`);
      if (aplicar) await bucket.upload(out, { destination: para, contentType: "application/vnd.apache.parquet", resumable: false });
    }
  } finally {
    conn.closeSync();
  }
  if (aplicar) await rm(WORK, { recursive: true, force: true });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
