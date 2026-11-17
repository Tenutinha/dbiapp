/**
 * Ensaio da página ao vivo da carga, sem carga nenhuma: reproduz um log (as linhas que uma carga com
 * --eventos imprimiu) ou, sem log, uma conversão de exemplo, do primeiro arquivo à publicação. Não fala com
 * o banco nem com o bucket — serve para ver e ajustar a tela.
 *
 * Uso (em web/): node --import tsx scripts/fiscal/ensaio-ao-vivo.ts [arquivo.log] [--porta 3040] [--pausa 150] [--falha]
 *   --pausa  milissegundos entre os passos (padrão 150)
 *   --falha  no exemplo, um arquivo falha e a conversão para antes de publicar
 *   --historico <pasta>  guarda o ensaio nessa pasta, como uma carga guarda a si mesma (para ver a tela do
 *            histórico; nunca na pasta das cargas de verdade)
 */
import { readFileSync } from "node:fs";
import { startLiveServer } from "../../src/lib/fiscal/live-server";
import { openRun } from "../../src/lib/fiscal/load-history";
import { eventLine, type LoadEvent } from "../../src/lib/fiscal/local-load";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const BLOCKS: readonly [string, number][] = [
  ["registros", 180_000], ["bloco_c_resumo_itens", 62_000], ["paineis_todos_periodos", 9_000], ["bloco_e_apuracao", 5_400],
  ["bloco_h_inventario", 48_000], ["participantes", 21_000], ["itens", 6_500], ["estabelecimentos", 1],
];
const FILES = 12;
const CNPJ = "11222333000181";

/** A load of twelve months of one company, with every step the real one reports. */
function sample(fail: boolean): LoadEvent[] {
  const events: LoadEvent[] = [];
  const totals = new Map<string, number>();
  for (let m = 1; m <= FILES; m += 1) {
    const file = { cnpj: CNPJ, periodo: `2025-${String(m).padStart(2, "0")}` };
    const sizeBytes = (80 + m * 7) * 1024 ** 2;
    events.push({ passo: { etapa: "quebra", passo: "inicio", ...file, sizeBytes, origem: m % 4 === 0 ? "bucket" : "disco", posicao: m, total: FILES } });
    for (let linhas = 60_000; linhas <= 300_000; linhas += 60_000) events.push({ passo: { etapa: "quebra", passo: "lendo", ...file, linhas: linhas + m * 1000 } });
    if (fail && m === 7) {
      events.push({ arquivo: { ...file, sizeBytes, ok: false, rows: {}, error: "o arquivo termina antes do registro 9999", ms: 4200 } });
      continue;
    }
    const rows: Record<string, number> = {};
    for (const [tabela, base] of BLOCKS) {
      rows[tabela] = base + m * Math.round(base / 40);
      totals.set(tabela, (totals.get(tabela) ?? 0) + rows[tabela]);
      events.push({ passo: { etapa: "quebra", passo: "bloco", ...file, tabela, linhas: rows[tabela] } });
    }
    events.push({ arquivo: { ...file, sizeBytes, ok: true, rows, ms: 5200 + m * 90 } });
  }
  BLOCKS.forEach(([tabela], i) => {
    const partes = fail ? FILES - 1 : FILES;
    events.push({ passo: { etapa: "uniao", passo: "inicio", tabela, partes, posicao: i + 1, total: BLOCKS.length } });
    for (const feitas of [Math.ceil(partes / 3), Math.ceil((2 * partes) / 3), partes]) events.push({ passo: { etapa: "uniao", passo: "partes", tabela, feitas, total: partes } });
    events.push({ passo: { etapa: "uniao", passo: "juntando", tabela, ...(i === 0 ? { ano: "2025" } : {}) } });
    if (i === 0) events.push({ passo: { etapa: "uniao", passo: "ano", tabela, ano: "2025", linhas: totals.get(tabela) ?? 0, reaproveitado: false } });
    events.push({ passo: { etapa: "uniao", passo: "validando", tabela } });
    events.push({ tabela: { table: tabela, ok: true, rows: totals.get(tabela) ?? 0, sizeBytes: Math.round((totals.get(tabela) ?? 0) * 24), ms: 1800 + i * 400 } });
  });
  return events;
}

async function main(): Promise<void> {
  const logFile = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
  const pause = Number(arg("--pausa") ?? 150);
  const fail = process.argv.includes("--falha");
  const titulo = logFile ? "ensaio · log reproduzido" : "ensaio · conversão de exemplo";
  const history = arg("--historico");
  const run = history ? openRun(history, { titulo, molde: "ensaio", org: "exemplo", cliente: null, opcoes: fail ? ["--falha"] : [] }) : null;
  const server = await startLiveServer({ port: Number(arg("--porta") ?? 3040), titulo, ...(history && run ? { history, run: run.id } : {}) });
  const live = { ...server, publish: (line: string): void => { run?.append(line); server.publish(line); } };
  console.log(`ao vivo: ${live.url} (abra no navegador; começa em 3 s)`);
  await wait(3000);

  const lines = logFile
    ? readFileSync(logFile, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "" && !line.startsWith("saída"))
    : ['catálogo: "exemplo" já está atualizado', ...sample(fail).map(eventLine)];
  for (const line of lines) {
    live.publish(line);
    await wait(line.includes('"passo":"lendo"') || line.includes('"passo":"partes"') ? pause / 2 : pause);
  }
  if (!logFile) {
    if (fail) {
      live.publish("1 arquivo(s) não puderam ser lidos; nada foi publicado (as tabelas ficaram no rascunho). Converta de novo.");
    } else {
      live.publish(eventLine({ passo: { etapa: "publicacao", passo: "inicio" } }));
      await wait(pause * 6);
      live.publish(eventLine({ passo: { etapa: "publicacao", passo: "fim", avisos: [] } }));
      live.publish("publicado: /exemplo/d/00000000-0000-0000-0000-000000000000");
    }
  }
  const ok = logFile ? lines.some((line) => line.startsWith("publicado:")) : !fail;
  run?.close(ok, ok ? undefined : "o ensaio parou antes de publicar");
  await live.finish(ok);
}

main().then(() => process.exit(0), (err: unknown) => {
  console.error(err);
  process.exit(1);
});
