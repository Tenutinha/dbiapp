/** Colours of the 3D network map, read from the page's theme tokens so it follows light and dark. */

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

export interface NetworkTheme {
  bg: Rgb;
  card: Rgb;
  line: Rgb;
  text: Rgb;
  muted: Rgb;
  dark: boolean;
}

/** Kinds of place (head office, branches, distribution centres, suppliers…), the largest first. */
export const KIND_PALETTE: readonly Rgb[] = [
  [124, 92, 255], [34, 211, 238], [245, 158, 11], [34, 197, 94], [236, 72, 153], [239, 68, 68], [132, 204, 22], [168, 85, 247],
];

/** Kinds of relationship (supply, transfer, sale…): the arcs. */
export const CATEGORY_PALETTE: readonly Rgb[] = [
  [56, 189, 248], [251, 146, 60], [74, 222, 128], [244, 114, 182], [250, 204, 21], [167, 139, 250], [45, 212, 191], [248, 113, 113],
];

export function parseColor(value: string, fallback: Rgb): Rgb {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback;
}

const luminance = ([r, g, b]: Rgb): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function readTheme(el: Element): NetworkTheme {
  const css = getComputedStyle(el);
  const token = (name: string, fallback: Rgb): Rgb => parseColor(css.getPropertyValue(name), fallback);
  const bg = token("--color-bg", [7, 9, 15]);
  return {
    bg,
    card: token("--color-card", [17, 22, 35]),
    line: token("--color-line", [34, 42, 61]),
    text: token("--color-text", [232, 236, 245]),
    muted: token("--color-muted", [141, 151, 173]),
    dark: luminance(bg) < 0.5,
  };
}

export const css = ([r, g, b]: Rgb, alpha = 1): string => `rgba(${r}, ${g}, ${b}, ${alpha})`;

export const withAlpha = ([r, g, b]: Rgb, a: number): Rgba => [r, g, b, Math.round(a)];

/** A colour moved towards white (amount 0–1): the end of an arc that arrives. */
export const lighten = ([r, g, b]: Rgb, amount: number): Rgb => [
  Math.round(r + (255 - r) * amount), Math.round(g + (255 - g) * amount), Math.round(b + (255 - b) * amount),
];

/** Colour per name, in the order given, cycling through the palette. */
export function colorMap(names: readonly string[], palette: readonly Rgb[]): Map<string, Rgb> {
  return new Map(names.map((name, i) => [name, palette[i % palette.length]]));
}
