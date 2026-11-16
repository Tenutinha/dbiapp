import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexLocalOriginals, localCandidates, matchingLocal, md5OfFile } from "./local-originals";

const CNPJ = "11222333000181";
let root: string;
let jan: string;
let janOther: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "originais-"));
  const dir = path.join(root, CNPJ, "original", "efd_icms_ipi");
  await mkdir(dir, { recursive: true });
  jan = path.join(dir, `${CNPJ}-123-20240101-20240131-0-AAAA-SPED-EFD.txt`);
  janOther = path.join(dir, `${CNPJ}-123-20240101-20240131-1-BBBB-SPED-EFD.txt`);
  await writeFile(jan, "|0000|original|");
  await writeFile(janOther, "|0000|retifica|"); // same size, other content
  await writeFile(path.join(dir, `${CNPJ}-123-20240201-20240229-0-CCCC-SPED-EFD.txt`), "|0000|fevereir|");
  await writeFile(path.join(dir, "recibo.pdf"), "|0000|original|");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("local originals", () => {
  it("finds by size, establishment and period, and settles by content", async () => {
    const index = await indexLocalOriginals(root);
    const stored = { cnpj: CNPJ, periodo: "2024-01", sizeBytes: 15 };
    const candidates = localCandidates(index, stored);
    expect(candidates.sort()).toEqual([jan, janOther].sort());

    const md5 = createHash("md5").update("|0000|retifica|").digest("hex");
    expect(await md5OfFile(janOther)).toBe(md5);
    expect(await matchingLocal(candidates, md5.toUpperCase())).toBe(janOther);
    expect(await matchingLocal(candidates, "0".repeat(32))).toBeNull();
  });

  it("leaves out another size, another establishment and another period", async () => {
    const index = await indexLocalOriginals(root);
    expect(localCandidates(index, { cnpj: CNPJ, periodo: "2024-01", sizeBytes: 16 })).toEqual([]);
    expect(localCandidates(index, { cnpj: "99888777000166", periodo: "2024-01", sizeBytes: 15 })).toEqual([]);
    expect(localCandidates(index, { cnpj: CNPJ, periodo: "2024-03", sizeBytes: 15 })).toEqual([]);
  });
});
