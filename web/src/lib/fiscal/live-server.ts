/**
 * The load's own little web server: while a load runs on a machine, it serves what it is doing to a browser
 * on that same machine, the moment it happens — no app server in between (the app's development server
 * takes gigabytes the load needs).
 *
 *   GET /eventos  the lines of the load as they are written (Server-Sent Events); a browser that connects
 *                 late, or again, first gets everything it missed.
 *   GET /estado   where the load stands now, as JSON (the same reading the app's screen makes of the log).
 *   GET /         a page that shows both.
 *   GET /historico  the loads kept on this machine (see load-history.ts), each next to the one before.
 *
 * With `?rodada=<id>` (or `ultima`), /eventos and /estado answer for a kept load instead of the running one.
 *
 * It listens on this machine only (127.0.0.1) and shows nothing but the load's own output.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { LIVE_PAGE } from "./live-page";
import { listRuns, readRunLog, withComparison, type RunPhase } from "./load-history";
import { describeEvent, EVENT_MARK, parseLoadLog, type LoadEvent, type LoadLog } from "./local-load";

export interface LiveLine {
  /** Position of the line in the load's output, from 1. */
  id: number;
  /** The line in words (an event described, or the plain line the load printed). */
  texto: string;
  /** "contagem": a step that only counts (lines read, parts gathered) and replaces the previous one of its kind. */
  tipo: "evento" | "contagem" | "linha";
}

export interface LiveState {
  titulo: string;
  /** ISO time the load started. */
  inicio: string;
  /** "rodando" until the load says how it ended. */
  fase: "rodando" | "concluida" | "falhou";
  log: LoadLog;
  /** The id this load has in the history (absent: it keeps none). */
  rodada?: string;
  /** Set when this is a kept load, not the running one: when and how it ended. */
  guardada?: { fim: string | null; fase: RunPhase };
}

export interface LiveServer {
  url: string;
  port: number;
  /** One line of the load's output (an `@evento` line or a plain one). */
  publish(line: string): void;
  /** The load is over: tells the browsers and stops accepting new ones after they got it. */
  finish(ok: boolean): Promise<void>;
}

/** Ports tried, in order, when the first one is taken (two loads at the same time). */
const PORTS_TRIED = 10;
/** The state is pushed to the browsers at most this often. */
const STATE_EVERY_MS = 1000;
/** How long the browsers get to receive the end before the server closes. */
const LINGER_MS = 1500;

/** Lines of a kept load sent to a browser (the page keeps no more than that). */
const REPLAY_LINES = 5000;
/** Loads listed in the history. */
const HISTORY_RUNS = 100;

const COUNTING = new Set(["lendo", "partes"]);

/** A line of the load's output as the terminal shows it. */
export function toLiveLine(id: number, line: string): LiveLine {
  if (!line.startsWith(EVENT_MARK)) return { id, texto: line, tipo: "linha" };
  try {
    const event = JSON.parse(line.slice(EVENT_MARK.length)) as LoadEvent;
    const counting = "passo" in event && COUNTING.has(event.passo.passo);
    return { id, texto: describeEvent(event), tipo: counting ? "contagem" : "evento" };
  } catch {
    return { id, texto: line, tipo: "linha" };
  }
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Only pages of this machine may read the load from another origin (the app's local screen). */
function corsOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  return origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : null;
}

export interface LiveOptions {
  port: number;
  titulo: string;
  page?: string;
  /** Folder of the kept loads (absent: the server shows no history). */
  history?: string;
  /** The id the running load has in that folder. */
  run?: string;
  /** No load is running: the server only shows the history, opening on the last one. */
  idle?: boolean;
}

export async function startLiveServer(options: LiveOptions): Promise<LiveServer> {
  const lines: string[] = [];
  const clients = new Set<ServerResponse>();
  const inicio = new Date().toISOString();
  let fase: LiveState["fase"] = "rodando";
  let lastState = 0;
  let stateTimer: NodeJS.Timeout | null = null;

  const state = (): LiveState => ({ titulo: options.titulo, inicio, fase, log: parseLoadLog(lines.join("\n")), ...(options.run ? { rodada: options.run } : {}) });
  /** A kept load, by the id the list gave (never a path), as the page reads the running one. */
  const kept = (asked: string): { state: LiveState; lines: string[] } | null => {
    if (!options.history) return null;
    const runs = listRuns(options.history);
    const run = asked === "ultima" ? runs[0] : runs.find((r) => r.id === asked);
    if (!run) return null;
    const text = readRunLog(options.history, run.id);
    return {
      state: { titulo: run.titulo, inicio: run.inicio, fase: run.fase === "concluida" ? "concluida" : run.fase === "rodando" ? "rodando" : "falhou", log: parseLoadLog(text), rodada: run.id, guardada: { fim: run.fim, fase: run.fase } },
      lines: text.split(/\r?\n/).filter((line) => line.trim() !== ""),
    };
  };
  const send = (res: ServerResponse, event: string, data: unknown, id?: number): void => {
    res.write(`${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const pushState = (): void => {
    stateTimer = null;
    lastState = Date.now();
    const now = state();
    for (const res of clients) send(res, "estado", now);
  };
  /** The state follows the lines, but a burst of them (a big file) sends it once. */
  const scheduleState = (): void => {
    if (stateTimer || clients.size === 0) return;
    stateTimer = setTimeout(pushState, Math.max(0, STATE_EVERY_MS - (Date.now() - lastState)));
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const origin = corsOrigin(req);
    const cors: Record<string, string> = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
    if (req.method !== "GET") {
      res.writeHead(405, cors).end();
      return;
    }
    const asked = url.searchParams.get("rodada") ?? (options.idle ? "ultima" : null);
    if (url.pathname === "/historico") {
      const rodadas = options.history ? withComparison(listRuns(options.history)).slice(0, HISTORY_RUNS) : [];
      res.writeHead(200, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
        .end(JSON.stringify({ pasta: options.history ?? null, atual: options.idle ? null : (options.run ?? null), aoVivo: !options.idle, rodadas }));
      return;
    }
    if (asked !== null && (url.pathname === "/estado" || url.pathname === "/eventos")) {
      const run = kept(asked);
      if (!run) {
        res.writeHead(404, cors).end();
        return;
      }
      if (url.pathname === "/estado") {
        res.writeHead(200, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(run.state));
        return;
      }
      // A kept load is told at once, whole, and the stream ends (even one another process is still running).
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" });
      for (let i = Math.max(0, run.lines.length - REPLAY_LINES); i < run.lines.length; i += 1) send(res, "linha", toLiveLine(i + 1, run.lines[i]), i + 1);
      send(res, "estado", run.state);
      send(res, "fim", { fase: run.state.fase });
      res.end();
      return;
    }
    if (url.pathname === "/estado") {
      res.writeHead(200, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(state()));
      return;
    }
    if (url.pathname === "/eventos") {
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
      // What the browser already has (it reconnects by itself and says the last line it got).
      const last = Number(req.headers["last-event-id"] ?? url.searchParams.get("desde") ?? 0);
      const from = Number.isInteger(last) && last > 0 ? last : 0;
      for (let i = from; i < lines.length; i += 1) send(res, "linha", toLiveLine(i + 1, lines[i]), i + 1);
      send(res, "estado", state());
      if (fase !== "rodando") {
        send(res, "fim", { fase });
        res.end();
        return;
      }
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(options.page ?? LIVE_PAGE);
      return;
    }
    res.writeHead(404, cors).end();
  });

  let port = 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      // Port 0 asks the system for any free one (the tests).
      port = await listen(server, options.port === 0 ? 0 : options.port + attempt);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt + 1 >= PORTS_TRIED || options.port === 0) throw err;
    }
  }

  return {
    url: `http://localhost:${port}`,
    port,
    publish(line: string): void {
      lines.push(line);
      const live = toLiveLine(lines.length, line);
      for (const res of clients) send(res, "linha", live, live.id);
      scheduleState();
    },
    async finish(ok: boolean): Promise<void> {
      fase = ok ? "concluida" : "falhou";
      if (stateTimer) clearTimeout(stateTimer);
      pushState();
      for (const res of clients) {
        send(res, "fim", { fase });
        res.end();
      }
      clients.clear();
      await new Promise((resolve) => setTimeout(resolve, LINGER_MS));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
