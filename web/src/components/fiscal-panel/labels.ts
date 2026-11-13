import type { FileState } from "@/lib/fiscal/panel";

/** How each file state reads on screen, and its color (a CSS color, so the map's cells can use it). */
export const STATE_LABEL: Record<FileState, { label: string; color: string; hint: string }> = {
  pronto: { label: "Lido", color: "var(--color-ok)", hint: "já lido: entra nas tabelas" },
  falta: { label: "Falta ler", color: "var(--color-brand-2)", hint: "novo ou trocado, ainda não lido" },
  erro: { label: "Com erro", color: "var(--color-danger)", hint: "a última leitura falhou" },
  script: { label: "Pelo script", color: "var(--color-accent)", hint: "grande demais para a tela: carregado pelo script" },
  guardado: { label: "Guardado", color: "var(--color-muted)", hint: "NF-e: lida inteira a cada montagem" },
};

export const STATE_ORDER: readonly FileState[] = ["pronto", "falta", "erro", "script", "guardado"];

export const periodLabel = (p: string): string => `${p.slice(5, 7)}/${p.slice(0, 4)}`;

export const taxIdLabel = (d: string): string =>
  d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d;

export const count = (n: number): string => n.toLocaleString("pt-BR");
