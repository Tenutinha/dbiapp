import { describe, expect, it } from "vitest";
import { joinParts, splitParts } from "./storage-parts";

describe("storage parts", () => {
  it("a path as it always was is a table of one part", () => {
    expect(splitParts("orgs/acme/datasets/x/v1/itens.1a2b3c4d.parquet")).toEqual(["orgs/acme/datasets/x/v1/itens.1a2b3c4d.parquet"]);
    expect(joinParts(["orgs/acme/datasets/x/v1/itens.1a2b3c4d.parquet"])).toBe("orgs/acme/datasets/x/v1/itens.1a2b3c4d.parquet");
  });

  it("several parts go and come back in the same order", () => {
    const parts = ["a/2022.parquet", "a/2023.parquet", "a/2024.parquet"];
    expect(splitParts(joinParts(parts))).toEqual(parts);
  });

  it("keeps Windows paths whole", () => {
    expect(splitParts(joinParts(["C:\\dados\\a.parquet", "C:\\dados\\b.parquet"]))).toEqual(["C:\\dados\\a.parquet", "C:\\dados\\b.parquet"]);
  });

  it("has no parts in an empty path", () => {
    expect(splitParts("")).toEqual([]);
  });
});
