/**
 * Roda as receitas de um pacote de origem (web/feeds/<pacote>) sobre uma pasta de Parquet e grava as tabelas
 * de cada molde em <saida>/<molde>/<tabela>.parquet. Ver docs/ingestao-diaria.md.
 *
 * Uso (em web/):
 *   node --import tsx scripts/feeds/montar.ts --pacote odeon-erp --data 2026-11-09 --saida <pasta> \
 *     [--camada oficial|modelo] --entrada [prefixo=]<pasta> [--entrada ...] [--molde <id> ...]
 *
 * --entrada: na camada oficial, a pasta com <tabela oficial>.parquet. Na camada modelo, "prefixo=pasta" lê a
 * tabela do modelo <prefixo><nome> do arquivo <pasta>/<nome>.parquet (ex.: vnd_=…/vendas-superauto/dados).
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { toDuckPath } from "../../src/lib/duck/engine";
import { montar, type Camada } from "../../src/lib/feeds/montar";
import { carregarPacote, type PacoteCarregado } from "../../src/lib/feeds/pacote";

interface Args {
  pacote: string;
  camada: Camada;
  entradas: string[];
  saida: string;
  data: string;
  moldes: string[];
}

function parseArgs(argv: readonly string[]): Args {
  const valores = (flag: string): string[] => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
  const um = (flag: string): string | undefined => valores(flag)[0];
  const pacote = um("--pacote");
  const saida = um("--saida");
  const data = um("--data");
  const camada = (um("--camada") ?? "oficial") as Camada;
  if (!pacote || !saida || !data || !["oficial", "modelo"].includes(camada)) {
    throw new Error("uso: montar.ts --pacote <id> --data AAAA-MM-DD --saida <pasta> [--camada oficial|modelo] --entrada [prefixo=]<pasta> [--molde <id>]");
  }
  return { pacote, camada, entradas: valores("--entrada"), saida, data, moldes: valores("--molde") };
}

/** Tabela → arquivo, conforme a camada e as pastas de entrada. */
function arquivos(p: PacoteCarregado, args: Args): Record<string, string> {
  const nomes = args.camada === "oficial" ? p.pacote.oficiais.map((o) => o.nome) : p.pacote.modelo.map((m) => m.nome);
  const out: Record<string, string> = {};
  for (const entrada of args.entradas) {
    const igual = entrada.indexOf("=");
    const [prefixo, pasta] = igual >= 0 ? [entrada.slice(0, igual), entrada.slice(igual + 1)] : ["", entrada];
    for (const nome of nomes) {
      if (!nome.startsWith(prefixo)) continue;
      const f = path.join(pasta, `${nome.slice(prefixo.length)}.parquet`);
      if (existsSync(f)) out[nome] = toDuckPath(path.resolve(f));
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const p = carregarPacote(path.resolve("feeds", args.pacote), args.moldes);
  const mapa = arquivos(p, args);
  await mkdir(args.saida, { recursive: true });
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  try {
    const feitas = await montar(conn, p, {
      camada: args.camada,
      arquivos: mapa,
      saida: toDuckPath(path.resolve(args.saida)),
      dataReferencia: args.data,
      moldes: args.moldes.length > 0 ? args.moldes : undefined,
    });
    for (const f of feitas) console.log(`ok  ${f.molde}/${f.tabela}: ${f.linhas} linhas`);
  } finally {
    conn.closeSync();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
