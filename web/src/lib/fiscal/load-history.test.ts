import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLiveServer, type LiveState } from "./live-server";
import { compareRuns, listRuns, openRun, readRunLog, runId, withComparison, type ComparedRun, type RunMeta } from "./load-history";
import { eventLine } from "./local-load";

const META: RunMeta = { titulo: "efd · org / cliente", molde: "efd-icms-ipi", org: "Org", cliente: "cliente", opcoes: ["--ao-vivo"] };
const FILE = { cnpj: "11222333000181", periodo: "2024-03" };

/** A clock that walks one minute each time it is asked. */
function clock(start: string): () => Date {
  let t = Date.parse(start) - 60_000;
  return () => new Date((t += 60_000));
}

/** The lines of a load of two files: one read, one refused; `rows` lines in the final table. */
function lines(rows: number, publish: boolean): string[] {
  return [
    "catálogo: já está atualizado",
    eventLine({ passo: { etapa: "quebra", passo: "inicio", ...FILE, sizeBytes: 2048, origem: "disco", posicao: 1, total: 2 } }),
    eventLine({ arquivo: { ...FILE, sizeBytes: 2048, ok: true, rows: { registros: rows }, ms: 900 } }),
    eventLine({ arquivo: { cnpj: FILE.cnpj, periodo: "2024-04", sizeBytes: 1024, ok: false, rows: {}, error: "arquivo cortado" } }),
    eventLine({ passo: { etapa: "uniao", passo: "inicio", tabela: "registros", partes: 1, posicao: 1, total: 1 } }),
    eventLine({ tabela: { table: "registros", ok: true, rows, sizeBytes: 4096, ms: 300 } }),
    ...(publish
      ? [eventLine({ passo: { etapa: "publicacao", passo: "inicio" } }), "  aviso: 3 linhas sem correspondência em registros→itens", "publicado: /org/d/1"]
      : []),
  ];
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "dbi-historico-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("runId", () => {
  it("is safe for a path and a URL, and says when and what", () => {
    expect(runId(new Date("2026-11-17T14:03:22.500Z"), META)).toBe("2026-11-17-14-03-22_efd-icms-ipi_org_cliente");
    expect(runId(new Date("2026-11-17T14:03:22Z"), { molde: "ecd", org: "../x", cliente: null })).toBe("2026-11-17-14-03-22_ecd_x");
  });
});

describe("openRun", () => {
  it("keeps what the load printed and a summary with the time of each step", () => {
    const run = openRun(dir, META, clock("2026-11-17T10:00:00Z"));
    expect(listRuns(dir, () => true)).toMatchObject([{ id: run.id, fase: "rodando", fim: null, arquivos: { lidos: 0 } }]);
    // clock: 10:00 start, 10:01 quebra, 10:02 união, 10:03 publicação, 10:04 end
    for (const line of lines(12_000, true)) run.append(line);
    const summary = run.close(true);
    expect(summary).toMatchObject({
      fase: "concluida",
      duracaoMs: 4 * 60_000,
      etapas: { quebra: 60_000, uniao: 60_000, publicacao: 60_000 },
      arquivos: { lidos: 1, erros: 1, total: 2 },
      linhas: 12_000,
      bytes: 3072,
      tabelas: [{ table: "registros", rows: 12_000 }],
      falhas: [{ cnpj: FILE.cnpj, periodo: "2024-04", error: "arquivo cortado" }],
      avisos: ["aviso: 3 linhas sem correspondência em registros→itens"],
      erro: null,
    });
    expect(listRuns(dir)).toEqual([summary]);
    expect(readRunLog(dir, run.id).split("\n").filter(Boolean)).toEqual(lines(12_000, true));
  });

  it("says why a load stopped, and how far it got", () => {
    const run = openRun(dir, META, clock("2026-11-17T10:00:00Z"));
    for (const line of lines(500, false)) run.append(line);
    expect(run.close(false, "1 arquivo(s) não puderam ser lidos")).toMatchObject({
      fase: "falhou",
      erro: "1 arquivo(s) não puderam ser lidos",
      etapas: { quebra: 60_000, uniao: 60_000, publicacao: null },
    });
  });

  it("marks as interrupted a load whose process is gone, with what it managed to print", () => {
    const run = openRun(dir, META, clock("2026-11-17T10:00:00Z"));
    for (const line of lines(500, false).slice(0, 3)) run.append(line);
    // Still running for whoever sees its process alive.
    expect(listRuns(dir, () => true)[0].fase).toBe("rodando");
    const [gone] = listRuns(dir, () => false);
    expect(gone).toMatchObject({ fase: "interrompida", arquivos: { lidos: 1, erros: 0, total: 2 }, linhas: 500, etapas: { uniao: null } });
    expect(gone.fim).not.toBeNull();
    expect(gone.erro).toContain("sem dizer como");
    // Kept that way: the next listing does not depend on the process any more.
    expect(JSON.parse(readFileSync(path.join(dir, run.id, "resumo.json"), "utf8"))).toMatchObject({ fase: "interrompida" });
  });

  it("never stops a load when the history cannot be written", () => {
    const first = openRun(dir, META, clock("2026-11-17T10:00:00Z"));
    first.close(true);
    // A folder that cannot exist: its parent is a file.
    const run = openRun(path.join(dir, first.id, "resumo.json", "pasta"), META);
    expect(() => run.append("linha")).not.toThrow();
    expect(run.close(true)).toBeNull();
  });
});

describe("comparison", () => {
  it("puts each load next to the one before of the same dashboard", () => {
    const older = openRun(dir, META, clock("2026-11-16T10:00:00Z"));
    for (const line of lines(10_000, true)) older.append(line);
    older.close(true);
    const other = openRun(dir, { ...META, molde: "ecd" }, clock("2026-11-16T12:00:00Z"));
    other.close(true);
    const newer = openRun(dir, META, clock("2026-11-17T10:00:00Z"));
    for (const line of [...lines(12_500, true), eventLine({ tabela: { table: "itens", ok: true, rows: 40, sizeBytes: 10 } })]) newer.append(line);
    newer.close(true);

    const [first, second, third] = withComparison(listRuns(dir));
    expect([first.id, second.id, third.id]).toEqual([newer.id, other.id, older.id]);
    expect(second.comparacao).toBeNull();
    expect(third.comparacao).toBeNull();
    expect(first.comparacao).toEqual({
      anterior: { id: older.id, inicio: "2026-11-16T10:00:00.000Z", fase: "concluida" },
      duracaoMs: 0,
      arquivos: 0,
      linhas: 2_500,
      tabelas: [{ table: "registros", rows: 12_500, antes: 10_000 }, { table: "itens", rows: 40, antes: null }],
    });
    expect(compareRuns(third, first).tabelas).toContainEqual({ table: "itens", rows: null, antes: 40 });
  });
});

describe("live server with a history", () => {
  it("lists the kept loads and shows one of them as it shows the running one", async () => {
    const kept = openRun(dir, META, clock("2026-11-16T10:00:00Z"));
    for (const line of lines(10_000, true)) kept.append(line);
    kept.close(true);
    const live = await startLiveServer({ port: 0, titulo: "agora", history: dir, run: "a-que-roda" });
    try {
      const list = (await (await fetch(`${live.url}/historico`)).json()) as { pasta: string; atual: string; aoVivo: boolean; rodadas: ComparedRun[] };
      expect(list).toMatchObject({ pasta: dir, atual: "a-que-roda", aoVivo: true, rodadas: [{ id: kept.id, comparacao: null }] });

      const state = (await (await fetch(`${live.url}/estado?rodada=${kept.id}`)).json()) as LiveState;
      expect(state).toMatchObject({ titulo: META.titulo, fase: "concluida", rodada: kept.id, guardada: { fase: "concluida" } });
      expect(state.log.live).toMatchObject({ files: 2, failed: 1, rows: 10_000 });
      expect((await (await fetch(`${live.url}/estado`)).json()) as LiveState).toMatchObject({ titulo: "agora", fase: "rodando", rodada: "a-que-roda" });

      // The whole kept load at once, and the stream ends.
      const text = await (await fetch(`${live.url}/eventos?rodada=ultima`)).text();
      expect(text.match(/^event: linha$/gm)).toHaveLength(lines(10_000, true).length);
      expect(text).toContain('event: fim\ndata: {"fase":"concluida"}');

      // Only an id of the list answers: never a path.
      expect((await fetch(`${live.url}/estado?rodada=${encodeURIComponent("../" + kept.id)}`)).status).toBe(404);
      expect((await fetch(`${live.url}/eventos?rodada=nao-existe`)).status).toBe(404);
    } finally {
      await live.finish(true);
    }
  });

  it("with no load running, opens on the last kept one", async () => {
    const live = await startLiveServer({ port: 0, titulo: "Histórico", history: dir, idle: true });
    try {
      expect((await fetch(`${live.url}/estado`)).status).toBe(404);
      const kept = openRun(dir, META, clock("2026-11-16T10:00:00Z"));
      kept.close(false, "parou");
      expect((await (await fetch(`${live.url}/estado`)).json()) as LiveState).toMatchObject({ rodada: kept.id, fase: "falhou", guardada: { fase: "falhou" } });
      expect((await (await fetch(`${live.url}/historico`)).json()) as { atual: null; aoVivo: boolean }).toMatchObject({ atual: null, aoVivo: false });
    } finally {
      await live.finish(true);
    }
  });
});
