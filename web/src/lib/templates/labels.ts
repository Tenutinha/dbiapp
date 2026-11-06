/** Display labels for the catalog (safe in client and server components). */

export const ORIGIN_LABEL = { powerbi: "Power BI", qlikview: "QlikView" } as const;

export const STATUS_LABEL = { draft: "Rascunho", published: "Publicado", archived: "Arquivado" } as const;

export const STATUS_CLASS = {
  draft: "bg-accent/15 text-accent",
  published: "bg-ok/15 text-ok",
  archived: "bg-white/5 text-muted",
} as const;
