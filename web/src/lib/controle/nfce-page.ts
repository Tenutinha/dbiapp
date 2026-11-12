/**
 * Fetches the public page of an NFC-e on its state's SEFAZ (the address its QR Code carries) and
 * returns its text. Only government hosts are ever requested — on the first address and on every
 * redirect — with a short timeout and a size cap, so a forged QR Code cannot point the server elsewhere.
 */
import "server-only";
import { UserFacingError } from "../services/datasets";
import { isSefazHost, pageText } from "./nfce";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;
// Some portals answer only to a browser.
const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const UNREACHABLE = "Não consegui consultar a nota no site da SEFAZ agora.";

async function readCapped(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new UserFacingError(UNREACHABLE);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The page's charset: the header, else a <meta charset> near the top, else UTF-8 (many SEFAZ pages are ISO-8859-1). */
function decode(bytes: Uint8Array, contentType: string | null): string {
  const head = Buffer.from(bytes.subarray(0, 4096)).toString("latin1");
  const label = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** The text of the SEFAZ page of an NFC-e (see parseNfceQr for the addresses that get here). */
export async function fetchNfcePage(address: string): Promise<string> {
  let url = new URL(address);
  const cookies = new Map<string, string>(); // portals that set a session cookie and redirect back
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSefazHost(url.hostname) || url.port || (url.protocol !== "https:" && url.protocol !== "http:")) {
      console.error("[controle] nfce redirect left the SEFAZ", url.hostname);
      throw new UserFacingError(UNREACHABLE);
    }
    // Printed QR Codes carry a raw "|" (p=chave|2|1|1|hash); some portals (MT's Tomcat) answer 400 to it.
    url.search = url.search.replace(/\|/g, "%7C");
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9",
          ...(cookies.size > 0 ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        },
      });
    } catch (err) {
      console.error("[controle] nfce page unreachable", url.hostname, err);
      throw new UserFacingError(UNREACHABLE);
    }
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      if (at > 0) cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) {
      console.error("[controle] nfce page answered", res.status, url.hostname);
      throw new UserFacingError(UNREACHABLE);
    }
    return pageText(decode(await readCapped(res), res.headers.get("content-type")));
  }
  throw new UserFacingError(UNREACHABLE);
}
