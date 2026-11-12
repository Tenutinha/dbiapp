/**
 * Lineage of a SPED dashboard's tables: for each table, which raw files its lines came from, how they were
 * read and what was done to them (kept whole, blocks kept, records left out, lines summed up, the latest
 * period winning). Written next to the tables at every "Montar tabelas", so a number on screen can be traced
 * back to the files that made it. Every line of a fact also keeps its own origin: `arquivo` (company and
 * month) and `linha` (the line in the file; 0 on a line that sums several). Pure.
 */
import type { PartsMarker, RawFile } from "./parts-plan";
import type { SpedKind } from "./sped-kinds";

export interface LineageSource {
  /** The raw file, relative to the organization's folder. */
  file: string;
  cnpj: string;
  periodo: string;
  sizeBytes: number;
  updatedAt: string | null;
  /** Lines this file put into the table. */
  rows: number;
}

export interface TableLineage {
  table: string;
  kind: "fact" | "dimension";
  /** In words: what the table keeps of each file and how. */
  how: string[];
  rows: number | null;
  sources: LineageSource[];
}

export interface Lineage {
  dashboard: string;
  template: string;
  builtAt: string;
  /** SPED_READER_VERSION the files were read with. */
  reader: number;
  tables: TableLineage[];
}

/** What a fact keeps of each file, in words. */
export function factHow(kind: SpedKind, table: string, isMain: boolean): string[] {
  if (isMain) {
    return [
      `${kind.title}: o arquivo inteiro, uma linha por linha do arquivo (campos originais em c01, c02…).`,
      kind.mainFactPeriods === "latest"
        ? "Só o período mais recente de cada empresa: os demais períodos estão nas tabelas por bloco."
        : "Todos os períodos enviados.",
    ];
  }
  const fact = kind.blockFacts[table];
  if (!fact) return [];
  const how = [`Blocos ${fact.blocks.join(", ")} de todos os períodos enviados, uma linha por linha do arquivo.`];
  if (fact.only) how.push(`Só os registros ${fact.only.join(", ")}.`);
  if (fact.skip) how.push(`Sem os registros ${fact.skip.join(", ")}.`);
  if (fact.collapse) {
    const c = fact.collapse;
    const by = [
      "arquivo", "operação", ...(c.byEstablishment ? ["estabelecimento"] : []), ...(c.byItem ? ["item"] : []), ...c.keys,
    ];
    how.push(
      `As linhas do ${c.record} são somadas por ${by.join(", ")}: somam-se ${c.sums.join(", ")}; os demais campos ficam vazios`
      + " e a linha somada fica com o número de linha 0.",
    );
  }
  return how;
}

/** What a dimension keeps, in words. */
export function dimensionHow(table: string): string[] {
  return [
    `Cadastro (${table}) lido de cada arquivo; quando o mesmo código aparece em vários, fica o do período mais recente.`,
    "Somado ao que o dashboard já tinha: códigos de arquivos retirados podem continuar no cadastro.",
  ];
}

/** One source per file that put lines into the part of `table` (facts) or of the dimension `table`. */
export function sourcesOf(
  ready: readonly { file: RawFile; marker: PartsMarker }[], table: string, where: "tables" | "dimensions",
  relative: (key: string) => string,
): LineageSource[] {
  return ready.flatMap(({ file, marker }) => {
    const part = marker[where][table];
    if (!part?.key) return [];
    return [{
      file: relative(file.key), cnpj: file.cnpj, periodo: file.periodo, sizeBytes: file.sizeBytes,
      updatedAt: file.updatedAt, rows: part.rows,
    }];
  });
}
