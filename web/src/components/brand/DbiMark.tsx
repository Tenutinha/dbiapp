/** Navy of the DBI lettering in the company logo. */
export const DBI_NAVY = "#0c1a62";

/** Lighter blue of the last column, readable on the navy tile. */
const DBI_ACCENT = "#6f93ff";

/**
 * Data columns that draw the letter D, left to right (64×64 grid, centred vertically).
 * Keep in sync with scripts/brand/gerar-icones.mjs.
 */
const BARS = [
  { x: 8.5, height: 40, fill: "#fff" },
  { x: 18.5, height: 40, fill: "#fff" },
  { x: 28.5, height: 37, fill: "#fff" },
  { x: 38.5, height: 29, fill: "#fff" },
  { x: 48.5, height: 15, fill: DBI_ACCENT },
] as const;
const BAR_WIDTH = 7;
const CENTER = 32;

interface DbiMarkProps {
  /** Tailwind size of the tile (it is square). */
  className?: string;
}

/**
 * The DBI symbol: data columns drawing a "D" on a navy tile. Its colours are fixed (never the space's theme),
 * so it looks the same on the platform, inside a customer's space and in the favicon.
 */
export function DbiMark({ className = "size-7" }: DbiMarkProps) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden>
      <rect width="64" height="64" rx="14" fill={DBI_NAVY} />
      {BARS.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={CENTER - bar.height / 2}
          width={BAR_WIDTH}
          height={bar.height}
          rx="2"
          fill={bar.fill}
        />
      ))}
    </svg>
  );
}
