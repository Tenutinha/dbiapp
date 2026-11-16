/**
 * Raw fiscal files that also exist on this machine (DBI_FISCAL_LOCAL_ORIGINALS): a load run from a computer
 * that keeps the originals reads them from disk instead of downloading each one from the bucket. The bucket
 * stays the reference: a local file is used only when its size and its MD5 are the stored object's.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Local .txt files by size in bytes. */
export type LocalIndex = ReadonlyMap<number, readonly string[]>;

/** What identifies a stored raw file well enough to look for its local copy. */
export interface StoredOriginal {
  cnpj: string;
  /** aaaa-mm */
  periodo: string;
  sizeBytes: number;
}

/** Every .txt under `root`, all levels, grouped by size. */
export async function indexLocalOriginals(root: string): Promise<LocalIndex> {
  const index = new Map<number, string[]>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
        const { size } = await stat(full);
        index.set(size, [...(index.get(size) ?? []), full]);
      }
    }
  };
  await walk(root);
  return index;
}

/**
 * Local files that may be the stored one: same size, and the name carries the establishment and the first
 * day of the period (how the tax authority's programs name what they save). The content still has to match.
 */
export function localCandidates(index: LocalIndex, file: StoredOriginal): string[] {
  const firstDay = `${file.periodo.replace("-", "")}01`;
  return (index.get(file.sizeBytes) ?? []).filter((p) => {
    const name = path.basename(p);
    return name.includes(file.cnpj) && name.includes(firstDay);
  });
}

/** MD5 of a file, in hex, read as a stream (the files reach hundreds of MB). */
export function md5OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** The candidate whose content is the stored object's (`storedMd5` in hex), if any. */
export async function matchingLocal(candidates: readonly string[], storedMd5: string): Promise<string | null> {
  for (const candidate of candidates) {
    if ((await md5OfFile(candidate)) === storedMd5.toLowerCase()) return candidate;
  }
  return null;
}
