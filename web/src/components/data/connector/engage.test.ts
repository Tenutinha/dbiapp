import { describe, expect, it } from "vitest";
import type { TableReport } from "@/lib/ingest/ingest";
import { engageLink, type Post } from "./engage";
import type { Envelope, Link } from "./types";

const report = (rowCount: number, extra: Partial<TableReport> = {}): TableReport => ({
  table: "itens", ok: true, rowCount, sizeBytes: 1, errors: [], warnings: [], ...extra,
});

const link = (...names: string[]): Link => ({
  table: "itens", phase: "ok", files: names.map((file) => ({ folder: "clientes/acme", file, state: "ok" })),
});

/** A server that answers each action from a script and remembers what it was asked. */
function server(answer: (body: Record<string, unknown>) => Envelope<unknown>) {
  const calls: Record<string, unknown>[] = [];
  const post = (async (body: object) => {
    calls.push(body as Record<string, unknown>);
    return answer(body as Record<string, unknown>);
  }) as Post;
  return { calls, post };
}

describe("engageLink", () => {
  it("engages a single file in one request, as before", async () => {
    const { calls, post } = server(() => ({ success: true, data: report(10) }));
    const steps: string[] = [];
    const res = await engageLink(link("2022.txt"), post, (s) => steps.push(s));

    expect(calls).toEqual([{ action: "engage", folder: "clientes/acme", file: "2022.txt", table: "itens" }]);
    expect(res.data?.rowCount).toBe(10);
    expect(steps).toEqual([]);
  });

  it("converts each file in its own request and then makes the table out of them", async () => {
    const { calls, post } = server((body) =>
      body.action === "part"
        ? { success: true, data: { ...report(5), key: `k-${String(body.file)}` } }
        : { success: true, data: report(10, { files: [{ name: "2022.txt", rowCount: 5 }, { name: "2023.txt", rowCount: 5 }] }) });
    const steps: string[] = [];
    const res = await engageLink(link("2022.txt", "2023.txt"), post, (s) => steps.push(s));

    expect(calls).toEqual([
      { action: "part", folder: "clientes/acme", file: "2022.txt", table: "itens" },
      { action: "part", folder: "clientes/acme", file: "2023.txt", table: "itens" },
      { action: "join", table: "itens", parts: [{ key: "k-2022.txt", file: "2022.txt" }, { key: "k-2023.txt", file: "2023.txt" }] },
    ]);
    expect(steps).toEqual(["Convertendo 1 de 2: 2022.txt", "Convertendo 2 de 2: 2023.txt", "Juntando 2 arquivos"]);
    expect(res.success).toBe(true);
    expect(res.data?.files).toHaveLength(2);
  });

  it("stops at the file that is refused, names it and drops what was converted", async () => {
    const { calls, post } = server((body) => {
      if (body.action === "part" && body.file === "2023.txt") {
        return { success: false, data: report(0, { ok: false, errors: ['Coluna "valor": 3 valores não são do tipo decimal.'] }), error: 'Coluna "valor": 3 valores não são do tipo decimal.' };
      }
      return { success: true, data: { ...report(5), key: `k-${String(body.file)}` } };
    });
    const res = await engageLink(link("2022.txt", "2023.txt", "2024.txt"), post, () => undefined);

    expect(calls.map((c) => c.action)).toEqual(["part", "part", "discard"]);
    expect(calls[2]).toEqual({ action: "discard", table: "itens", keys: ["k-2022.txt"] });
    expect(res.success).toBe(false);
    expect(res.error).toBe('2023.txt: Coluna "valor": 3 valores não são do tipo decimal.');
  });

  it("has nothing to drop when the first file is refused", async () => {
    const { calls, post } = server(() => ({ success: false, error: "Arquivo não encontrado nessa pasta." }));
    const res = await engageLink(link("2022.txt", "2023.txt"), post, () => undefined);

    expect(calls).toHaveLength(1);
    expect(res.error).toBe("2022.txt: Arquivo não encontrado nessa pasta.");
  });

  it("passes on the refusal of the whole (a key repeated between files)", async () => {
    const { post } = server((body) =>
      body.action === "part"
        ? { success: true, data: { ...report(5), key: `k-${String(body.file)}` } }
        : { success: false, data: report(0, { ok: false, errors: ["Chave repetida."] }), error: "Chave repetida." });
    const res = await engageLink(link("a.csv", "b.csv"), post, () => undefined);

    expect(res.success).toBe(false);
    expect(res.error).toBe("Chave repetida.");
  });
});
