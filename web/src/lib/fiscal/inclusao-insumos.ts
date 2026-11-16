/**
 * "Inclusão de insumos" (CR17 do catálogo de auditorias): leva para o arquivo da EFD Contribuições de um
 * mês as notas de entrada que só estão na EFD ICMS/IPI dos estabelecimentos, com os itens e os cadastros
 * de que elas dependem, copiados como estão. Devolve as linhas do arquivo corrigido e o relatório.
 *
 * Puro: recebe as linhas do arquivo original e os arquivos da EFD ICMS/IPI já lidos (lerEfdIcms).
 * Não mexe no bloco M (a apuração é refeita no PVA) nem recalcula PIS/COFINS dos itens.
 */
import { cfopSemPontos } from "./cfop-credito";
import { C100, C170, type EfdIcms, type NotaIcms } from "./inclusao-insumos-icms";
import { FiscalFileError } from "./sped";
import { ajustarCampos, ateEncerramento, camposDe, montarLinha, recontarEncerramentos, regDe } from "./sped-linhas";

export interface OpcoesInclusao {
  /**
   * CFOP que geram crédito. A nota com pelo menos um item de CFOP daqui entra inteira, com todos os itens
   * (decisão do responsável pela análise, 16/11/2026; é também o que o Guia Prático pede no C170).
   */
  cfopCredito: ReadonlySet<string>;
  /** Chaves que já estão em algum C100 da EFD Contribuições, de qualquer mês (as do próprio arquivo entram sozinhas). */
  chavesEscrituradas: ReadonlySet<string>;
  /** Recibo da escrituração a retificar: com ele o 0000 sai marcado como retificador. */
  reciboAnterior?: string;
}

export const RELATORIO_COLUNAS = [
  "tipo", "motivo", "estabelecimento", "registro", "codigo", "chave", "num_doc", "cod_part", "num_item", "cod_item",
  "cfop", "cst_pis", "valor", "vl_pis", "vl_cofins", "detalhe", "arquivo", "linha",
] as const;
export type LinhaRelatorio = Record<(typeof RELATORIO_COLUNAS)[number], string>;

export interface ResultadoInclusao {
  linhas: string[];
  relatorio: LinhaRelatorio[];
  /** Quantas linhas do relatório há de cada tipo (e, nas deixadas de fora, de cada motivo). */
  resumo: Record<string, number>;
}

const SITUACOES_REGULARES = new Set(["00", "01", "06", "07", "08"]);
/** Largura dos registros na EFD Contribuições, contando o nome do registro. */
const LARGURA = { C100: 29, C170: 37, "0150": 13, "0200": 12, "0190": 3, "0400": 3 } as const;
/** Ordem dos filhos do 0140 (tabela de registros do bloco 0 do Guia Prático). */
const ORDEM_0140: Readonly<Record<string, number>> = { "0145": 1, "0150": 2, "0190": 3, "0200": 4, "0205": 4, "0206": 4, "0208": 4, "0400": 5, "0450": 6 };
/** A nota e os seus filhos, que vêm antes dos outros documentos do C010. */
const REGISTROS_DA_NOTA = new Set(["C100", "C110", "C111", "C120", "C170", "C175"]);
const CONTRIB_0000 = { TIPO_ESCRIT: 2, NUM_REC_ANTERIOR: 4, DT_INI: 5, CNPJ: 8 } as const;
/** Linhas novas de um estabelecimento que não existia vão depois de tudo o que já havia naquele ponto. */
const DEPOIS = 10;

type TipoCadastro = "0150" | "0190" | "0200" | "0400";
type Cadastros = Record<TipoCadastro, Map<string, readonly string[]>>;

interface Secao { cnpj: string; inicio: number; fim: number }
interface Mapa { secoes: Secao[]; fimDasSecoes: number }

const novosCadastros = (): Cadastros => ({ "0150": new Map(), "0190": new Map(), "0200": new Map(), "0400": new Map() });
const digitos = (v: string | undefined): string => (v ?? "").replace(/\D/g, "");
const semEspacos = (v: string | undefined): string => (v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const centavos = (v: string | undefined): number => Math.round(Number((v ?? "").replace(/\./g, "").replace(",", ".")) * 100) || 0;
const reais = (c: number): string => (c / 100).toFixed(2);

function linhaRelatorio(dados: Partial<LinhaRelatorio>): LinhaRelatorio {
  return Object.fromEntries(RELATORIO_COLUNAS.map((c) => [c, dados[c] ?? ""])) as LinhaRelatorio;
}

/** Seções de um bloco: do registro que abre o estabelecimento até o próximo, ou até o primeiro registro que não é filho. */
function mapear(linhas: readonly string[], abre: string, campoCnpj: number, filho: (registro: string) => boolean, antesDe: readonly string[]): Mapa {
  const secoes: Secao[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    if (regDe(linhas[i] ?? "") !== abre) continue;
    let fim = i + 1;
    while (fim < linhas.length && filho(regDe(linhas[fim] ?? ""))) fim += 1;
    secoes.push({ cnpj: camposDe(linhas[i] ?? "")[campoCnpj] ?? "", inicio: i, fim });
  }
  const ultima = secoes.at(-1);
  const fimDasSecoes = ultima ? ultima.fim : linhas.findIndex((l) => antesDe.includes(regDe(l)));
  return { secoes, fimDasSecoes };
}

/** O participante é o mesmo (CNPJ ou CPF; sem eles, o nome)? O item é o mesmo (descrição e NCM)? */
function mesmoCadastro(tipo: TipoCadastro, existente: readonly string[], novo: readonly string[]): boolean {
  if (tipo === "0150") {
    const [a, b] = [digitos(existente[4]) + digitos(existente[5]), digitos(novo[4]) + digitos(novo[5])];
    return a !== "" || b !== "" ? a === b : semEspacos(existente[2]) === semEspacos(novo[2]);
  }
  if (tipo === "0200") return semEspacos(existente[2]) === semEspacos(novo[2]) && digitos(existente[7]) === digitos(novo[7]);
  return true; // unidade e natureza: vale a descrição que o arquivo já tem
}

interface Decisao {
  fora?: { motivo: string; detalhe: string };
  itens: readonly (readonly string[])[];
  /** Cadastros a incluir no 0140 do estabelecimento, na ordem em que a nota os pede. */
  cadastros: { tipo: TipoCadastro; campos: readonly string[] }[];
  conflitos: { tipo: TipoCadastro; codigo: string; existente: readonly string[]; novo: readonly string[] }[];
}

const fora = (motivo: string, detalhe = ""): Decisao => ({ fora: { motivo, detalhe }, itens: [], cadastros: [], conflitos: [] });

/** Os cadastros que a nota usa: o participante, cada item com a sua unidade de inventário, as unidades e as naturezas dos itens. */
function cadastrosDaNota(nota: NotaIcms, itens: readonly (readonly string[])[], icms: EfdIcms, existentes: Cadastros): { tipo: TipoCadastro; codigo: string }[] {
  const usados: { tipo: TipoCadastro; codigo: string }[] = [{ tipo: "0150", codigo: nota.campos[C100.COD_PART] ?? "" }];
  for (const item of itens) {
    const codItem = item[C170.COD_ITEM] ?? "";
    // A unidade de inventário (0200.UNID_INV) só é pedida pelo 0200 que vai ser incluído.
    const unidInv = existentes["0200"].has(codItem) ? "" : (icms.itens.get(codItem)?.[5] ?? "");
    usados.push({ tipo: "0200", codigo: codItem }, { tipo: "0190", codigo: unidInv },
      { tipo: "0190", codigo: item[C170.UNID] ?? "" }, { tipo: "0400", codigo: item[C170.COD_NAT] ?? "" });
  }
  return usados.filter((u) => u.codigo !== "");
}

function decidir(nota: NotaIcms, icms: EfdIcms, existentes: Cadastros, chaves: ReadonlySet<string>, opcoes: OpcoesInclusao): Decisao {
  const c = nota.campos;
  const chave = c[C100.CHV_NFE] ?? "";
  if (c[C100.COD_MOD] !== "55") return fora("modelo", `modelo ${c[C100.COD_MOD] ?? ""}: só entra NF-e (55)`);
  if (!SITUACOES_REGULARES.has(c[C100.COD_SIT] ?? "")) return fora("situação", `COD_SIT ${c[C100.COD_SIT] ?? ""}`);
  if (chave === "") return fora("sem chave");
  if (chaves.has(chave)) return fora("já escriturada", "a chave já está num C100 da EFD Contribuições ou em outra nota desta inclusão");
  if (nota.itens.length === 0) return fora("sem C170", "a nota não tem itens na EFD ICMS/IPI");
  if (!nota.itens.some((item) => opcoes.cfopCredito.has(cfopSemPontos(item[C170.CFOP])))) return fora("CFOP sem crédito", `CFOP ${[...new Set(nota.itens.map((i) => i[C170.CFOP] ?? ""))].join(", ")}`);
  const itens = nota.itens;
  const fontes: Record<TipoCadastro, ReadonlyMap<string, readonly string[]>> = { "0150": icms.participantes, "0200": icms.itens, "0190": icms.unidades, "0400": icms.naturezas };
  const decisao: Decisao = { itens, cadastros: [], conflitos: [] };
  const vistos = new Set<string>();
  for (const { tipo, codigo } of cadastrosDaNota(nota, itens, icms, existentes)) {
    if (vistos.has(`${tipo}|${codigo}`)) continue;
    vistos.add(`${tipo}|${codigo}`);
    const novo = fontes[tipo].get(codigo);
    const existente = existentes[tipo].get(codigo);
    if (existente && novo && !mesmoCadastro(tipo, existente, novo)) decisao.conflitos.push({ tipo, codigo, existente, novo });
    else if (!existente && !novo) return fora("cadastro ausente", `${tipo} ${codigo} não está na EFD ICMS/IPI nem no 0140 da EFD Contribuições`);
    else if (!existente && novo) decisao.cadastros.push({ tipo, campos: ajustarCampos(novo, LARGURA[tipo]) });
  }
  if (decisao.conflitos.length === 0) return decisao;
  return { ...fora("conflito de cadastro", decisao.conflitos.map((k) => `${k.tipo} ${k.codigo}`).join(", ")), conflitos: decisao.conflitos };
}

/** Linhas a incluir antes de uma posição do arquivo original; no mesmo ponto, a ordem é a do registro. */
class Insercoes {
  private readonly porPosicao = new Map<number, { ordem: number; linha: string }[]>();

  incluir(posicao: number, ordem: number, linha: string): void {
    const fila = this.porPosicao.get(posicao);
    if (fila) fila.push({ ordem, linha }); // milhares de linhas no mesmo ponto: copiar a fila a cada uma custaria caro
    else this.porPosicao.set(posicao, [{ ordem, linha }]);
  }

  aplicar(linhas: readonly string[], trocas: ReadonlyMap<number, string>): string[] {
    const out: string[] = [];
    for (let i = 0; i <= linhas.length; i += 1) {
      const novas = [...(this.porPosicao.get(i) ?? [])].sort((a, b) => a.ordem - b.ordem);
      for (const nova of novas) out.push(nova.linha);
      if (i < linhas.length) out.push(trocas.get(i) ?? linhas[i] ?? "");
    }
    return out;
  }
}

/** O arquivo original, o que já foi decidido incluir e o relatório, enquanto os estabelecimentos são processados. */
interface Trabalho {
  linhas: readonly string[];
  bloco0: Mapa;
  blocoC: Mapa;
  insercoes: Insercoes;
  relatorio: LinhaRelatorio[];
  chaves: Set<string>;
  /** Contas do 0500 do arquivo original (e a conta vazia): o COD_CTA dos itens é copiado, não conferido. */
  contas: ReadonlySet<string>;
  opcoes: OpcoesInclusao;
}

function cadastrosExistentes(linhas: readonly string[], secao: Secao | undefined): Cadastros {
  const cadastros = novosCadastros();
  for (const linha of secao ? linhas.slice(secao.inicio + 1, secao.fim) : []) {
    const campos = camposDe(linha);
    const tipo = campos[0] as TipoCadastro;
    if (tipo in cadastros) cadastros[tipo].set(campos[1] ?? "", campos);
  }
  return cadastros;
}

function relatarNota(t: Trabalho, icms: EfdIcms, nota: NotaIcms, d: Decisao): void {
  const c = nota.campos;
  const comum = { estabelecimento: icms.cnpj, chave: c[C100.CHV_NFE] ?? "", num_doc: c[C100.NUM_DOC] ?? "", cod_part: c[C100.COD_PART] ?? "", arquivo: icms.arquivo };
  for (const k of d.conflitos) {
    t.relatorio.push(linhaRelatorio({ ...comum, tipo: "conflito de cadastro", registro: k.tipo, codigo: k.codigo, linha: String(nota.linha),
      detalhe: `na EFD Contribuições: ${montarLinha(k.existente)} · na EFD ICMS/IPI: ${montarLinha(k.novo)}` }));
  }
  if (d.fora) {
    t.relatorio.push(linhaRelatorio({ ...comum, tipo: "nota deixada de fora", motivo: d.fora.motivo, detalhe: d.fora.detalhe, registro: "C100",
      valor: reais(centavos(c[C100.VL_DOC])), linha: String(nota.linha) }));
    return;
  }
  // Gera crédito o item com CST de crédito (50 a 66) e CFOP da tabela: é o que o PVA leva ao M105/M505.
  const credito = d.itens.filter((i) => /^(5\d|6[0-6])$/.test(i[C170.CST_PIS] ?? "") && t.opcoes.cfopCredito.has(cfopSemPontos(i[C170.CFOP])));
  const soma = (campo: number): string => reais(credito.reduce((s, i) => s + centavos(i[campo]), 0));
  t.relatorio.push(linhaRelatorio({ ...comum, tipo: credito.length > 0 ? "nota incluída com crédito" : "nota incluída sem crédito", registro: "C100",
    valor: reais(centavos(c[C100.VL_DOC])), vl_pis: soma(C170.VL_PIS), vl_cofins: soma(C170.VL_COFINS), linha: String(nota.linha),
    detalhe: `${d.itens.length} item(ns) incluído(s), ${credito.length} com CST de crédito (50 a 66) e CFOP da tabela` }));
}

/** Processa um arquivo da EFD ICMS/IPI: decide cada nota e marca o que entra no 0140 e no C010 do estabelecimento. */
function incluirEstabelecimento(t: Trabalho, icms: EfdIcms): void {
  const secao0 = t.bloco0.secoes.find((s) => s.cnpj === icms.cnpj);
  const secaoC = t.blocoC.secoes.find((s) => s.cnpj === icms.cnpj);
  const existentes = cadastrosExistentes(t.linhas, secao0);
  const cadastros: { tipo: TipoCadastro; campos: readonly string[] }[] = [];
  const notas: string[] = [];
  for (const nota of icms.notas) {
    const d = decidir(nota, icms, existentes, t.chaves, t.opcoes);
    relatarNota(t, icms, nota, d);
    if (d.fora) continue;
    t.chaves.add(nota.campos[C100.CHV_NFE] ?? "");
    for (const k of d.cadastros) {
      existentes[k.tipo].set(k.campos[1] ?? "", k.campos);
      cadastros.push(k);
    }
    notas.push(montarLinha(ajustarCampos(nota.campos, LARGURA.C100)), ...d.itens.map((i) => montarLinha(ajustarCampos(i, LARGURA.C170))));
  }
  if (notas.length === 0) return;
  const relatarCadastro = (registro: string, codigo: string, detalhe = ""): void => {
    t.relatorio.push(linhaRelatorio({ tipo: "cadastro incluído", estabelecimento: icms.cnpj, registro, codigo, detalhe, arquivo: icms.arquivo }));
  };
  const ordenados = [...cadastros].sort((a, b) => (ORDEM_0140[a.tipo] ?? 0) - (ORDEM_0140[b.tipo] ?? 0));
  if (!secao0) {
    const a = icms.abertura; // 0000 da EFD ICMS/IPI: NOME 5, UF 8, IE 9, COD_MUN 10, IM 11, SUFRAMA 12
    t.insercoes.incluir(t.bloco0.fimDasSecoes, DEPOIS, montarLinha(["0140", "", a[5] ?? "", icms.cnpj, a[8] ?? "", a[9] ?? "", a[10] ?? "", a[11] ?? "", a[12] ?? ""]));
    relatarCadastro("0140", icms.cnpj, "estabelecimento sem 0140 no arquivo: criado com os dados do 0000 da EFD ICMS/IPI");
  }
  const posicoes = new Map<number, number>(); // uma varredura do 0140 por tipo de cadastro, não por cadastro
  for (const k of ordenados) {
    const ordem = ORDEM_0140[k.tipo] ?? 0;
    if (secao0 && !posicoes.has(ordem)) posicoes.set(ordem, posicaoDoCadastro(t.linhas, secao0, ordem));
    const posicao = posicoes.get(ordem) ?? t.bloco0.fimDasSecoes;
    t.insercoes.incluir(posicao, secao0 ? ordem : DEPOIS, montarLinha(k.campos));
    relatarCadastro(k.tipo, k.campos[1] ?? "", k.campos[2] ?? "");
  }
  if (!secaoC) {
    t.insercoes.incluir(t.blocoC.fimDasSecoes, DEPOIS, montarLinha(["C010", icms.cnpj, "2"]));
    relatarCadastro("C010", icms.cnpj, "estabelecimento sem C010 no arquivo: criado com IND_ESCRI 2 (registro individualizado, C100 e C170)");
  } else if (t.linhas.slice(secaoC.inicio, secaoC.fim).some((l) => ["C180", "C190"].includes(regDe(l)))) {
    t.relatorio.push(linhaRelatorio({ tipo: "aviso", estabelecimento: icms.cnpj, registro: "C010",
      detalhe: `o estabelecimento escritura notas consolidadas (C180/C190) e passa a ter também C100: confira o IND_ESCRI do C010 no PVA (está "${camposDe(t.linhas[secaoC.inicio] ?? "")[2] ?? ""}")` }));
  }
  const posicaoNotas = secaoC ? posicaoDasNotas(t.linhas, secaoC) : t.blocoC.fimDasSecoes;
  for (const linha of notas) t.insercoes.incluir(posicaoNotas, secaoC ? 0 : DEPOIS, linha);
  const semConta = notas.filter((l) => regDe(l) === "C170" && !t.contas.has(camposDe(l)[C170.COD_CTA] ?? "")).length;
  if (semConta > 0) {
    t.relatorio.push(linhaRelatorio({ tipo: "aviso", estabelecimento: icms.cnpj, registro: "C170", arquivo: icms.arquivo,
      detalhe: `${semConta} item(ns) incluído(s) com COD_CTA da EFD ICMS/IPI que não está no plano de contas (0500) da EFD Contribuições: confira no PVA` }));
  }
}

/** Antes do primeiro filho do 0140 que vem depois deste tipo de cadastro (ou no fim do 0140). */
function posicaoDoCadastro(linhas: readonly string[], secao: Secao, ordem: number): number {
  for (let i = secao.inicio + 1; i < secao.fim; i += 1) if ((ORDEM_0140[regDe(linhas[i] ?? "")] ?? 0) > ordem) return i;
  return secao.fim;
}

/** Depois das notas (C100 e filhos) que o C010 já tem, antes dos outros documentos. */
function posicaoDasNotas(linhas: readonly string[], secao: Secao): number {
  for (let i = secao.inicio + 1; i < secao.fim; i += 1) if (!REGISTROS_DA_NOTA.has(regDe(linhas[i] ?? ""))) return i;
  return secao.fim;
}

function conferirEntrada(linhas: readonly string[], icms: readonly EfdIcms[]): readonly string[] {
  const abertura = camposDe(linhas[0] ?? "");
  const cnpj = abertura[CONTRIB_0000.CNPJ] ?? "";
  const dtIni = abertura[CONTRIB_0000.DT_INI] ?? "";
  if (abertura[0] !== "0000" || !/^\d{14}$/.test(cnpj) || !/^\d{8}$/.test(dtIni)) {
    throw new FiscalFileError("O arquivo original não é uma EFD Contribuições (registro 0000 sem CNPJ ou sem período).");
  }
  for (const registro of ["0001", "0990", "C001", "C990", "9999"]) {
    if (!linhas.some((l) => regDe(l) === registro)) throw new FiscalFileError(`O arquivo original não tem o registro ${registro}.`);
  }
  const vistos = new Set<string>();
  for (const e of icms) {
    if (e.mes !== dtIni.slice(2)) throw new FiscalFileError(`${e.arquivo}: é de ${e.mes.slice(0, 2)}/${e.mes.slice(2)}, e a EFD Contribuições é de ${dtIni.slice(2, 4)}/${dtIni.slice(4)}.`);
    if (e.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) throw new FiscalFileError(`${e.arquivo}: o CNPJ ${e.cnpj} não é da mesma empresa da EFD Contribuições.`);
    if (vistos.has(e.cnpj)) throw new FiscalFileError(`Mais de um arquivo da EFD ICMS/IPI para o estabelecimento ${e.cnpj}: passe só o vigente.`);
    vistos.add(e.cnpj);
  }
  return abertura;
}

function resumir(relatorio: readonly LinhaRelatorio[]): Record<string, number> {
  const resumo: Record<string, number> = {};
  for (const r of relatorio) {
    const chave = r.motivo ? `${r.tipo}: ${r.motivo}` : r.tipo;
    resumo[chave] = (resumo[chave] ?? 0) + 1;
  }
  return resumo;
}

export function incluirInsumos(original: readonly string[], icms: readonly EfdIcms[], opcoes: OpcoesInclusao): ResultadoInclusao {
  const { registros: linhas, sobra } = ateEncerramento(original);
  const abertura = conferirEntrada(linhas, icms);
  const recibo = opcoes.reciboAnterior?.trim().toUpperCase();
  if (recibo !== undefined && !/^[0-9A-Z.\-]{1,41}$/.test(recibo)) throw new FiscalFileError("O recibo da escrituração anterior tem até 41 caracteres: letras maiúsculas, números, ponto e hífen.");
  const filho0 = (r: string): boolean => r in ORDEM_0140;
  const t: Trabalho = {
    linhas, opcoes, insercoes: new Insercoes(), relatorio: [],
    bloco0: mapear(linhas, "0140", 3, filho0, ["0500", "0600", "0900", "0990"]),
    blocoC: mapear(linhas, "C010", 1, (r) => r.startsWith("C") && r !== "C010" && r !== "C990", ["C990"]),
    contas: new Set(["", ...linhas.filter((l) => regDe(l) === "0500").map((l) => camposDe(l)[5] ?? "")]),
    chaves: new Set([...opcoes.chavesEscrituradas, ...linhas.filter((l) => regDe(l) === "C100").map((l) => camposDe(l)[C100.CHV_NFE] ?? "")].filter((k) => k !== "")),
  };
  for (const e of icms) incluirEstabelecimento(t, e);

  const incluiu = t.relatorio.some((r) => r.tipo.startsWith("nota incluída"));
  const trocas = new Map<number, string>();
  const c001 = linhas.findIndex((l) => regDe(l) === "C001");
  if (incluiu && camposDe(linhas[c001] ?? "")[1] !== "0") trocas.set(c001, "|C001|0|");
  if (recibo !== undefined) {
    trocas.set(0, montarLinha(abertura.map((v, i) => (i === CONTRIB_0000.TIPO_ESCRIT ? "1" : i === CONTRIB_0000.NUM_REC_ANTERIOR ? recibo : v))));
  }
  const aviso = (detalhe: string): void => { t.relatorio.push(linhaRelatorio({ tipo: "aviso", detalhe })); };
  if ([...recontarEncerramentos(linhas, ["0", "C"])].sort().join("\n") !== [...linhas].sort().join("\n")) {
    aviso("os registros de encerramento do arquivo original (0990, C990, 9900, 9990, 9999) não batem com a recontagem do gerador: confira no PVA");
  }
  if (sobra) aviso("o arquivo original tinha conteúdo depois do 9999 (assinatura): não foi copiado; o arquivo corrigido é assinado de novo no PVA");
  if (recibo === undefined) aviso("o 0000 não foi marcado como retificador (nenhum recibo informado): marque no PVA ou gere de novo com o recibo");
  aviso("o bloco M não foi alterado: a apuração (M100/M105, M200, M500/M505, M600) tem de ser refeita no PVA depois de importar o arquivo");
  return { linhas: recontarEncerramentos(t.insercoes.aplicar(linhas, trocas), ["0", "C"]), relatorio: t.relatorio, resumo: resumir(t.relatorio) };
}
