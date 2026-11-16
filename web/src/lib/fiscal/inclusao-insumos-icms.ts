/**
 * O que a "inclusão de insumos" lê de um arquivo da EFD ICMS/IPI: quem declara, o mês, os cadastros
 * (0150, 0190, 0200, 0400) e as notas de entrada (C100 com IND_OPER 0) com os seus itens (C170).
 * Puro: quem chama entrega as linhas do arquivo.
 */
import { FiscalFileError } from "./sped";
import { camposDe } from "./sped-linhas";

export interface NotaIcms {
  /** Linha do C100 no arquivo (a primeira é 1). */
  linha: number;
  campos: readonly string[];
  itens: readonly (readonly string[])[];
}

type Cadastro = ReadonlyMap<string, readonly string[]>;

export interface EfdIcms {
  arquivo: string;
  cnpj: string;
  /** Mês da escrituração, como no arquivo: MMAAAA. */
  mes: string;
  /** O registro 0000 (nome, UF, IE, município … para criar o 0140 que faltar). */
  abertura: readonly string[];
  participantes: Cadastro;
  itens: Cadastro;
  unidades: Cadastro;
  naturezas: Cadastro;
  notas: readonly NotaIcms[];
}

/** Posição dos campos usados, contando o nome do registro como 0. */
export const C100 = { IND_OPER: 1, COD_PART: 3, COD_MOD: 4, COD_SIT: 5, SER: 6, NUM_DOC: 7, CHV_NFE: 8, VL_DOC: 11 } as const;
export const C170 = { NUM_ITEM: 1, COD_ITEM: 2, UNID: 5, VL_ITEM: 6, CFOP: 10, COD_NAT: 11, CST_PIS: 24, VL_PIS: 29, VL_COFINS: 35, COD_CTA: 36 } as const;
const ICMS_0000 = { DT_INI: 3, CNPJ: 6 } as const;

const CADASTROS: Readonly<Record<string, "participantes" | "itens" | "unidades" | "naturezas">> = {
  "0150": "participantes", "0200": "itens", "0190": "unidades", "0400": "naturezas",
};

export function lerEfdIcms(arquivo: string, linhas: Iterable<string>): EfdIcms {
  const cadastros = { participantes: new Map<string, readonly string[]>(), itens: new Map<string, readonly string[]>(),
    unidades: new Map<string, readonly string[]>(), naturezas: new Map<string, readonly string[]>() };
  const notas: { linha: number; campos: readonly string[]; itens: (readonly string[])[] }[] = [];
  let abertura: readonly string[] | null = null;
  let aberta: (typeof notas)[number] | null = null;
  let n = 0;
  for (const bruta of linhas) {
    n += 1;
    const campos = camposDe(bruta);
    const registro = campos[0];
    if (!registro) continue;
    if (registro === "0000") abertura = campos;
    else if (CADASTROS[registro]) cadastros[CADASTROS[registro]].set(campos[1] ?? "", campos);
    else if (registro === "C100") {
      aberta = campos[C100.IND_OPER] === "0" ? { linha: n, campos, itens: [] } : null;
      if (aberta) notas.push(aberta);
    } else if (registro === "C170") aberta?.itens.push(campos);
    else if (!registro.startsWith("C1")) aberta = null;
    if (registro === "9999") break;
  }
  const cnpj = abertura?.[ICMS_0000.CNPJ] ?? "";
  const dtIni = abertura?.[ICMS_0000.DT_INI] ?? "";
  if (!abertura || !/^\d{14}$/.test(cnpj) || !/^\d{8}$/.test(dtIni)) {
    throw new FiscalFileError(`${arquivo}: não é um arquivo da EFD ICMS/IPI (registro 0000 sem CNPJ ou sem período).`);
  }
  return { arquivo, cnpj, mes: dtIni.slice(2), abertura, ...cadastros, notas };
}
