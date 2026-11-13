/**
 * The three SPED files the platform reads whole — EFD ICMS/IPI, EFD Contribuições and ECD.
 *
 * Every line of the file becomes one row of the fact table `registros`, with its fields kept as they
 * came, by position (c01, c02 …; the layouts in ./layouts name them). Besides the original fields, a row
 * carries where it came from (file, company, period, line), the document it belongs to (number, date and
 * operation of the header record above it) and links to the dimensions (participant, item, account).
 * Pure: the caller feeds records and collects rows.
 */
import ecdLayout from "./layouts/ecd.json";
import contribLayout from "./layouts/efd-contribuicoes.json";
import icmsLayout from "./layouts/efd-icms-ipi.json";
import {
  dedupeBy, FiscalFileError, spedDate, spedMonth, text, ufFromMunicipio,
  type Cell, type Row, type SpedIdentity, type SpedRecord,
} from "./sped";

export type Layout = Readonly<Record<string, { d: string; c: readonly string[] }>>;

/** Columns every SPED fact row starts with, before the links and the original fields. */
export const FACT_BASE = ["arquivo", "cnpj", "periodo", "linha", "bloco", "registro", "doc", "dt_doc", "oper"] as const;

export const fieldColumn = (position: number): string => `c${String(position).padStart(2, "0")}`;

interface Root {
  /** Field with the document number, its date and its operation (first one the record has). */
  doc?: readonly string[];
  date?: readonly string[];
  /** The record's date also moves the row's period (ECD: balances and entries inside a yearly file). */
  setsPeriod?: boolean;
}

export interface SpedKind {
  templateId: string;
  title: string;
  layout: Layout;
  /** How many original-field columns the fact has (records with more fields keep the rest in the last one). */
  width: number;
  /** Link column → field names that hold the code (the first one the record has). */
  links: Readonly<Record<string, readonly string[]>>;
  /** Records that start a document; the ones below them inherit its number, date and operation. */
  roots: Readonly<Record<string, Root>>;
  /** Records that say which establishment the next ones belong to (EFD Contribuições: A010, C010 …). */
  establishmentRecords: ReadonlySet<string>;
  identify(first: SpedRecord | undefined): SpedIdentity & { uf: string | null };
  /** Dimension tables this kind builds besides the fact. */
  dimensions: readonly string[];
  /**
   * Extra fact tables that keep only some blocks of the file, shaped like the main fact.
   * Light enough to hold every period, when the whole file of every period would be too much.
   */
  blockFacts: Readonly<Record<string, BlockFact>>;
  /**
   * Periods the main fact (the whole file) holds: every one, or only each company's latest — when a whole
   * file is too heavy to keep for every period and the block facts carry the history.
   */
  mainFactPeriods: "all" | "latest";
}

/**
 * Version of how a file is read into tables. Raise it when the reading changes (a new column, a fixed
 * field): files read before are then read again on the next "Montar tabelas" (see fiscal/parts-plan.ts).
 */
export const SPED_READER_VERSION = 1;

/** What an extra fact keeps of the file. */
export interface BlockFact {
  blocks: readonly string[];
  /** Records of those blocks left out (e.g. the notes and their free text, when only the items matter). */
  skip?: readonly string[];
  /** Only these records are kept (instead of every record of the blocks). */
  only?: readonly string[];
  /** Sums one heavy record up, so millions of lines become a table the panels can read at once. */
  collapse?: Collapse;
}

/**
 * How the lines of one record are summed up: one line per combination of the file, the operation, the
 * key fields and (optionally) the establishment and the item; the value fields are added, the others emptied.
 * The result keeps the record's layout, so everything written for that record still reads it.
 */
export interface Collapse {
  record: string;
  /** Fields (layout names) that stay as they are and tell the lines apart. */
  keys: readonly string[];
  /** Numeric fields that are added. */
  sums: readonly string[];
  /** Keep one line per establishment (else the lines go to the declarant). */
  byEstablishment: boolean;
  /** Keep one line per item (the link to the items dimension). */
  byItem: boolean;
}

/** Whether a block fact keeps this record. */
export function keepsRecord(fact: BlockFact, record: string): boolean {
  if (!fact.blocks.includes(record[0] ?? "")) return false;
  if (fact.only) return fact.only.includes(record);
  return !fact.skip?.includes(record);
}

const DOC = ["NUM_DOC", "NUM_DOC_INI", "NUM_CFE", "NUM_COO_FIN", "NUM_LCTO"] as const;
const DATE = ["DT_DOC", "DT_DOC_INI", "DT_REF", "DT_REF_INI", "DT_OPER", "DT_LCTO", "DT_RES", "DT_INI"] as const;
const documentRoots = (codes: string): Record<string, Root> =>
  Object.fromEntries(codes.split(" ").map((c) => [c, { doc: DOC, date: DATE }]));

function identifyIcms(r: SpedRecord | undefined): SpedIdentity & { uf: string | null } {
  // |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|…  (EFD Contribuições has DT_INI in field 5)
  if (!r || r[0] !== "0000" || !spedDate(r[3]) || !spedDate(r[4]) || !(text(r[6]) ?? text(r[7]))) {
    throw new FiscalFileError("Este arquivo não parece uma EFD ICMS/IPI (registro 0000 não confere).");
  }
  const cnpj = text(r[6]) ?? (text(r[7]) as string);
  return { cnpj, nome: text(r[5]) ?? cnpj, periodo: spedMonth(r[3]) as string, dtFin: spedDate(r[4]), uf: text(r[8]) };
}

function identifyContrib(r: SpedRecord | undefined): SpedIdentity & { uf: string | null } {
  // |0000|COD_VER|TIPO_ESCRIT|IND_SIT_ESP|NUM_REC_ANTERIOR|DT_INI|DT_FIN|NOME|CNPJ|UF|…
  if (!r || r[0] !== "0000" || !spedDate(r[5]) || !spedDate(r[6]) || !text(r[8])) {
    throw new FiscalFileError("Este arquivo não parece uma EFD Contribuições (registro 0000 não confere).");
  }
  const cnpj = text(r[8]) as string;
  return { cnpj, nome: text(r[7]) ?? cnpj, periodo: spedMonth(r[5]) as string, dtFin: spedDate(r[6]), uf: text(r[9]) };
}

function identifyEcd(r: SpedRecord | undefined): SpedIdentity & { uf: string | null } {
  // |0000|LECD|DT_INI|DT_FIN|NOME|CNPJ|UF|…
  if (!r || r[0] !== "0000" || r[1] !== "LECD" || !spedDate(r[2]) || !text(r[5])) {
    throw new FiscalFileError("Este arquivo não parece uma ECD (registro 0000 não confere).");
  }
  const cnpj = text(r[5]) as string;
  return { cnpj, nome: text(r[4]) ?? cnpj, periodo: spedMonth(r[2]) as string, dtFin: spedDate(r[3]), uf: text(r[6]) };
}

/** Items of the goods notes (EFD Contribuições, C170): what tells them apart in a summary, and what is added. */
const C170_KEYS = ["CFOP", "CST_PIS", "ALIQ_PIS", "CST_COFINS", "ALIQ_COFINS"] as const;
const C170_SUMS = ["QTD", "VL_ITEM", "VL_DESC", "VL_BC_PIS", "VL_PIS", "VL_BC_COFINS", "VL_COFINS"] as const;
/** EFD ICMS/IPI: the analytical lines of the notes (C190) are summed by CST, CFOP and rate. */
const C190_KEYS = ["CST_ICMS", "CFOP", "ALIQ_ICMS"] as const;
const C190_SUMS = ["VL_OPR", "VL_BC_ICMS", "VL_ICMS", "VL_BC_ICMS_ST", "VL_ICMS_ST", "VL_RED_BC", "VL_IPI"] as const;
/** EFD ICMS/IPI: the items of the notes (C170) are summed by item, CST, CFOP and rate. */
const ICMS_C170_KEYS = ["CST_ICMS", "CFOP", "ALIQ_ICMS"] as const;
const ICMS_C170_SUMS = ["QTD", "VL_ITEM", "VL_DESC", "VL_BC_ICMS", "VL_ICMS", "VL_BC_ICMS_ST", "VL_ICMS_ST", "VL_BC_IPI", "VL_IPI"] as const;

export const SPED_KINDS: readonly SpedKind[] = [
  {
    templateId: "efd-icms-ipi",
    title: "EFD ICMS/IPI",
    layout: icmsLayout,
    width: 40,
    links: { id_part: ["COD_PART"], id_item: ["COD_ITEM"] },
    roots: documentRoots("C100 C300 C350 C400 C495 C500 C600 C700 C800 C860 D100 D300 D350 D400 D500 D600 D695 D700"),
    establishmentRecords: new Set(),
    identify: identifyIcms,
    dimensions: ["estabelecimentos", "participantes", "itens"],
    blockFacts: {
      bloco_b_iss: { blocks: ["B"] },
      bloco_d_servicos: { blocks: ["D"] },
      bloco_e_apuracao: { blocks: ["E"] },
      bloco_g_ciap: { blocks: ["G"] },
      bloco_h_inventario: { blocks: ["H"] },
      bloco_k_producao_estoque: { blocks: ["K"] },
      bloco_1_outras_informacoes: { blocks: ["1"] },
      bloco_9_encerramento: { blocks: ["9"] },
      // Bloco C whole (notes, items, analytical lines) is tens of millions of lines for a chain of stores: the
      // general panels read the analytical lines of every document (C190 summed up) and the apuração (E110).
      paineis_todos_periodos: {
        blocks: ["C", "D", "E"],
        only: ["C190", "C490", "C590", "C850", "D190", "D590", "E110"],
        collapse: { record: "C190", keys: C190_KEYS, sums: C190_SUMS, byEstablishment: true, byItem: false },
      },
      // The items of the notes (C170), summed by item: what the items panel reads for every period.
      bloco_c_resumo_itens: {
        blocks: ["C"],
        only: ["C170"],
        collapse: { record: "C170", keys: ICMS_C170_KEYS, sums: ICMS_C170_SUMS, byEstablishment: true, byItem: true },
      },
    },
    // The whole file (notes one by one) is kept for the latest period of each establishment only.
    mainFactPeriods: "latest",
  },
  {
    templateId: "efd-contribuicoes",
    title: "EFD Contribuições",
    layout: contribLayout,
    width: 40,
    links: { id_part: ["COD_PART"], id_item: ["COD_ITEM"] },
    roots: documentRoots(
      "A100 C100 C180 C190 C380 C395 C400 C490 C500 C600 C800 C860 D100 D200 D300 D350 D500 D600 F100 F120 F130 F150 F200 F500 F510 F525 F550 F560 F600 F700 F800",
    ),
    establishmentRecords: new Set(["A010", "C010", "D010", "F010", "I010", "P010"]),
    identify: identifyContrib,
    dimensions: ["estabelecimentos", "participantes", "itens"],
    blockFacts: {
      bloco_a_servicos: { blocks: ["A"] },
      bloco_d_transporte_comunicacao: { blocks: ["D"] },
      bloco_f_demais_operacoes: { blocks: ["F"] },
      bloco_i_instituicoes_financeiras: { blocks: ["I"] },
      bloco_m_apuracao_pis_cofins: { blocks: ["M"] },
      bloco_p_previdenciaria_receita_bruta: { blocks: ["P"] },
      bloco_1_complemento_saldos: { blocks: ["1"] },
      bloco_9_encerramento: { blocks: ["9"] },
      // Bloco C whole is tens of millions of lines: the panels read its items (C170) summed up instead.
      bloco_c_resumo: {
        blocks: ["C"],
        skip: ["C100", "C110", "C111", "C120"],
        collapse: { record: "C170", keys: C170_KEYS, sums: C170_SUMS, byEstablishment: true, byItem: false },
      },
      bloco_c_resumo_itens: {
        blocks: ["C"],
        only: ["C170"],
        collapse: { record: "C170", keys: C170_KEYS, sums: C170_SUMS, byEstablishment: false, byItem: true },
      },
      // What the general panels read, for every period: the documents of every block (A, C, D, F) and the
      // apuração (M), with the goods items (C170) summed up as in bloco_c_resumo. The main fact holds the
      // whole file, too heavy to keep for every period.
      paineis_todos_periodos: {
        blocks: ["A", "C", "D", "F", "M"],
        skip: ["C100", "C110", "C111", "C120"],
        collapse: { record: "C170", keys: C170_KEYS, sums: C170_SUMS, byEstablishment: true, byItem: false },
      },
    },
    mainFactPeriods: "latest",
  },
  {
    templateId: "ecd",
    title: "ECD",
    layout: ecdLayout,
    width: 24,
    links: { id_cta: ["COD_CTA", "COD_CTA_REC"] },
    roots: {
      I150: { date: ["DT_INI"], setsPeriod: true },
      I200: { doc: ["NUM_LCTO"], date: ["DT_LCTO"], setsPeriod: true },
      I300: { date: ["DT_BCTE"], setsPeriod: true },
      I350: { date: ["DT_RES"], setsPeriod: true },
      C150: { date: ["DT_INI"], setsPeriod: true },
      J005: { date: ["DT_INI"] },
    },
    establishmentRecords: new Set(),
    identify: identifyEcd,
    dimensions: ["empresas", "plano_contas"],
    blockFacts: {},
    mainFactPeriods: "all",
  },
];

export function factColumns(kind: SpedKind): string[] {
  return [...FACT_BASE, ...Object.keys(kind.links), ...Array.from({ length: kind.width }, (_, i) => fieldColumn(i + 1))];
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

/** Reads one file record by record: `push` gives the fact row, `dimensions` what the file said about them. */
export class SpedReader {
  private readonly id: SpedIdentity & { uf: string | null };
  private readonly arquivo: string;
  private readonly positions = new Map<string, Map<string, number>>();
  private line = 0;
  private block = "";
  private cnpj: string;
  private periodo: string;
  private ctx: { doc: string | null; date: string | null; oper: string | null } = { doc: null, date: null, oper: null };
  private ctxLinks: Cell[] = [];
  private readonly establishments: Row[] = [];
  private readonly participants: Row[] = [];
  private readonly items: Row[] = [];
  private readonly accounts = new Map<string, Account>();
  private lastAccount: Account | null = null;

  constructor(private readonly kind: SpedKind, first: SpedRecord | undefined) {
    this.id = kind.identify(first);
    this.arquivo = `${this.id.cnpj}-${this.id.periodo.slice(0, 7)}`;
    this.cnpj = this.id.cnpj;
    this.periodo = this.id.periodo;
    this.establishments.push({ cnpj: this.id.cnpj, nome: this.id.nome, uf: this.id.uf });
  }

  /** Value of a named field of this record (per the layout), or undefined when the record has no such field. */
  private get(r: SpedRecord, name: string): string | undefined {
    let pos = this.positions.get(r[0]);
    if (!pos) {
      pos = new Map((this.kind.layout[r[0]]?.c ?? []).map((n, i) => [n, i + 1]));
      this.positions.set(r[0], pos);
    }
    const i = pos.get(name);
    return i === undefined ? undefined : r[i];
  }

  private first(r: SpedRecord, names: readonly string[] | undefined): string | null {
    for (const n of names ?? []) {
      const v = text(this.get(r, n));
      if (v !== null) return v;
    }
    return null;
  }

  private scoped(code: string | null): string | null {
    return code === null ? null : `${this.id.cnpj}-${code}`;
  }

  private collect(r: SpedRecord): void {
    const reg = r[0];
    if (this.kind.templateId === "ecd") {
      if (reg === "I050") {
        const cod = text(this.get(r, "COD_CTA"));
        if (!cod) return;
        const nivel = Number.parseInt(this.get(r, "NIVEL") ?? "", 10);
        this.lastAccount = {
          cod, sup: text(this.get(r, "COD_CTA_SUP")), nome: text(this.get(r, "CTA")) ?? cod,
          natureza: text(this.get(r, "COD_NAT")), nivel: Number.isNaN(nivel) ? null : nivel, ref: null,
        };
        this.accounts.set(cod, this.lastAccount);
      } else if (reg === "I051" && this.lastAccount && !this.lastAccount.ref) {
        this.lastAccount.ref = text(this.get(r, "COD_CTA_REF"));
      }
      return;
    }
    if (reg === "0140") {
      const cnpj = text(this.get(r, "CNPJ"));
      if (cnpj) this.establishments.push({ cnpj, nome: text(this.get(r, "NOME")) ?? cnpj, uf: text(this.get(r, "UF")) });
    } else if (reg === "0150") {
      const code = text(this.get(r, "COD_PART"));
      if (code) {
        this.participants.push({
          id_part: this.scoped(code), nome: text(this.get(r, "NOME")) ?? code,
          cnpj_cpf: text(this.get(r, "CNPJ")) ?? text(this.get(r, "CPF")), uf: ufFromMunicipio(this.get(r, "COD_MUN")),
        });
      }
    } else if (reg === "0200") {
      const code = text(this.get(r, "COD_ITEM"));
      if (code) {
        this.items.push({
          id_item: this.scoped(code), cod_item: code, descricao: text(this.get(r, "DESCR_ITEM")) ?? code,
          ncm: text(this.get(r, "COD_NCM")), tipo_item: text(this.get(r, "TIPO_ITEM")),
        });
      }
    }
  }

  /** The fact row of one record, in `factColumns(kind)` order. */
  push(r: SpedRecord): Cell[] {
    const reg = r[0];
    this.line += 1;
    const block = reg[0] ?? "";
    if (block !== this.block) {
      // A new block starts clean: no document, the declarant as establishment, the file's period.
      this.block = block;
      this.ctx = { doc: null, date: null, oper: null };
      this.ctxLinks = [];
      this.cnpj = this.id.cnpj;
      this.periodo = this.id.periodo;
    }
    if (this.kind.establishmentRecords.has(reg)) {
      this.cnpj = text(this.get(r, "CNPJ")) ?? this.id.cnpj;
      this.ctx = { doc: null, date: null, oper: null };
    }
    const own = Object.values(this.kind.links).map((names) => this.scoped(this.first(r, names)));
    const root = this.kind.roots[reg];
    if (root) {
      const date = spedDate(this.first(r, root.date) ?? undefined);
      this.ctx = { doc: this.first(r, root.doc), date, oper: text(this.get(r, "IND_OPER")) };
      this.ctxLinks = own;
      if (root.setsPeriod && date) this.periodo = `${date.slice(0, 7)}-01`;
    } else if (/^.(001|990)$/.test(reg) || this.kind.establishmentRecords.has(reg)) {
      this.ctx = { doc: null, date: null, oper: null };
      this.ctxLinks = [];
    }
    this.collect(r);

    // A record below a document inherits the links it does not carry itself (an item, the note's participant).
    const links = own.map((v, i) => v ?? this.ctxLinks[i] ?? null);
    const width = this.kind.width;
    const fields: Cell[] = [];
    for (let i = 1; i <= width; i += 1) {
      const v = i === width && r.length - 1 > width ? r.slice(width).join("|") : r[i];
      fields.push(v === undefined || v === "" ? null : v);
    }
    return [
      this.arquivo, this.cnpj, this.periodo, String(this.line), block, reg, this.ctx.doc, this.ctx.date, this.ctx.oper,
      ...links, ...fields,
    ];
  }

  dimensions(): Record<string, Row[]> {
    if (this.kind.templateId === "ecd") {
      const plano: Row[] = [...this.accounts.values()].map((a) => ({
        id_cta: this.scoped(a.cod),
        cod_cta: a.cod,
        nome: a.nome,
        natureza: a.natureza ?? "09",
        nivel: a.nivel === null ? null : String(a.nivel),
        grupo_1: ancestorAt(this.accounts, a, 1),
        grupo_2: ancestorAt(this.accounts, a, 2),
        grupo_3: ancestorAt(this.accounts, a, 3),
        cod_cta_ref: a.ref,
      }));
      return { empresas: this.establishments, plano_contas: plano };
    }
    return {
      estabelecimentos: dedupeBy(this.establishments, "cnpj"),
      participantes: dedupeBy(this.participants, "id_part"),
      itens: dedupeBy(this.items, "id_item"),
    };
  }
}

export function spedKindFor(templateId: string): SpedKind | null {
  return SPED_KINDS.find((k) => k.templateId === templateId) ?? null;
}
