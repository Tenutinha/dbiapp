/**
 * CFOP que geram crédito de PIS/COFINS: a tabela "CFOP – Operações Geradoras de Créditos" do SPED, que o
 * PVA da EFD Contribuições usa para levar um item ao M105/M505. Fica como dado versionado em
 * ./tabelas/cfop-geradores-credito.json, com a fonte, a data e a situação (hoje é o parâmetro da análise
 * original, ainda não conferido contra a planilha oficial). Puro: sem I/O.
 */
import tabela from "./tabelas/cfop-geradores-credito.json";

export interface TabelaCfopCredito {
  /** Se a lista foi conferida contra a planilha oficial (texto livre, vai para o relatório). */
  situacao: string;
  /** De onde a lista veio (para o relatório). */
  origem: string;
  cfop: ReadonlySet<string>;
}

const soDigitos = (v: string): string => v.replace(/\D/g, "");

/** A tabela guardada no repositório. */
export function tabelaCfopCredito(): TabelaCfopCredito {
  return {
    situacao: tabela.situacao,
    origem: `tabela do repositório (tabelas/cfop-geradores-credito.json, de ${tabela.consulta})`,
    cfop: new Set(tabela.grupos.flatMap((g) => g.cfop)),
  };
}

/**
 * Uma lista dada por quem roda o gerador: um CFOP por linha (o que vier depois do código, separado por
 * `;`, `,`, `|` ou tabulação, é ignorado; linhas sem código de 4 dígitos no começo, como o cabeçalho, também).
 */
export function tabelaCfopDeTexto(texto: string, origem: string): TabelaCfopCredito {
  const cfop = new Set<string>();
  for (const linha of texto.split(/\r?\n/)) {
    const codigo = soDigitos((linha.split(/[;,|\t]/)[0] ?? "").trim());
    if (/^[1-3]\d{3}$/.test(codigo)) cfop.add(codigo);
  }
  if (cfop.size === 0) throw new Error(`nenhum CFOP de entrada (1xxx, 2xxx, 3xxx) em ${origem}`);
  return { situacao: "informada por quem rodou", origem, cfop };
}

export const cfopSemPontos = (cfop: string | undefined): string => soDigitos(cfop ?? "");
