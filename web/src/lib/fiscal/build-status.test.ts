import { describe, expect, it } from "vitest";
import { describeBuild, isStale, parseBuildStatus, STALE_AFTER_MS, type BuildStatus } from "./build-status";

const T0 = Date.parse("2026-11-16T16:25:00.000Z"); // 13:25 in São Paulo
const at = (ms: number): string => new Date(T0 + ms).toISOString();
const base = { by: "script", startedAt: at(0), updatedAt: at(60_000) } as const;

describe("parseBuildStatus", () => {
  it("accepts a status and refuses anything else", () => {
    const s: BuildStatus = { ...base, state: "lendo", read: { done: 3, total: 10 } };
    expect(parseBuildStatus(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseBuildStatus({ ...s, state: "parado" })).toBeNull();
    expect(parseBuildStatus({ ...s, by: "outro" })).toBeNull();
    expect(parseBuildStatus({ ...s, read: { done: -1, total: 10 } })).toBeNull();
    expect(parseBuildStatus({ ...s, table: { name: 1, index: 1, total: 2 } })).toBeNull();
    expect(parseBuildStatus(null)).toBeNull();
    expect(parseBuildStatus({ ...base, state: "falhou", error: "x".repeat(900) })?.error).toHaveLength(500);
  });
});

describe("describeBuild", () => {
  it("tells the reading with how many files and a bar", () => {
    const d = describeBuild({ ...base, state: "lendo", read: { done: 3200, total: 9214 } }, T0 + 120_000);
    expect(d).toMatchObject({ tone: "running", title: "Lendo os arquivos pelo script: 3.200 de 9.214" });
    expect(d.detail).toBe("começou às 13:25 · última notícia há 1 min");
    expect(d.progress).toBeCloseTo(3200 / 9214);
  });

  it("tells the table on its way while putting the tables together", () => {
    const d = describeBuild({ ...base, by: "tela", state: "montando", table: { name: "bloco_c_resumo_itens", index: 5, total: 15 } }, T0 + 70_000);
    expect(d.title).toBe("Montando as tabelas pela tela: bloco_c_resumo_itens (5 de 15)");
    expect(d.progress).toBeCloseTo(4 / 15);
  });

  it("warns when a running build has had no news for a while", () => {
    const s: BuildStatus = { ...base, state: "montando", table: { name: "registros", index: 1, total: 15 } };
    const later = Date.parse(s.updatedAt) + STALE_AFTER_MS + 1;
    expect(isStale(s, later)).toBe(true);
    expect(describeBuild(s, later)).toMatchObject({ tone: "warning", title: expect.stringContaining("parece ter parado") });
    expect(isStale({ ...s, state: "concluida" }, later)).toBe(false);
  });

  it("tells how the last build ended", () => {
    expect(describeBuild({ ...base, state: "concluida", files: 9214, finishedAt: at(3_600_000) }, T0)).toEqual({
      tone: "ok", title: "Última montagem pelo script: concluída",
      detail: "16/11 às 14:25 · 9.214 arquivo(s) nas tabelas do rascunho", progress: null,
    });
    expect(describeBuild({ ...base, state: "falhou", error: "Nenhum arquivo enviado ainda.", finishedAt: at(0) }, T0))
      .toMatchObject({ tone: "danger", detail: "16/11 às 13:25 · Nenhum arquivo enviado ainda." });
  });
});
