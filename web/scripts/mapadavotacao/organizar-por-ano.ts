/**
 * Segunda organização da pasta do Mapa da Votação: os clientes deixam de ser cargos e passam a ser os
 * anos das eleições (cliente "Eleições 2026", endereço e pasta "2026"). Puro: recebe o caminho relativo à
 * pasta da organização (orgs/mapa-da-votacao/) e devolve o destino, ou null quando fica onde está.
 *
 *   clientes/<ano>/brutos/votacao-secao/<cargo>/<UF>_t<turno>.parquet    votos por seção de cada cargo
 *   clientes/<ano>/brutos/comparecimento/<UF>.parquet                    perfil do comparecimento
 *   clientes/<ano>/brutos/perfil-eleitorado/<UF>.parquet                 perfil do eleitorado
 *   clientes/<ano>/brutos/tse/<conjunto>/<arquivo>                       downloads originais do TSE do ano
 *
 * Continua na organização o que vale para todos os anos: cadastros (municípios, partidos), candidatos e
 * locais (um arquivo com todas as eleições), malhas, emendas, pesquisas, mídia e arquivo-morto. As pastas
 * dashboards/ (dados publicados, gerenciados pelo app) nunca são tocadas.
 */

/** Anos de eleição que têm cliente. */
export const ANOS = ["2010", "2014", "2016", "2018", "2020", "2022", "2024", "2026"] as const;
const eAno = (s: string): boolean => (ANOS as readonly string[]).includes(s);

/** Pastas de cargo dos clientes antigos (endereço do cliente → nome da pasta do cargo no ano). */
const CARGOS = ["presidente", "governador", "senador", "deputado-federal", "deputado-estadual", "prefeito", "vereador"];

export function destinoPorAno(rel: string): string | null {
  if (rel === "" || rel.endsWith("/")) return null;
  const p = rel.split("/");

  // clientes/<cargo>/brutos/votacao-secao/…
  if (p[0] === "clientes" && CARGOS.includes(p[1]) && p[2] === "brutos" && p[3] === "votacao-secao") {
    if (p.length === 5 && p[4] === "todos-os-anos_BR.parquet") {
      return "brutos/tse-tratado/votacao-secao-presidente-todos-os-anos_BR.parquet";
    }
    // clientes/<cargo>/brutos/votacao-secao/<ano>/<UF>_t<turno>.parquet
    const [, , , , ano, arquivo] = p;
    const m = /^([A-Z]{2})_t([12])\.parquet$/.exec(arquivo ?? "");
    if (p.length !== 6 || !eAno(ano) || !m) return null;
    const uf = m[1];
    // Presidente: o arquivo do país inteiro (BR) já tem tudo; os por UF repetiriam os votos no mesmo ano.
    if (p[1] === "presidente" && uf !== "BR") return `arquivo-morto/presidente-por-uf/${ano}/${arquivo}`;
    // No DF o "estadual" é o deputado distrital.
    const cargo = p[1] === "deputado-estadual" && uf === "DF" ? "deputado-distrital" : p[1];
    return `clientes/${ano}/brutos/votacao-secao/${cargo}/${arquivo}`;
  }

  // brutos/tse-tratado/{comparecimento,perfil-eleitorado}/<ano>/<UF>.parquet
  if (p[0] === "brutos" && p[1] === "tse-tratado" && (p[2] === "comparecimento" || p[2] === "perfil-eleitorado") && p.length === 5 && eAno(p[3])) {
    return `clientes/${p[3]}/brutos/${p[2]}/${p[4]}`;
  }

  // brutos/tse/<conjunto>/<ano>/<arquivo>
  if (p[0] === "brutos" && p[1] === "tse" && p.length === 5 && eAno(p[3])) {
    return `clientes/${p[3]}/brutos/tse/${p[2]}/${p[4]}`;
  }
  return null;
}

/** Prefixos (relativos à organização) onde há algo a mover. */
export const PREFIXOS_POR_ANO = ["clientes/", "brutos/tse-tratado/comparecimento/", "brutos/tse-tratado/perfil-eleitorado/", "brutos/tse/"];
