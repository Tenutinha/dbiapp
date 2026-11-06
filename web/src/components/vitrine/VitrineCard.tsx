import Link from "next/link";
import { ORIGIN_LABEL } from "@/lib/templates/labels";
import type { VitrineItem } from "@/lib/vitrine";

interface VitrineCardProps {
  item: VitrineItem;
}

/** One showcase dashboard: origin, area, description and the tables it expects. */
export function VitrineCard({ item }: VitrineCardProps) {
  return (
    <Link href={`/vitrine/${item.id}`} className="card group flex flex-col gap-3 p-5 transition hover:border-brand/60">
      <div className="flex items-center justify-between text-xs">
        <span className={`rounded-md px-2 py-0.5 font-semibold ${item.origin === "powerbi" ? "bg-accent/15 text-accent" : "bg-ok/15 text-ok"}`}>
          {ORIGIN_LABEL[item.origin]}
        </span>
        <span className="text-muted">{item.area}</span>
      </div>
      <h2 className="text-lg font-bold tracking-tight group-hover:text-brand-2">{item.name}</h2>
      <p className="text-sm text-muted">{item.description}</p>
      <div className="flex flex-wrap gap-1.5">
        {item.tables.map((t) => (
          <code key={t} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">{t}</code>
        ))}
      </div>
      <span className="mt-auto pt-2 text-sm font-semibold text-brand-2">Ver detalhes e adicionar →</span>
    </Link>
  );
}
