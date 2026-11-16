/**
 * Helpers to rewrite a SPED file line by line, keeping every untouched line byte for byte
 * (the file is handled as ISO-8859-1 text, one character per byte). Pure: no I/O.
 */
import { parseLine } from "./sped";

/** Record name of a raw line ("|C170|1|…" → "C170"); "" when the line is not a record. */
export function regDe(linha: string): string {
  if (!linha.startsWith("|")) return "";
  const fim = linha.indexOf("|", 1);
  return fim < 0 ? "" : linha.slice(1, fim);
}

/** Fields of a raw line, `[0]` being the record name; empty when the line is not a record. */
export const camposDe = (linha: string): readonly string[] => parseLine(linha) ?? [];

export const montarLinha = (campos: readonly string[]): string => `|${campos.join("|")}|`;

/** The first `n` fields (record name included), padded with empty ones. */
export function ajustarCampos(campos: readonly string[], n: number): string[] {
  const out = campos.slice(0, n);
  while (out.length < n) out.push("");
  return out;
}

/** The records of a file up to |9999| (what follows is the signature) and whether something followed it. */
export function ateEncerramento(linhas: readonly string[]): { registros: string[]; sobra: boolean } {
  const registros: string[] = [];
  for (const [i, bruta] of linhas.entries()) {
    const linha = bruta.trim();
    if (regDe(linha) === "") continue;
    registros.push(linha);
    if (regDe(linha) === "9999") return { registros, sobra: linhas.slice(i + 1).some((l) => l.trim() !== "") };
  }
  return { registros, sobra: false };
}

/**
 * Counts the file again: the closing record of the given blocks (x990), the block 9 totals (9900, one line
 * per record present, in the order the records appear), 9990 and 9999. Every closing record counts itself
 * and its block's opening; 9990 counts 9999 too. A file without block 9 (9001) gets no 9900 lines.
 */
export function recontarEncerramentos(linhas: readonly string[], blocos: readonly string[]): string[] {
  const sem9900 = linhas.filter((l) => regDe(l) !== "9900");
  const porRegistro = new Map<string, number>();
  for (const l of sem9900) porRegistro.set(regDe(l), (porRegistro.get(regDe(l)) ?? 0) + 1);
  const totalizadoras: string[] = [];
  if (porRegistro.has("9001")) {
    for (const [registro, n] of porRegistro) {
      totalizadoras.push(`|9900|${registro}|${n}|`);
      if (registro === "9001") totalizadoras.push(`|9900|9900|${porRegistro.size + 1}|`);
    }
  }
  const abertura9 = sem9900.findIndex((l) => regDe(l) === "9001");
  const todas = abertura9 < 0 ? sem9900 : [...sem9900.slice(0, abertura9 + 1), ...totalizadoras, ...sem9900.slice(abertura9 + 1)];
  const doBloco = (bloco: string): number => todas.filter((l) => regDe(l).startsWith(bloco)).length;
  return todas.map((l) => {
    const registro = regDe(l);
    if (registro === "9999") return `|9999|${todas.length}|`;
    if (registro === "9990") return `|9990|${doBloco("9")}|`;
    if (registro.endsWith("990") && blocos.includes(registro[0] ?? "")) return `|${registro}|${doBloco(registro[0] ?? "")}|`;
    return l;
  });
}
