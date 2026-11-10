/**
 * Regras da organização da pasta do Mapa da Votação no bucket (orgs/mapa-da-votacao/).
 * Puro: recebe o caminho relativo à pasta da organização e devolve para onde o arquivo vai
 * (null = já está no lugar ou é pasta gerenciada pelo app).
 *
 *   clientes/<cargo>/brutos/votacao-secao/<ano>/<UF>_t<turno>.parquet
 *                                                       votos por seção: cada cargo é um cliente da org
 *   brutos/tse/<conjunto>/<ano>/<UF|BR|BRASIL>.<ext>     downloads originais do TSE
 *   brutos/tse-tratado/…                                versões tratadas pelo projeto antigo do Mapa
 *   brutos/cadastros/, brutos/emendas/, brutos/pesquisas/, brutos/geo/
 *   clientes/<cargo>/preparado/votos-validos/            no contrato do dashboard (gerado pelo importador)
 *   midia/                                              fotos, vídeos e prints
 *   arquivo-morto/                                      backups antigos e o que nenhuma regra reconhece
 */

/** Pastas que o app gerencia: nunca são tocadas. */
const DO_APP = ["branding/", "clientes/", "datasets/", "uploads/"];

const PASTAS_DIRETAS: readonly [string, string][] = [
  ["acervo/backup/", "arquivo-morto/backup/"],
  ["acervo/backup_dados_eleicoes/", "arquivo-morto/backup-dados-eleicoes/"],
  ["acervo/fotos/", "midia/fotos/"],
  ["acervo/videos/", "midia/videos/"],
  ["acervo/galeria_prints/", "midia/galeria-prints/"],
  ["acervo/geo/", "brutos/geo/"],
  ["acervo/dados_emendas/", "brutos/emendas/"],
  ["acervo/dados_pesquisas/", "brutos/pesquisas/"],
];

const traco = (s: string): string => s.toLowerCase().replace(/_/g, "-");

/**
 * Cargo do arquivo → cliente da organização (o endereço do cliente). O deputado distrital é o deputado
 * estadual do DF: fica com o cliente Deputado Estadual.
 */
export const CLIENTE_DO_CARGO: Record<string, string> = {
  presidente: "presidente",
  governador: "governador",
  senador: "senador",
  deputado_federal: "deputado-federal",
  deputado_estadual: "deputado-estadual",
  deputado_distrital: "deputado-estadual",
  prefeito: "prefeito",
  vereador: "vereador",
};
const morto = (rel: string): string => `arquivo-morto/${rel}`;

/** acervo/tse/<ano>/<conjunto>_<ano>[_<UF|BRASIL>].<ext> */
function destinoTse(rel: string): string {
  const nome = rel.slice(rel.lastIndexOf("/") + 1);
  const m = /^(.+?)_(\d{4})(?:_([A-Za-z]{2}|BRASIL))?\.(csv|parquet|txt|zip)$/i.exec(nome);
  if (!m) return morto(rel);
  const [, conjunto, ano, uf, ext] = m;
  return `brutos/tse/${traco(conjunto)}/${ano}/${(uf ?? "BR").toUpperCase()}.${ext.toLowerCase()}`;
}

/** acervo/dados_eleicoes/[<UF>/]<arquivo> — tabelas e views tratadas pelo projeto antigo. */
function destinoDadosEleicoes(rel: string): string {
  const resto = rel.slice("acervo/dados_eleicoes/".length);
  const partes = resto.split("/");
  const nome = partes[partes.length - 1];
  const pastaUf = partes.length > 1 ? partes[0].toUpperCase() : null;
  const T = "brutos/tse-tratado";

  let m = /^vw_f_votacao_secao_uf_([a-z]{2})_([a-z_]+?)_(\d{4})_t([12])\.parquet$/.exec(nome);
  if (m && CLIENTE_DO_CARGO[m[2]]) {
    return `clientes/${CLIENTE_DO_CARGO[m[2]]}/brutos/votacao-secao/${m[3]}/${m[1].toUpperCase()}_t${m[4]}.parquet`;
  }
  if (nome === "vw_f_votacao_secao_uf_br.parquet") return "clientes/presidente/brutos/votacao-secao/todos-os-anos_BR.parquet";
  m = /^perfil_comparecimento_abstencao_(\d{4})_([a-z]{2})\.parquet$/.exec(nome);
  if (m) return `${T}/comparecimento/${m[1]}/${m[2].toUpperCase()}.parquet`;
  m = /^dim_perfil_(\d{4})\.parquet$/.exec(nome);
  if (m && pastaUf) return `${T}/perfil-eleitorado/${m[1]}/${pastaUf}.parquet`;
  if (nome === "dim_candidatos_br.parquet") return `${T}/candidatos/BR.parquet`;
  m = /^dim_(candidatos|locais)_([a-z]{2})\.parquet$/.exec(nome);
  if (m) return `${T}/${m[1]}/${m[2].toUpperCase()}.parquet`;
  if (!pastaUf) {
    if (nome === "dim_candidatos.parquet") return `${T}/candidatos/todas-as-ufs.parquet`;
    if (nome === "dim_locais.parquet") return `${T}/locais/todas-as-ufs.parquet`;
    if (nome === "dim_municipios.parquet") return "brutos/cadastros/municipios.parquet";
    if (nome === "dim_partidos.parquet") return "brutos/cadastros/partidos.parquet";
  }
  return morto(rel);
}

export function destinoDe(rel: string): string | null {
  if (rel === "" || rel.endsWith("/")) return null; // marcadores de pasta
  if (DO_APP.some((p) => rel.startsWith(p))) return null;
  // Preparados antigos (grupos de cargos): o importador refaz um por cargo, na pasta de cada cliente.
  if (rel.startsWith("preparado/")) return `arquivo-morto/preparado-antigo/${rel.slice("preparado/".length)}`;
  if (!rel.startsWith("acervo/")) return null; // já organizado (brutos/, midia/, arquivo-morto/…)
  for (const [de, para] of PASTAS_DIRETAS) if (rel.startsWith(de)) return para + rel.slice(de.length);
  if (rel.startsWith("acervo/tse/")) return destinoTse(rel);
  if (rel.startsWith("acervo/dados_eleicoes/")) return destinoDadosEleicoes(rel);
  return morto(rel);
}

/** Destino de uma cópia que colide com outro arquivo diferente no mesmo destino. */
export const destinoDuplicado = (rel: string): string => `arquivo-morto/duplicados/${rel}`;
