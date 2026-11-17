import { describe, expect, it } from "vitest";
import { readPart, runPart, runsOf, STRIP_RUN, STRIP_RUNS_FROM } from "./strip-attrs";

describe("runs of a strip", () => {
  it("names a run of an analysis and reads it back", () => {
    expect(runPart("dados_originais", 3)).toBe("dados_originais:3");
    expect(readPart("dados_originais:3")).toEqual({ analysisId: "dados_originais", run: 3 });
    expect(readPart("visao_geral")).toEqual({ analysisId: "visao_geral", run: null });
    expect(readPart("")).toEqual({ analysisId: "", run: null });
  });

  it("brings a strip in runs only when it has many visuals", () => {
    expect(runsOf(2)).toBe(0);
    expect(runsOf(STRIP_RUNS_FROM)).toBe(0);
    expect(runsOf(STRIP_RUNS_FROM + 1)).toBe(Math.ceil((STRIP_RUNS_FROM + 1) / STRIP_RUN));
    expect(runsOf(204)).toBe(26);
  });
});
