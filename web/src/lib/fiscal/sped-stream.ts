/**
 * Streams a SPED file from disk into a CSV, line by line, so a file with millions of lines never has
 * to fit in memory. Node file I/O only (no storage, no database): used by the service and by scripts.
 */
import { once } from "node:events";
import { createReadStream, type WriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { csvLine } from "./csv";
import type { FiscalTables } from "./importers";
import { FiscalFileError, parseLine } from "./sped";
import { keepsRecord, SpedReader, type SpedKind } from "./sped-kinds";

/** Fact rows buffered before each write to the CSV. */
const WRITE_BATCH = 2000;

export async function writeChunk(out: WriteStream, chunk: string): Promise<void> {
  if (!out.write(chunk)) await once(out, "drain");
}

/** Where the rows of one file go. */
export interface SpedOutputs {
  /** CSV of the main fact (every record). Null when only the block facts are wanted. */
  fact: WriteStream | null;
  /** CSV of each block fact the kind declares (`SpedKind.blockFacts`), by table name. */
  blocks?: Readonly<Record<string, WriteStream>>;
}

export interface SpedFileRead {
  /** Records read (all of them, or up to the last wanted block when only block facts are written). */
  lines: number;
  /** Rows written to each block fact. */
  blockLines: Record<string, number>;
  dimensions: FiscalTables;
}

/** Rows waiting to be written to one CSV. */
class Batch {
  private text = "";
  private pending = 0;
  total = 0;

  constructor(private readonly out: WriteStream) {}

  async add(line: string): Promise<void> {
    this.text += line;
    this.pending += 1;
    this.total += 1;
    if (this.pending >= WRITE_BATCH) await this.flush();
  }

  async flush(): Promise<void> {
    if (!this.text) return;
    const chunk = this.text;
    this.text = "";
    this.pending = 0;
    await writeChunk(this.out, chunk);
  }
}

/**
 * Appends the records of one file to the CSVs: every record to the main fact, and the records of the
 * blocks a block fact keeps to that fact's. Returns what the file said about the dimensions.
 * Without a main fact, reading stops once the wanted blocks are over (block 0, with the dimensions, comes first).
 */
export async function appendSpedFile(kind: SpedKind, localPath: string, outputs: SpedOutputs): Promise<SpedFileRead> {
  const lines = createInterface({ input: createReadStream(localPath, { encoding: "latin1" }), crlfDelay: Infinity });
  const fact = outputs.fact ? new Batch(outputs.fact) : null;
  const blockBatches = new Map<string, Batch>();
  const tablesOfBlock = new Map<string, string[]>();
  for (const [table, out] of Object.entries(outputs.blocks ?? {})) {
    blockBatches.set(table, new Batch(out));
    for (const block of kind.blockFacts[table]?.blocks ?? []) tablesOfBlock.set(block, [...(tablesOfBlock.get(block) ?? []), table]);
  }
  const openBlocks = new Set(tablesOfBlock.keys());
  /** Tables that keep each record, worked out once per record code. */
  const targetsOf = new Map<string, string[]>();
  const tablesFor = (record: string): string[] => {
    let tables = targetsOf.get(record);
    if (!tables) {
      tables = (tablesOfBlock.get(record[0] ?? "") ?? []).filter((table) => keepsRecord(kind.blockFacts[table], record));
      targetsOf.set(record, tables);
    }
    return tables;
  };
  let reader: SpedReader | null = null;
  let total = 0;
  for await (const line of lines) {
    const record = parseLine(line);
    if (!record) continue;
    reader ??= new SpedReader(kind, record);
    const row = reader.push(record);
    total += 1;
    const block = record[0][0] ?? "";
    const targets = tablesFor(record[0]);
    if (fact || targets.length > 0) {
      const csv = csvLine(row);
      if (fact) await fact.add(csv);
      for (const table of targets) await blockBatches.get(table)?.add(csv);
    }
    if (record[0] === "9999") break; // what follows is the signature block
    if (record[0] === `${block}990`) {
      openBlocks.delete(block);
      if (!fact && openBlocks.size === 0) break;
    }
  }
  lines.close();
  await fact?.flush();
  for (const batch of blockBatches.values()) await batch.flush();
  if (!reader) throw new FiscalFileError("O arquivo não tem registros.");
  return {
    lines: total,
    blockLines: Object.fromEntries([...blockBatches].map(([table, batch]) => [table, batch.total])),
    dimensions: reader.dimensions(),
  };
}
