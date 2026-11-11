import { describe, expect, it } from "vitest";
import { joinParts, splitParts, supersededParts } from "./storage-parts";

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

describe("supersededParts", () => {
  it("lists the old files the new version no longer uses, part by part", () => {
    const previous = ["a/v1/fato.1.parquet\na/v1/fato.2.parquet", "a/v1/dim.3.parquet"];
    // The dimension was not re-sent: the new version keeps pointing to the old file.
    const current = ["a/v2/fato.4.parquet", "a/v1/dim.3.parquet"];
    expect(supersededParts(previous, current)).toEqual(["a/v1/fato.1.parquet", "a/v1/fato.2.parquet"]);
  });
  it("is empty on the first publication", () => {
    expect(supersededParts([], ["a/v1/fato.1.parquet"])).toEqual([]);
  });
});
