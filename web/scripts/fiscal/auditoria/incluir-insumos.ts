/**
 * Inclusão de insumos (CR17 do catálogo): gera o arquivo corrigido da EFD Contribuições de um mês, com as
 * notas de entrada que só estão na EFD ICMS/IPI dos estabelecimentos, e um relatório do que entrou e do
 * que ficou de fora. A lógica está em src/lib/fiscal/inclusao-insumos.ts; aqui só se leem e gravam arquivos.
 *
 * Uso (em web/; não precisa de .env: só lê arquivos locais):
 *   node --import tsx scripts/fiscal/auditoria/incluir-insumos.ts \
 *     --contrib <EFD Contribuições do mês.txt> --icms <EFD ICMS/IPI.txt> [--icms <outro estabelecimento.txt> …] \
 *     --chaves <chaves já escrituradas.txt> --saida <pasta fora do repositório> \
 *     [--cfop <lista de CFOP.txt>] [--recibo <recibo da escrituração a retificar>]
 *
 * --chaves: as chaves de todos os C100 da EFD Contribuições, de todos os meses (uma por linha; em CSV, vale
 *   a primeira sequência de 44 dígitos de cada linha). Só as que aparecem nas notas da EFD ICMS/IPI ficam na memória.
 * --cfop: troca a tabela de CFOP do repositório por uma lista (um CFOP por linha).
 *
 * O arquivo gerado ainda tem de ser validado no PVA, onde a apuração (bloco M) é refeita.
 */
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { tabelaCfopCredito, tabelaCfopDeTexto, type TabelaCfopCredito } from "../../../src/lib/fiscal/cfop-credito";
import { toCsv } from "../../../src/lib/fiscal/csv";
import { incluirInsumos, RELATORIO_COLUNAS, type LinhaRelatorio } from "../../../src/lib/fiscal/inclusao-insumos";
import { C100, lerEfdIcms, type EfdIcms } from "../../../src/lib/fiscal/inclusao-insumos-icms";

const USO = "uso: incluir-insumos.ts --contrib <arquivo> --icms <arquivo> [--icms <arquivo> …] --chaves <arquivo> --saida <pasta> [--cfop <arquivo>] [--recibo <recibo>]";
const REPOSITORIO = path.resolve(import.meta.dirname, "../../../..");

function args(flag: string): string[] {
  return process.argv.flatMap((a, i) => (a === flag && process.argv[i + 1] ? [process.argv[i + 1] as string] : []));
}

/** O arquivo como texto ISO-8859-1: cada byte vira um caractere, e gravar de volta devolve os mesmos bytes. */
async function lerLatin1(arquivo: string): Promise<string> {
  return (await readFile(arquivo)).toString("latin1");
}

/** Das chaves já escrituradas, só as que interessam (as das notas candidatas), lidas linha a linha. */
async function chavesEscrituradas(arquivo: string, candidatas: ReadonlySet<string>): Promise<Set<string>> {
  const achadas = new Set<string>();
  let lidas = 0;
  for await (const linha of createInterface({ input: createReadStream(arquivo, { encoding: "latin1" }), crlfDelay: Infinity })) {
    const chave = /(?<!\d)\d{44}(?!\d)/.exec(linha)?.[0];
    if (!chave) continue;
    lidas += 1;
    if (candidatas.has(chave)) achadas.add(chave);
  }
  if (lidas === 0) console.log(`aviso: ${arquivo} não tem nenhuma chave de 44 dígitos; nenhuma nota será tratada como já escriturada em outro mês`);
  return achadas;
}

async function tabelaCfop(arquivo: string | undefined): Promise<TabelaCfopCredito> {
  return arquivo ? tabelaCfopDeTexto(await readFile(arquivo, "utf8"), arquivo) : tabelaCfopCredito();
}

function dentroDoRepositorio(pasta: string): boolean {
  const relativo = path.relative(REPOSITORIO, path.resolve(pasta));
  return relativo === "" || (!relativo.startsWith("..") && !path.isAbsolute(relativo));
}

async function main(): Promise<void> {
  const [contrib] = args("--contrib");
  const icmsArquivos = args("--icms");
  const [chaves] = args("--chaves");
  const [saida] = args("--saida");
  if (!contrib || icmsArquivos.length === 0 || !chaves || !saida) throw new Error(USO);
  if (dentroDoRepositorio(saida)) throw new Error("--saida tem de ficar fora do repositório: o arquivo gerado tem dados de cliente");

  const tabela = await tabelaCfop(args("--cfop")[0]);
  const icms: EfdIcms[] = [];
  for (const arquivo of icmsArquivos) icms.push(lerEfdIcms(path.basename(arquivo), (await lerLatin1(arquivo)).split(/\r?\n/)));
  const candidatas = new Set(icms.flatMap((e) => e.notas.map((n) => n.campos[C100.CHV_NFE] ?? "")));
  const original = await lerLatin1(contrib);
  const resultado = incluirInsumos(original.split(/\r?\n/), icms, {
    cfopCredito: tabela.cfop, chavesEscrituradas: await chavesEscrituradas(chaves, candidatas), reciboAnterior: args("--recibo")[0],
  });

  const avisoTabela: LinhaRelatorio = { ...(Object.fromEntries(RELATORIO_COLUNAS.map((c) => [c, ""])) as LinhaRelatorio), tipo: "aviso",
    detalhe: `CFOP que gera crédito: ${tabela.cfop.size} códigos, ${tabela.origem}; situação: ${tabela.situacao}` };
  const fimDeLinha = original.includes("\r\n") ? "\r\n" : "\n";
  const nome = path.basename(contrib).replace(/\.txt$/i, "");
  const corrigido = path.join(saida, `${nome}-corrigido.txt`);
  const relatorio = path.join(saida, `${nome}-inclusao-insumos.csv`);
  await mkdir(saida, { recursive: true });
  await writeFile(corrigido, Buffer.from(resultado.linhas.join(fimDeLinha) + fimDeLinha, "latin1"));
  await writeFile(relatorio, `﻿${toCsv(RELATORIO_COLUNAS, [...resultado.relatorio, avisoTabela])}`, "utf8");

  for (const [tipo, n] of Object.entries(resultado.resumo)) console.log(`${String(n).padStart(8)}  ${tipo}`);
  for (const aviso of [...resultado.relatorio, avisoTabela].filter((r) => r.tipo === "aviso" && r.chave === "")) console.log(`aviso: ${aviso.detalhe}`);
  console.log(`arquivo corrigido: ${corrigido}`);
  console.log(`relatório: ${relatorio}`);
  console.log("O arquivo corrigido ainda não foi validado no PVA: importe, valide, gere a apuração e confira antes de transmitir.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
