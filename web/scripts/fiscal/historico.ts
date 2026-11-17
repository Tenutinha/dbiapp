/**
 * O histórico das cargas fiscais desta máquina, sem rodar carga nenhuma: a mesma página da carga ao vivo,
 * aberta na última conversão guardada, com a lista de todas e a comparação de cada uma com a anterior do
 * mesmo dashboard. Só lê a pasta do histórico — não fala com o banco nem com o bucket.
 *
 * Uso (em web/): node --import tsx scripts/fiscal/historico.ts [--porta 3050] [--pasta <pasta>] [--lista]
 *   --pasta  onde as cargas ficam guardadas (padrão: DBI_FISCAL_HISTORY_DIR ou <home>/dbi-importacoes/conversoes)
 *   --lista  só imprime as conversões no terminal, sem abrir a página
 */
import { startLiveServer } from "../../src/lib/fiscal/live-server";
import { historyDir, listRuns, type RunSummary } from "../../src/lib/fiscal/load-history";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const RESULT: Record<RunSummary["fase"], string> = { concluida: "publicada", falhou: "parou antes de publicar", interrompida: "interrompida", rodando: "rodando" };

function minutes(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 60000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`;
}

function printRuns(runs: readonly RunSummary[]): void {
  if (runs.length === 0) console.log("nenhuma conversão guardada ainda");
  for (const run of runs) {
    const when = new Date(run.inicio).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const rows = run.tabelas.reduce((sum, t) => sum + t.rows, 0);
    console.log(`${when}  ${run.titulo}  ${RESULT[run.fase]}  ${minutes(run.duracaoMs)}  ${run.arquivos.lidos.toLocaleString("pt-BR")} arquivo(s) lido(s), ${run.arquivos.erros.toLocaleString("pt-BR")} com erro  ${rows.toLocaleString("pt-BR")} linhas nas tabelas`);
  }
}

async function main(): Promise<void> {
  const dir = arg("--pasta") ?? historyDir();
  if (process.argv.includes("--lista")) {
    printRuns(listRuns(dir));
    return;
  }
  const live = await startLiveServer({ port: Number(arg("--porta") ?? 3050), titulo: "Histórico das conversões", history: dir, idle: true });
  console.log(`histórico: ${live.url} (pasta ${dir}; Ctrl+C fecha)`);
  await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  await live.finish(true);
}

main().then(() => process.exit(0), (err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
