import { describe, expect, it } from "vitest";
import { matchFolderFiles } from "./storage-import-match";

const file = (name: string, sizeBytes = 10) => ({ key: `orgs/x/preparado/${name}`, name, sizeBytes, updatedAt: null });

describe("matchFolderFiles", () => {
  it("maps files named after the contract tables and lists the missing ones", () => {
    const r = matchFolderFiles(["f_votacao", "d_municipio", "d_candidato"], [file("f_votacao.parquet"), file("d_municipio.csv"), file("leia-me.txt")]);
    expect(r.matches.map((m) => [m.table, m.fileName])).toEqual([["f_votacao", "f_votacao.parquet"], ["d_municipio", "d_municipio.csv"]]);
    expect(r.missing).toEqual(["d_candidato"]);
  });

  it("prefers Parquet over CSV and ignores case", () => {
    const r = matchFolderFiles(["f_votacao"], [file("f_votacao.csv"), file("F_VOTACAO.parquet")]);
    expect(r.matches[0].fileName).toBe("F_VOTACAO.parquet");
  });

  it("does not match by prefix or other extensions", () => {
    const r = matchFolderFiles(["f_votacao"], [file("f_votacao_2026.parquet"), file("f_votacao.parquet.bak")]);
    expect(r.matches).toEqual([]);
    expect(r.missing).toEqual(["f_votacao"]);
  });
});
