import { describe, expect, it } from "vitest";
import { startLiveServer, toLiveLine, type LiveState } from "./live-server";
import { eventLine } from "./local-load";

const FILE = { cnpj: "11222333000181", periodo: "2024-03" };
const START = eventLine({ passo: { etapa: "quebra", passo: "inicio", ...FILE, sizeBytes: 1024 ** 2, origem: "disco", posicao: 1, total: 2 } });
const READING = eventLine({ passo: { etapa: "quebra", passo: "lendo", ...FILE, linhas: 10_000 } });
const DONE = eventLine({ arquivo: { ...FILE, sizeBytes: 1024 ** 2, ok: true, rows: { registros: 12_000 }, ms: 900 } });

/** Reads Server-Sent Events off a response until `done` says so (or the stream ends). */
async function readEvents(res: Response, done: (events: { event: string; data: unknown }[]) => boolean): Promise<{ event: string; data: unknown }[]> {
  const events: { event: string; data: unknown }[] = [];
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done: ended } = await reader.read();
    if (ended) break;
    buffer += decoder.decode(value, { stream: true });
    for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? "message";
      const data = /^data: (.+)$/m.exec(block)?.[1];
      events.push({ event, data: data ? JSON.parse(data) : null });
    }
    if (done(events)) {
      await reader.cancel();
      break;
    }
  }
  return events;
}

describe("toLiveLine", () => {
  it("puts an event in words and tells a count from a step", () => {
    expect(toLiveLine(1, START)).toEqual({ id: 1, tipo: "evento", texto: "▶ arquivo 1 de 2 · 11222333000181 03/2024 · 1 MB · lido do disco desta máquina" });
    expect(toLiveLine(2, READING)).toMatchObject({ id: 2, tipo: "contagem", texto: "  11222333000181 03/2024: 10.000 linhas lidas" });
    expect(toLiveLine(3, "catálogo: já está atualizado")).toEqual({ id: 3, tipo: "linha", texto: "catálogo: já está atualizado" });
    expect(toLiveLine(4, "@evento {quebrado")).toMatchObject({ tipo: "linha" });
  });
});

describe("live server", () => {
  it("serves the state, replays what a late browser missed and follows the load to its end", async () => {
    const live = await startLiveServer({ port: 0, titulo: "EFD · teste" });
    try {
      live.publish(START);
      live.publish(READING);

      const state = (await (await fetch(`${live.url}/estado`)).json()) as LiveState;
      expect(state).toMatchObject({ titulo: "EFD · teste", fase: "rodando" });
      expect(state.log.live?.file).toMatchObject({ ...FILE, linhas: 10_000 });

      const page = await fetch(live.url);
      expect(page.headers.get("content-type")).toContain("text/html");
      const html = await page.text();
      // The page of the four steps, fed by the stream; self-contained (nothing fetched from elsewhere).
      for (const piece of ["new EventSource(\"/eventos\"", "Quebra em blocos", "União por bloco", "Publicação", "id=\"terminal\"", "Histórico das conversões", "fetch(\"/historico\")"]) expect(html).toContain(piece);
      expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=/);

      // A browser that connects now gets the two lines it missed, then what comes.
      const stream = await fetch(`${live.url}/eventos`);
      expect(stream.headers.get("content-type")).toContain("text/event-stream");
      const reading = readEvents(stream, (events) => events.some((e) => e.event === "fim"));
      await new Promise((r) => setTimeout(r, 50));
      live.publish(DONE);
      await live.finish(true);
      const events = await reading;
      expect(events.filter((e) => e.event === "linha").map((e) => (e.data as { id: number }).id)).toEqual([1, 2, 3]);
      expect(events.at(-1)).toEqual({ event: "fim", data: { fase: "concluida" } });
      const last = events.filter((e) => e.event === "estado").at(-1)?.data as LiveState;
      expect(last.fase).toBe("concluida");
      expect(last.log.live).toMatchObject({ files: 1, rows: 12_000, file: null });
    } finally {
      await live.finish(true).catch(() => undefined);
    }
  });

  it("sends only what is new to a browser that reconnects, and answers pages of this machine only", async () => {
    const live = await startLiveServer({ port: 0, titulo: "t" });
    try {
      live.publish(START);
      live.publish(READING);
      const stream = await fetch(`${live.url}/eventos`, { headers: { "Last-Event-ID": "1" } });
      const events = await readEvents(stream, (all) => all.some((e) => e.event === "estado"));
      expect(events.filter((e) => e.event === "linha").map((e) => (e.data as { id: number }).id)).toEqual([2]);

      const local = await fetch(`${live.url}/estado`, { headers: { Origin: "http://localhost:3020" } });
      expect(local.headers.get("access-control-allow-origin")).toBe("http://localhost:3020");
      const other = await fetch(`${live.url}/estado`, { headers: { Origin: "https://exemplo.com" } });
      expect(other.headers.get("access-control-allow-origin")).toBeNull();
      expect((await fetch(`${live.url}/estado`, { method: "POST" })).status).toBe(405);
      expect((await fetch(`${live.url}/outro`)).status).toBe(404);
    } finally {
      await live.finish(false);
    }
  });
});
