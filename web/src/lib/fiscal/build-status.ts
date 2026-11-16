/**
 * Where a "Montar tabelas" of a SPED dashboard stands, wherever it runs (the script on a machine, or a
 * request of the app): reading the files, putting the tables together, done or failed. Kept as
 * <dashboard>/montagem.json and shown by the panel of fiscal data, which otherwise only sees the parts.
 * Pure: the service writes it, the panel reads and describes it.
 */

export type BuildState = "lendo" | "montando" | "concluida" | "falhou";
export type BuildRunner = "script" | "tela";

export interface BuildStatus {
  state: BuildState;
  by: BuildRunner;
  /** ISO times. */
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** While reading: files read (or skipped) and files to read. */
  read?: { done: number; total: number };
  /** While putting the tables together: the table on its way, its position and how many tables. */
  table?: { name: string; index: number; total: number };
  /** Files in the tables (when done). */
  files?: number;
  error?: string;
}

/** Without news for this long, a build that says it is running probably stopped (the machine, the request). */
export const STALE_AFTER_MS = 20 * 60 * 1000;

export const isActive = (s: BuildStatus): boolean => s.state === "lendo" || s.state === "montando";

export function isStale(s: BuildStatus, now: number): boolean {
  return isActive(s) && now - Date.parse(s.updatedAt) > STALE_AFTER_MS;
}

/** Checks a status read back from storage (it may come from an older release, or be broken). */
export function parseBuildStatus(value: unknown): BuildStatus | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<BuildStatus>;
  const states: readonly BuildState[] = ["lendo", "montando", "concluida", "falhou"];
  if (!states.includes(s.state as BuildState) || (s.by !== "script" && s.by !== "tela")) return null;
  if (typeof s.startedAt !== "string" || typeof s.updatedAt !== "string") return null;
  const count = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x) && x >= 0;
  if (s.read && !(count(s.read.done) && count(s.read.total))) return null;
  if (s.table && !(typeof s.table.name === "string" && count(s.table.index) && count(s.table.total))) return null;
  return {
    ...s,
    ...(typeof s.error === "string" ? { error: s.error.slice(0, 500) } : {}),
  } as BuildStatus;
}

const minutes = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "agora há pouco";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return `há ${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
};

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

export interface BuildDescription {
  tone: "running" | "ok" | "danger" | "warning";
  /** "Montando as tabelas pelo script: bloco_c (5 de 15)". */
  title: string;
  /** "começou às 13:25 · última notícia há 1 min". */
  detail: string;
  /** 0–1 when the step has a known size. */
  progress: number | null;
}

/** The status in words, for the panel. */
export function describeBuild(s: BuildStatus, now: number): BuildDescription {
  const by = s.by === "script" ? "pelo script" : "pela tela";
  const since = `começou às ${time(s.startedAt)}`;
  if (isActive(s)) {
    const stale = isStale(s, now);
    const news = `última notícia ${minutes(now - Date.parse(s.updatedAt))}`;
    const step = s.state === "lendo"
      ? `Lendo os arquivos ${by}${s.read ? `: ${s.read.done.toLocaleString("pt-BR")} de ${s.read.total.toLocaleString("pt-BR")}` : ""}`
      : `Montando as tabelas ${by}${s.table ? `: ${s.table.name} (${s.table.index} de ${s.table.total})` : ""}`;
    const progress = s.state === "lendo" && s.read && s.read.total > 0 ? s.read.done / s.read.total
      : s.state === "montando" && s.table && s.table.total > 0 ? (s.table.index - 1) / s.table.total : null;
    return stale
      ? { tone: "warning", title: `${step} — parece ter parado`, detail: `${since} · ${news}. Se ninguém está rodando a carga, monte de novo.`, progress }
      : { tone: "running", title: step, detail: `${since} · ${news}`, progress };
  }
  const end = s.finishedAt ?? s.updatedAt;
  if (s.state === "falhou") {
    return { tone: "danger", title: `A última montagem (${by}) falhou`, detail: `${day(end)} às ${time(end)}${s.error ? ` · ${s.error}` : ""}`, progress: null };
  }
  return {
    tone: "ok",
    title: `Última montagem ${by}: concluída`,
    detail: `${day(end)} às ${time(end)}${s.files !== undefined ? ` · ${s.files.toLocaleString("pt-BR")} arquivo(s) nas tabelas do rascunho` : ""}`,
    progress: null,
  };
}
