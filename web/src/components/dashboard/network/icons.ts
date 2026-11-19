/**
 * Drawings of the places of the 3D network map: one silhouette per kind of place (a head office tower, a
 * store, a factory…), white on transparent, tinted by the map with the colour of the kind. The kind comes
 * from the data as free text, so it is matched by words.
 */

export const ICON_SHAPES = ["tower", "store", "factory", "warehouse", "people", "building"] as const;
export type IconShape = (typeof ICON_SHAPES)[number];

/** Side of the square every drawing is made in (and drawn at, before scaling). */
export const ICON_SIZE = 64;

const rect = (x: number, y: number, w: number, h: number): string => `M${x} ${y}h${w}v${h}h${-w}z`;
const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

/** Windows in rows and columns: holes cut in the wall they sit on (even-odd fill). */
function windows(xs: readonly number[], y0: number, y1: number, step: number, w: number, h: number): string {
  const out: string[] = [];
  for (let y = y0; y <= y1; y += step) for (const x of xs) out.push(rect(x, y, w, h));
  return out.join("");
}

interface Drawing {
  path: string;
  /** "evenodd": the inner shapes are holes (windows, doors); "nonzero": shapes simply add up. */
  rule: "evenodd" | "nonzero";
}

const DRAWINGS: Record<IconShape, Drawing> = {
  // Head office: a tower with an antenna between two lower wings.
  tower: {
    rule: "evenodd",
    path: [
      rect(31, 2, 2, 8), rect(18, 10, 28, 52), rect(5, 28, 12, 34), rect(47, 22, 12, 40),
      windows([22, 30, 38], 16, 52, 8, 4, 4), windows([9], 34, 54, 8, 4, 4), windows([51], 28, 54, 8, 4, 4),
    ].join(""),
  },
  // Store: an awning over a shop front with two windows and a door.
  store: {
    rule: "evenodd",
    path: [
      "M4 16h56l-5 11H9z", rect(8, 28, 48, 34),
      rect(12, 35, 11, 12), rect(41, 35, 11, 12), rect(27, 40, 10, 21),
    ].join(""),
  },
  // Factory: a saw-tooth roof and a chimney.
  factory: {
    rule: "evenodd",
    path: ["M4 62V36l14-9v9l14-9v9l14-9V10h9v52z", rect(9, 44, 8, 7), rect(23, 44, 8, 7), rect(37, 44, 8, 7)].join(""),
  },
  // Distribution centre: a gabled warehouse with a roll-up door (its slats fill the door back in).
  warehouse: {
    rule: "evenodd",
    path: ["M3 62V27L32 9l29 18v35z", rect(18, 37, 28, 24), rect(18, 43, 28, 2), rect(18, 49, 28, 2), rect(18, 55, 28, 2)].join(""),
  },
  // Customers: two people.
  people: {
    rule: "nonzero",
    path: [circle(40, 20, 8), "M25 60c0-12 6-20 15-20s15 8 15 20z", circle(22, 26, 7), "M8 60c0-10 6-17 14-17 4 0 7 2 9 4-3 4-5 8-5 13z"].join(""),
  },
  // Any other place: an office building.
  building: {
    rule: "evenodd",
    path: [rect(14, 10, 36, 52), windows([19, 29, 39], 16, 48, 8, 6, 4), rect(28, 52, 8, 9)].join(""),
  },
};

const plain = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const MATCHES: readonly [IconShape, RegExp][] = [
  ["tower", /\b(matriz|sede|holding|headquarter|escritorio central)/],
  ["warehouse", /\b(centro de distribui|cd\b|armaze|deposito|galpao|logistic|warehouse|entreposto)/],
  ["factory", /\b(fornecedor|fabric|industri|usina|produtor|supplier|manufatur)/],
  ["people", /\b(clientes|consumidor|cidade|pessoa)/],
  ["store", /\b(filial|loja|store|ponto de venda|franquia|unidade|revenda)/],
];

/** The drawing of a kind of place, from the words in it ("Filial" → store, "Fornecedor" → factory). */
export function iconShape(kind: string): IconShape {
  const k = plain(kind);
  return MATCHES.find(([, re]) => re.test(k))?.[0] ?? "building";
}

/** The SVG of a drawing, in white (the map tints it) or in a given colour (the legend). */
export function iconSvg(shape: IconShape, color = "#ffffff"): string {
  const d = DRAWINGS[shape];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" width="${ICON_SIZE}" height="${ICON_SIZE}"><path fill="${color}" fill-rule="${d.rule}" d="${d.path}"/></svg>`;
}

export const iconUrl = (shape: IconShape): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(shape))}`;

/** What the icon layer needs for a drawing: drawn in white, tinted per place, standing on its bottom edge. */
export function iconOf(shape: IconShape): { id: string; url: string; width: number; height: number; anchorY: number; mask: true } {
  return { id: shape, url: iconUrl(shape), width: ICON_SIZE, height: ICON_SIZE, anchorY: ICON_SIZE, mask: true };
}

/** The path and fill rule of a drawing, for drawing it inline (the legend). */
export const drawingOf = (shape: IconShape): Drawing => DRAWINGS[shape];
