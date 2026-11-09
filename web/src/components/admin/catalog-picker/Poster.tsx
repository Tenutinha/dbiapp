import type { PickerItem } from "@/lib/catalog-picker";

/** Background of a dashboard's cover: one hue per subject, so dashboards of the same area look related. */
export function posterBackground(h: number): string {
  return `radial-gradient(120% 90% at 85% 10%, hsl(${(h + 40) % 360} 85% 55% / 0.55), transparent 60%),
    linear-gradient(135deg, hsl(${h} 70% 30%), hsl(${(h + 60) % 360} 75% 14%))`;
}

/** Abstract drawing of the dashboard's visuals (bars, line, donut, map dots, a big KPI) — no screenshots needed. */
function Glyphs({ kinds }: { kinds: PickerItem["visualKinds"] }) {
  return (
    <svg viewBox="0 0 160 90" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {kinds.map && (
        <g fill="white" opacity="0.22">
          {Array.from({ length: 7 }, (_, r) =>
            Array.from({ length: 9 }, (_, c) => {
              const inside = (c - 4) ** 2 / 20 + (r - 3) ** 2 / 9 < 1;
              return inside ? <circle key={`${r}-${c}`} cx={92 + c * 6} cy={14 + r * 6} r={1.8} /> : null;
            }),
          )}
        </g>
      )}
      {kinds.bar && (
        <g fill="white" opacity="0.32">
          {[22, 34, 18, 42, 30, 50].map((height, i) => (
            <rect key={i} x={10 + i * 9} y={78 - height} width={6} height={height} rx={1.5} />
          ))}
        </g>
      )}
      {kinds.line && (
        <path d="M8 70 C 30 52, 44 64, 62 44 S 98 30, 120 36 S 146 18, 156 14" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="2.2" />
      )}
      {kinds.donut && (
        <g transform="translate(132 62)" fill="none" strokeWidth="7">
          <circle r="14" stroke="white" strokeOpacity="0.18" />
          <circle r="14" stroke="white" strokeOpacity="0.5" strokeDasharray="52 88" transform="rotate(-90)" />
        </g>
      )}
      {kinds.kpi && (
        <text x="10" y="26" fill="white" fillOpacity="0.5" fontSize="17" fontWeight="800" fontFamily="system-ui">
          {kinds.kpi > 3 ? "+87%" : "1,2M"}
        </text>
      )}
    </svg>
  );
}

interface PosterProps {
  item: PickerItem;
  /** Cover hue of the item's subject (see areaHues). */
  hue: number;
  /** Bigger title for the featured (hero) poster. */
  large?: boolean;
  className?: string;
}

/** 16:9 cover of a catalog dashboard: subject colour, drawn visuals, subject tag and name. */
export function Poster({ item, hue, large = false, className = "" }: PosterProps) {
  return (
    <div className={`relative aspect-video overflow-hidden rounded-xl ${className}`} style={{ background: posterBackground(hue) }}>
      <Glyphs kinds={item.visualKinds} />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 to-transparent" />
      <span className="absolute left-2.5 top-2.5 rounded-md bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
        {item.area}
      </span>
      <p className={`absolute inset-x-3 bottom-2.5 font-bold leading-tight text-white drop-shadow ${large ? "text-2xl" : "line-clamp-2 text-sm"}`}>
        {item.name}
      </p>
    </div>
  );
}
