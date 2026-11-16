import { describe, expect, it } from "vitest";
import { describeEvent, eventLine, loadPhase, parseLoadLog, type StepEvent } from "./local-load";

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

  it("follows a file being read and a table being put together, step by step", () => {
    const file = { cnpj: "11222333000181", periodo: "2024-03" };
    const steps: StepEvent[] = [
      { etapa: "quebra", passo: "inicio", ...file, sizeBytes: 2 * 1024 ** 2, origem: "disco", posicao: 2, total: 5 },
      { etapa: "quebra", passo: "lendo", ...file, linhas: 10_000 },
      { etapa: "quebra", passo: "lendo", ...file, linhas: 20_000 },
      { etapa: "quebra", passo: "bloco", ...file, tabela: "bloco_c", linhas: 800 },
    ];
    const reading = parseLoadLog(steps.map((passo) => eventLine({ passo })).join("\n")).live;
    expect(reading?.stage).toBe("quebra");
    expect(reading?.file).toMatchObject({ ...file, origem: "disco", posicao: 2, total: 5, linhas: 20_000, blocos: [{ tabela: "bloco_c", linhas: 800 }] });
    // The counts of lines of one file take one line of the terminal, the last one.
    expect(reading?.feed).toEqual([
      "▶ arquivo 2 de 5 · 11222333000181 03/2024 · 2 MB · lido do disco desta máquina",
      "  11222333000181 03/2024: 20.000 linhas lidas",
      "  11222333000181 03/2024: bloco bloco_c gravado, 800 linhas",
    ]);

    const after: string[] = [
      ...steps.map((passo) => eventLine({ passo })),
      eventLine({ arquivo: { ...file, sizeBytes: 2 * 1024 ** 2, ok: true, rows: { bloco_c: 800, itens: 0 }, ms: 1500 } }),
      eventLine({ passo: { etapa: "uniao", passo: "inicio", tabela: "bloco_c", partes: 300, posicao: 1, total: 4 } }),
      eventLine({ passo: { etapa: "uniao", passo: "partes", tabela: "bloco_c", feitas: 100, total: 300 } }),
      eventLine({ passo: { etapa: "uniao", passo: "partes", tabela: "bloco_c", feitas: 300, total: 300 } }),
      eventLine({ passo: { etapa: "uniao", passo: "juntando", tabela: "bloco_c", ano: "2024" } }),
      eventLine({ passo: { etapa: "uniao", passo: "ano", tabela: "bloco_c", ano: "2024", linhas: 900, reaproveitado: false } }),
    ];
    const joining = parseLoadLog(after.join("\n")).live;
    expect(joining?.stage).toBe("uniao");
    expect(joining?.file).toBeNull();
    expect(joining?.table).toMatchObject({ tabela: "bloco_c", posicao: 1, total: 4, partes: 300, feitas: 300, fase: "juntando", anos: [{ ano: "2024", linhas: 900, reaproveitado: false }] });
    expect(joining?.feed.slice(3)).toEqual([
      "✓ 11222333000181 03/2024: pronto, 800 linhas em 1 tabelas em 1,5 s",
      "▶ tabela 1 de 4 · bloco_c · unindo 300 parte(s)",
      "  bloco_c: 300 de 300 partes reunidas",
      "  bloco_c: juntando e ordenando o ano 2024",
      "  bloco_c: ano 2024 gravado, 900 linhas",
    ]);

    const done = parseLoadLog([
      ...after,
      eventLine({ tabela: { table: "bloco_c", ok: true, rows: 900, sizeBytes: 3 * 1024 ** 2, ms: 2000 } }),
      eventLine({ passo: { etapa: "publicacao", passo: "inicio" } }),
      eventLine({ passo: { etapa: "publicacao", passo: "fim", avisos: ["1 linha sem correspondência"] } }),
    ].join("\n")).live;
    expect(done?.stage).toBe("publicacao");
    expect(done?.table).toBeNull();
    expect(done?.feed.slice(-3)).toEqual([
      "✓ bloco_c: tabela pronta, 900 linhas, 3 MB em 2 s",
      "▶ publicando as tabelas no dashboard",
      "✓ publicado com 1 aviso(s)",
    ]);
  });

  it("says a failed file and a refused table in words", () => {
    expect(describeEvent({ arquivo: { cnpj: "11222333000181", periodo: "2024-06", sizeBytes: 1, ok: false, rows: {}, error: "sem 0000" } }))
      .toBe("✕ 11222333000181 06/2024: não foi lido — sem 0000");
    expect(describeEvent({ tabela: { table: "itens", ok: false, rows: 0, sizeBytes: 0 } })).toBe("✕ itens: a tabela não passou na validação");
    expect(describeEvent({ passo: { etapa: "uniao", passo: "ano", tabela: "bloco_c", ano: "2023", linhas: 10, reaproveitado: true } }))
      .toBe("  bloco_c: ano 2023 sem mudança, reaproveitado, 10 linhas");
  });

  it("copes with an empty log", () => {
    expect(parseLoadLog("")).toMatchObject({ read: null, summary: null, tables: [], published: false, tail: [], live: null });
  });
});
