/**
 * ECD (SPED Contábil) → tables of the "ecd" template.
 *
 * Fact `saldos_contas`: periodic balances (I150 + I155) with sign — debit positive, credit negative.
 * Dimension `plano_contas`: chart of accounts (I050) with the referential account (I051) and the names
 * of the synthetic accounts at levels 1–3 above each account, for roll-ups.
 */
import {
  FiscalFileError, scopedKey, spedDate, spedMonth, spedNumber, text,
  type Row, type SpedIdentity, type SpedRecord,
} from "./sped";

export interface EcdTables {
  saldos_contas: Row[];
  empresas: Row[];
  plano_contas: Row[];
}

/** 0000: |0000|LECD|DT_INI|DT_FIN|NOME|CNPJ|UF|IE|COD_MUN|IM|IND_SIT_ESP|… */
export function identifyEcd(records: readonly SpedRecord[]): SpedIdentity & { uf: string | null } {
  const r = records[0];
  if (!r || r[0] !== "0000" || r[1] !== "LECD" || !spedDate(r[2]) || !text(r[5])) {
    throw new FiscalFileError("Este arquivo não parece uma ECD (registro 0000 não confere).");
  }
  return { cnpj: text(r[5]) as string, nome: text(r[4]) ?? (text(r[5]) as string), periodo: spedMonth(r[2]) as string, dtFin: spedDate(r[3]), uf: text(r[6]) };
}

/** Balance with sign: D → +, C → −. */
function signed(value: string | undefined, dc: string | undefined): string {
  const n = spedNumber(value) ?? "0";
  if ((dc ?? "").trim().toUpperCase() !== "C" || n === "0" || /^0(\.0+)?$/.test(n)) return n;
  return n.startsWith("-") ? n.slice(1) : `-${n}`;
}

interface Account {
  cod: string;
  sup: string | null;
  nome: string;
  natureza: string | null;
  nivel: number | null;
  ref: string | null;
}

/** Name of the ancestor (or the account itself) at `level`, walking up COD_CTA_SUP. */
function ancestorAt(accounts: ReadonlyMap<string, Account>, start: Account, level: number): string | null {
  let current: Account | undefined = start;
  for (let guard = 0; current && guard < 50; guard += 1) {
    if (current.nivel === level) return current.nome;
    if (current.nivel !== null && current.nivel < level) return null;
    current = current.sup ? accounts.get(current.sup) : undefined;
  }
  return null;
}

export function parseEcd(records: readonly SpedRecord[]): EcdTables {
  const id = identifyEcd(records);
  const accounts = new Map<string, Account>();
  const saldos: Row[] = [];
  let periodo = id.periodo;
  let lastAccount: Account | null = null;

  for (const r of records) {
    switch (r[0]) {
      // |I050|DT_ALT|COD_NAT|IND_CTA|NIVEL|COD_CTA|COD_CTA_SUP|CTA|
      case "I050": {
        const cod = text(r[5]);
        if (!cod) break;
        const nivel = Number.parseInt(r[4] ?? "", 10);
        lastAccount = { cod, sup: text(r[6]), nome: text(r[7]) ?? cod, natureza: text(r[2]), nivel: Number.isNaN(nivel) ? null : nivel, ref: null };
        accounts.set(cod, lastAccount);
        break;
      }
      // |I051|COD_CCUS|COD_CTA_REF|  (older layouts: |I051|COD_ENT_REF|COD_CCUS|COD_CTA_REF|) — the last field is the account
      case "I051":
        if (lastAccount && !lastAccount.ref) lastAccount.ref = text(r[r.length - 1]);
        break;
      // |I150|DT_INI|DT_FIN|
      case "I150":
        periodo = spedMonth(r[1]) ?? periodo;
        break;
      // |I155|COD_CTA|COD_CCUS|VL_SLD_INI|IND_DC_INI|VL_DEB|VL_CRED|VL_SLD_FIN|IND_DC_FIN|
      case "I155":
        saldos.push({
          cnpj: id.cnpj,
          periodo,
          id_cta: scopedKey(id.cnpj, r[1]),
          cod_ccus: text(r[2]),
          vl_sld_ini: signed(r[3], r[4]),
          vl_deb: spedNumber(r[5]) ?? "0",
          vl_cred: spedNumber(r[6]) ?? "0",
          vl_sld_fin: signed(r[7], r[8]),
        });
        break;
      default:
        break;
    }
  }

  const plano: Row[] = [...accounts.values()].map((a) => ({
    id_cta: scopedKey(id.cnpj, a.cod),
    cod_cta: a.cod,
    nome: a.nome,
    natureza: a.natureza ?? "09",
    nivel: a.nivel === null ? null : String(a.nivel),
    grupo_1: ancestorAt(accounts, a, 1),
    grupo_2: ancestorAt(accounts, a, 2),
    grupo_3: ancestorAt(accounts, a, 3),
    cod_cta_ref: a.ref,
  }));

  return { saldos_contas: saldos, empresas: [{ cnpj: id.cnpj, nome: id.nome, uf: id.uf }], plano_contas: plano };
}
