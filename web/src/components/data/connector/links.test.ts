import { describe, expect, it } from "vitest";
import { addFiles, phaseOfFiles, putLink, removeFile, setFileCheck, withSuggestions } from "./links";
import type { FileState, Link, LinkFile, LinkPhase } from "./types";

const FOLDER = "outra/pasta";
const file = (name: string, state: FileState = "ok"): LinkFile => ({ folder: FOLDER, file: name, state });
const pick = (name: string) => ({ folder: FOLDER, file: name });
const wire = (table: string, phase: LinkPhase, name = `${table}.csv`): Link => ({
  table, files: [file(name, phase === "suggested" || phase === "checking" || phase === "diverge" ? phase : "ok")], phase,
});

describe("withSuggestions", () => {
  it("keeps the file that was just chosen while it is still being checked", () => {
    const chosen = wire("itens", "checking", "campos_2022.txt");
    expect(withSuggestions([chosen], [], "cliente")).toEqual([chosen]);
  });

  it("keeps every wire the person made, whatever its phase", () => {
    const phases: LinkPhase[] = ["checking", "ok", "diverge", "engaging", "engaged", "failed"];
    const links = phases.map((p, i) => wire(`t${i}`, p));
    expect(withSuggestions(links, [], "cliente")).toEqual(links);
  });

  it("does not suggest a file for a table that already has a wire", () => {
    const chosen = wire("itens", "ok", "campos_2022.txt");
    const out = withSuggestions([chosen], [{ table: "itens", file: "itens.parquet" }, { table: "notas", file: "notas.parquet" }], "cliente");
    expect(out).toEqual([chosen, { table: "notas", files: [{ folder: "cliente", file: "notas.parquet", state: "suggested" }], phase: "suggested" }]);
  });

  it("renews the suggestions: old ones go, the new listing comes", () => {
    const out = withSuggestions([wire("itens", "suggested", "velho.csv")], [{ table: "itens", file: "novo.csv" }], "cliente");
    expect(out).toEqual([{ table: "itens", files: [{ folder: "cliente", file: "novo.csv", state: "suggested" }], phase: "suggested" }]);
  });
});

describe("putLink", () => {
  it("replaces the wire of the same table and keeps the others", () => {
    const a = wire("a", "ok");
    const out = putLink([a, wire("b", "checking")], wire("b", "ok"));
    expect(out).toEqual([a, wire("b", "ok")]);
  });
});

describe("phaseOfFiles", () => {
  it("is ready only when every file fits", () => {
    expect(phaseOfFiles([file("a"), file("b")])).toBe("ok");
  });

  it("waits while any file is still being checked", () => {
    expect(phaseOfFiles([file("a"), file("b", "diverge"), file("c", "checking")])).toBe("checking");
  });

  it("is refused when one file diverges or could not be read", () => {
    expect(phaseOfFiles([file("a"), file("b", "diverge"), file("c", "failed")])).toBe("diverge");
    expect(phaseOfFiles([file("a"), file("c", "failed")])).toBe("failed");
  });
});

describe("addFiles", () => {
  it("starts a wire with every chosen file, each to be checked", () => {
    expect(addFiles([], "itens", [pick("2022.txt"), pick("2023.txt")])).toEqual([
      { table: "itens", files: [file("2022.txt", "checking"), file("2023.txt", "checking")], phase: "checking" },
    ]);
  });

  it("adds to the files the table already has and keeps the other tables", () => {
    const other = wire("clientes", "ok");
    const links: Link[] = [{ table: "itens", files: [file("2022.txt")], phase: "ok" }, other];
    expect(addFiles(links, "itens", [pick("2023.txt")])).toEqual([
      { table: "itens", files: [file("2022.txt"), file("2023.txt", "checking")], phase: "checking" },
      other,
    ]);
  });

  it("does not repeat a file: it is checked again", () => {
    const links: Link[] = [{ table: "itens", files: [file("2022.txt", "diverge"), file("2023.txt")], phase: "diverge" }];
    const out = addFiles(links, "itens", [pick("2022.txt"), pick("2022.txt")]);
    expect(out[0].files).toEqual([file("2023.txt"), file("2022.txt", "checking")]);
  });

  it("tells apart files with the same name in different folders", () => {
    const out = addFiles([], "itens", [{ folder: "a", file: "itens.csv" }, { folder: "b", file: "itens.csv" }]);
    expect(out[0].files).toHaveLength(2);
  });

  it("replaces the name-based suggestion with what the person chose", () => {
    const out = addFiles([wire("itens", "suggested", "sugerido.csv")], "itens", [pick("2022.txt")]);
    expect(out).toEqual([{ table: "itens", files: [file("2022.txt", "checking")], phase: "checking" }]);
  });

  it("forgets the report of an earlier engage: the table is no longer what was engaged", () => {
    const engaged: Link = { table: "itens", files: [file("2022.txt")], phase: "engaged", report: { table: "itens", ok: true, rowCount: 3, sizeBytes: 1, errors: [], warnings: [] } };
    const [out] = addFiles([engaged], "itens", [pick("2023.txt")]);
    expect(out.phase).toBe("checking");
    expect(out.report).toBeUndefined();
  });

  it("changes nothing while the table is engaging", () => {
    const links: Link[] = [{ table: "itens", files: [file("2022.txt")], phase: "engaging" }];
    expect(addFiles(links, "itens", [pick("2023.txt")])).toEqual(links);
  });
});

describe("removeFile", () => {
  it("takes one file off and the wire follows the files that stay", () => {
    const links: Link[] = [{ table: "itens", files: [file("2022.txt"), file("ruim.txt", "diverge")], phase: "diverge" }];
    expect(removeFile(links, "itens", pick("ruim.txt"))).toEqual([{ table: "itens", files: [file("2022.txt")], phase: "ok" }]);
  });

  it("drops the wire with its last file", () => {
    expect(removeFile([wire("itens", "ok", "2022.txt"), wire("notas", "ok")], "itens", pick("2022.txt"))).toEqual([wire("notas", "ok")]);
  });

  it("leaves an engaged table engaged when the file is not one of its files", () => {
    const links: Link[] = [{ table: "itens", files: [file("2022.txt")], phase: "engaged" }];
    expect(removeFile(links, "itens", pick("outro.txt"))).toEqual(links);
  });

  it("an engaged table with a file taken off must be engaged again", () => {
    const links: Link[] = [{ table: "itens", files: [file("2022.txt"), file("2023.txt")], phase: "engaged" }];
    expect(removeFile(links, "itens", pick("2023.txt"))[0].phase).toBe("ok");
  });
});

describe("setFileCheck", () => {
  const checking: Link[] = [{ table: "itens", files: [file("2022.txt"), file("2023.txt", "checking")], phase: "checking" }];

  it("records the result of one file and updates the wire", () => {
    expect(setFileCheck(checking, "itens", pick("2023.txt"), { state: "ok" })).toEqual([
      { table: "itens", files: [file("2022.txt"), file("2023.txt")], phase: "ok" },
    ]);
  });

  it("says why a file could not be read", () => {
    const [out] = setFileCheck(checking, "itens", pick("2023.txt"), { state: "failed", note: "Arquivo não encontrado nessa pasta." });
    expect(out.phase).toBe("failed");
    expect(out.files[1]).toEqual({ ...file("2023.txt", "failed"), note: "Arquivo não encontrado nessa pasta." });
  });

  it("ignores the answer for a file that was taken off meanwhile", () => {
    const without = removeFile(checking, "itens", pick("2023.txt"));
    expect(setFileCheck(without, "itens", pick("2023.txt"), { state: "diverge" })).toEqual(without);
  });

  it("ignores a late answer for a file that is not being checked", () => {
    const done: Link[] = [{ table: "itens", files: [file("2022.txt")], phase: "engaged" }];
    expect(setFileCheck(done, "itens", pick("2022.txt"), { state: "diverge" })).toEqual(done);
  });
});
