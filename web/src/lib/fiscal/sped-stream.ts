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
import { SpedReader, type SpedKind } from "./sped-kinds";

/** Fact rows buffered before each write to the CSV. */
const WRITE_BATCH = 2000;

export async function writeChunk(out: WriteStream, chunk: string): Promise<void> {
  if (!out.write(chunk)) await once(out, "drain");
}

/** Appends every record of one file to the fact CSV; returns what the file said about the dimensions. */
export async function appendSpedFile(kind: SpedKind, localPath: string, out: WriteStream): Promise<{ lines: number; dimensions: FiscalTables }> {
  const lines = createInterface({ input: createReadStream(localPath, { encoding: "latin1" }), crlfDelay: Infinity });
  let reader: SpedReader | null = null;
  let batch = "";
  let pending = 0;
  let total = 0;
  for await (const line of lines) {
    const record = parseLine(line);
    if (!record) continue;
    reader ??= new SpedReader(kind, record);
    batch += csvLine(reader.push(record));
    pending += 1;
    total += 1;
    if (pending >= WRITE_BATCH) {
      await writeChunk(out, batch);
      batch = "";
      pending = 0;
    }
    if (record[0] === "9999") break; // what follows is the signature block
  }
  lines.close();
  if (batch) await writeChunk(out, batch);
  if (!reader) throw new FiscalFileError("O arquivo não tem registros.");
  return { lines: total, dimensions: reader.dimensions() };
}
