import type { StatementIcon as IconName } from "@/lib/templates/schema";

/** Stroke paths (24×24 grid) of each statement icon. */
const PATHS: Record<IconName, string[]> = {
  receita: ["M12 3v18", "M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.7 5 3.3 5 1.4 5 3.4-2.2 3.3-5 3.3-5-1.2-5-3.1"],
  deducao: ["M5 12h14", "M4 4l16 16"],
  custo: ["M3 7l9-4 9 4-9 4-9-4z", "M3 7v10l9 4 9-4V7", "M12 11v10"],
  lucro: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
  despesa: ["M3 7l6 6 4-4 8 8", "M15 17h6v-6"],
  operacional: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v3", "M12 19v3", "M2 12h3", "M19 12h3", "M4.9 4.9l2.1 2.1", "M17 17l2.1 2.1", "M4.9 19.1L7 17", "M17 7l2.1-2.1"],
  financeiro: ["M3 21h18", "M4 10h16", "M12 3l8 5H4l8-5z", "M6 10v8", "M10 10v8", "M14 10v8", "M18 10v8"],
  outros: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  participacao: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6", "M16 5.5a3 3 0 0 1 0 5.5", "M18 14c1.8.8 3 2.6 3 4.7"],
  imposto: ["M6 3h12v18l-3-2-3 2-3-2-3 2V3z", "M9 8h6", "M9 12h6", "M9 16h3"],
  resultado: ["M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7L12 3z"],
};

export function StatementIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`h-4 w-4 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
