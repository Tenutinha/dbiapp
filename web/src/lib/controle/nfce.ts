/**
 * NFC-e (nota fiscal de consumidor eletrônica): what its QR Code carries and how the public page
 * of the SEFAZ it points to is turned into text. Pure — shared by the server and the tests.
 *
 * The QR Code holds an address of the state's SEFAZ with the 44-digit access key ("chave de
 * acesso"): `https://…gov.br/…?p=<chave>|2|1|1|<hash>` (version 2) or `…?chNFe=<chave>&…`
 * (version 1). The full XML only comes with the issuer's or the buyer's digital certificate, but
 * that public page shows the same: store, date, items, amounts and how it was paid.
 */

export interface NfceQr {
  /** The address of the SEFAZ page, as printed in the QR Code. */
  url: string;
  /** The 44-digit access key. */
  key: string;
}

export interface NfceKey {
  /** IBGE code of the state (35 = SP, 41 = PR…). */
  uf: string;
  /** Year and month of issue, "2026-11". */
  month: string;
  cnpj: string;
  /** 65 = NFC-e, 55 = NF-e. */
  model: string;
  series: string;
  number: string;
}

/** Check digit of an access key: modulo 11 over the first 43 digits, weights 2..9 from the right. */
export function keyCheckDigit(first43: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = first43.length - 1; i >= 0; i--) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidKey(key: string): boolean {
  return /^\d{44}$/.test(key) && keyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

/** The parts of an access key (cUF, AAMM, CNPJ, mod, série, nNF…). */
export function describeKey(key: string): NfceKey {
  return {
    uf: key.slice(0, 2),
    month: `20${key.slice(2, 4)}-${key.slice(4, 6)}`,
    cnpj: key.slice(6, 20),
    model: key.slice(20, 22),
    series: key.slice(22, 25),
    number: String(Number(key.slice(25, 34))),
  };
}

/** "12345678000190" → "12.345.678/0001-90" */
export const formatCnpj = (cnpj: string): string => cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/**
 * What a QR Code read on a receipt says, when it is an NFC-e of a SEFAZ: an http(s) address on a
 * government host (".gov.br") carrying a valid model-65 key. Anything else is null — the server
 * never fetches an address that did not pass here.
 */
export function parseNfceQr(text: string): NfceQr | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  if (!url.hostname.endsWith(".gov.br")) return null;
  const key = decodeURIComponent(url.search).match(/(?<!\d)\d{44}(?!\d)/)?.[0];
  if (!key || !isValidKey(key) || describeKey(key).model !== "65") return null;
  return { url: url.toString(), key };
}

/** Whether a host may be fetched (also checked on every redirect). */
export const isSefazHost = (hostname: string): boolean => hostname.endsWith(".gov.br");

/** Accents written as named entities ("&Atilde;", "&ccedil;"), common on SEFAZ pages. */
const ACCENTS: Record<string, string> = { acute: "́", grave: "̀", circ: "̂", tilde: "̃", uml: "̈", cedil: "̧" };
const ACCENTED = Object.fromEntries(
  [..."aeiouAEIOUncNC"].flatMap((letter) => Object.entries(ACCENTS).map(([name, mark]) => [`${letter}${name}`, `${letter}${mark}`.normalize("NFC")])),
);
const ENTITIES: Record<string, string> = {
  ...ACCENTED, amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ordm: "º", ordf: "ª", deg: "°",
};

/**
 * The readable text of a SEFAZ page: scripts and styles out, table cells separated by " | ",
 * rows and blocks on their own lines, entities decoded, blank runs collapsed, at most `max` characters.
 */
export function pageText(html: string, max = 60_000): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<(br|\/tr|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n[\s|]*/g, "\n")
    .trim()
    .slice(0, max);
}
