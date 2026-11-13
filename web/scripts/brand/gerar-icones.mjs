// Regenerates the favicon and the app (PWA) icons from the DBI symbol.
// Run from web/:  node scripts/brand/gerar-icones.mjs
// The geometry mirrors src/components/brand/DbiMark.tsx — change both together.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NAVY = "#0c1a62";
const ACCENT = "#6f93ff";
const BARS = [
  { x: 8.5, height: 40, fill: "#fff" },
  { x: 18.5, height: 40, fill: "#fff" },
  { x: 28.5, height: 37, fill: "#fff" },
  { x: 38.5, height: 29, fill: "#fff" },
  { x: 48.5, height: 15, fill: ACCENT },
];
const BAR_WIDTH = 7;
const CENTER = 32;
const ICO_SIZES = [16, 32, 48];

/** radius: corner of the tile (0 = full bleed); scale: size of the bars around the centre (safe zone). */
function markSvg({ radius, scale }) {
  const bars = BARS.map(
    (b) => `<rect x="${b.x}" y="${CENTER - b.height / 2}" width="${BAR_WIDTH}" height="${b.height}" rx="2" fill="${b.fill}"/>`,
  ).join("");
  const offset = 32 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${radius}" fill="${NAVY}"/><g transform="translate(${offset} ${offset}) scale(${scale})">${bars}</g></svg>\n`;
}

function png(svg, size) {
  return sharp(Buffer.from(svg), { density: 72 * (size / 64) * 4 }).resize(size, size).png().toBuffer();
}

/** An .ico that embeds one PNG per size (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function main() {
  const rounded = markSvg({ radius: 14, scale: 1 });
  const fullBleed = markSvg({ radius: 0, scale: 0.9 });
  const maskable = markSvg({ radius: 0, scale: 0.72 });
  const icoImages = await Promise.all(ICO_SIZES.map(async (size) => ({ size, data: await png(rounded, size) })));

  const files = [
    ["src/app/icon.svg", rounded],
    ["src/app/favicon.ico", ico(icoImages)],
    ["src/app/apple-icon.png", await png(fullBleed, 180)],
    ["public/icons/icon-192.png", await png(rounded, 192)],
    ["public/icons/icon-512.png", await png(rounded, 512)],
    ["public/icons/icon-maskable-512.png", await png(maskable, 512)],
  ];
  for (const [file, data] of files) {
    const target = path.join(WEB, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    process.stdout.write(`gerado ${file}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Falha ao gerar os ícones: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
