import { describe, expect, it } from "vitest";
import { eventLine, loadPhase, parseLoadLog } from "./local-load";

const RUNNING = [
  'catálogo: "efd-icms-ipi" já está atualizado',
  "  lidos 25 de 1292 (1.1 min)",
  "  lidos 50 de 1292 (2.0 min)",
].join("\n");

const DONE = [
  RUNNING,
  "  lidos 1292 de 1292 (45.2 min)",
  "arquivos no dashboard: 10506: 2 lidos agora, 10504 já lidos antes (0 organizados da pasta do espaço) em 1493 s",
  "  pulado fiscal/efd/x.txt: arquivo sem registro 0000",
  "  registros: 1.125.353 linhas, 19.4 MB",
  "  bloco_b_iss: ERRO coluna obrigatória vazia",
  "  aviso: 12 linhas sem correspondência em registros.cnpj → estabelecimentos",
  "publicado: /acme/d/3f9a2c1b",
].join("\r\n");

describe("parseLoadLog", () => {
  it("follows the reading while the load runs", () => {
    const log = parseLoadLog(RUNNING);
    expect(log.read).toEqual({ done: 50, total: 1292, minutes: 2 });
    expect(log.published).toBe(false);
    expect(log.tables).toEqual([]);
    expect(log.tail).toEqual(['catálogo: "efd-icms-ipi" já está atualizado']);
    expect(loadPhase(true, log)).toBe("rodando");
    expect(loadPhase(false, log)).toBe("falhou");
  });

  it("lists the tables, the warnings and the publication when it ends", () => {
    const log = parseLoadLog(DONE);
    expect(log.read?.done).toBe(1292);
    expect(log.summary).toMatch(/^arquivos no dashboard: 10506/);
    expect(log.tables).toEqual([
      { table: "registros", ok: true, detail: "1.125.353 linhas, 19.4 MB" },
      { table: "bloco_b_iss", ok: false, detail: "ERRO coluna obrigatória vazia" },
    ]);
    expect(log.warnings).toHaveLength(2);
    expect(log.published).toBe(true);
    expect(loadPhase(false, log)).toBe("concluida");
  });

  it("adds up the files as the load reports them", () => {
    const log = parseLoadLog([
      eventLine({ arquivo: { cnpj: "11222333000181", periodo: "2024-01", sizeBytes: 100, ok: true, rows: { registros: 10, bloco_c: 4, itens: 2 } } }),
      "  lidos 1 de 3 (0.1 min)",
      eventLine({ arquivo: { cnpj: "11222333000181", periodo: "2024-02", sizeBytes: 50, ok: true, rows: { registros: 30, bloco_c: 0 } } }),
      eventLine({ arquivo: { cnpj: "11222333000262", periodo: "2024-01", sizeBytes: 7, ok: false, rows: {}, error: "sem 0000" } }),
      eventLine({ tabela: { table: "registros", ok: true, rows: 40, sizeBytes: 900 } }),
      "@evento {\"arquivo\":{\"cnpj\":\"1122", // cut while being written
    ].join("\n"));
    expect(log.live).toMatchObject({ files: 3, failed: 1, bytes: 157, rows: 46 });
    expect(log.live?.byTable).toEqual([
      { table: "registros", rows: 40, files: 2 },
      { table: "bloco_c", rows: 4, files: 1 },
      { table: "itens", rows: 2, files: 1 },
    ]);
    expect(log.live?.recent.map((f) => f.periodo)).toEqual(["2024-01", "2024-02", "2024-01"]);
    expect(log.live?.recent[0].ok).toBe(false);
    expect(log.live?.assembled).toEqual([{ table: "registros", ok: true, rows: 40, sizeBytes: 900 }]);
    expect(log.read?.done).toBe(1);
    expect(log.tail).toEqual([]);
  });

  it("copes with an empty log", () => {
    expect(parseLoadLog("")).toMatchObject({ read: null, summary: null, tables: [], published: false, tail: [], live: null });
  });
});
