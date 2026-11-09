/**
 * Brazilian municipalities used by the sample data (public IBGE codes): the 27 capitals plus large
 * cities, ordered roughly by size so a skewed pick concentrates on the biggest ones.
 */
export interface SampleCity {
  /** 7-digit IBGE code, the key of the municipality base map. */
  code: string;
  name: string;
  uf: string;
  region: string;
  capital: boolean;
}

type Row = readonly [code: string, name: string, uf: string, region: string, capital?: boolean];

const ROWS: readonly Row[] = [
  ["3550308", "São Paulo", "SP", "Sudeste", true],
  ["3304557", "Rio de Janeiro", "RJ", "Sudeste", true],
  ["5300108", "Brasília", "DF", "Centro-Oeste", true],
  ["2304400", "Fortaleza", "CE", "Nordeste", true],
  ["2927408", "Salvador", "BA", "Nordeste", true],
  ["3106200", "Belo Horizonte", "MG", "Sudeste", true],
  ["1302603", "Manaus", "AM", "Norte", true],
  ["4106902", "Curitiba", "PR", "Sul", true],
  ["2611606", "Recife", "PE", "Nordeste", true],
  ["5208707", "Goiânia", "GO", "Centro-Oeste", true],
  ["1501402", "Belém", "PA", "Norte", true],
  ["4314902", "Porto Alegre", "RS", "Sul", true],
  ["3518800", "Guarulhos", "SP", "Sudeste"],
  ["3509502", "Campinas", "SP", "Sudeste"],
  ["2111300", "São Luís", "MA", "Nordeste", true],
  ["2704302", "Maceió", "AL", "Nordeste", true],
  ["5002704", "Campo Grande", "MS", "Centro-Oeste", true],
  ["3304904", "São Gonçalo", "RJ", "Sudeste"],
  ["2211001", "Teresina", "PI", "Nordeste", true],
  ["2507507", "João Pessoa", "PB", "Nordeste", true],
  ["3548708", "São Bernardo do Campo", "SP", "Sudeste"],
  ["3301702", "Duque de Caxias", "RJ", "Sudeste"],
  ["2408102", "Natal", "RN", "Nordeste", true],
  ["3303500", "Nova Iguaçu", "RJ", "Sudeste"],
  ["3547809", "Santo André", "SP", "Sudeste"],
  ["5103403", "Cuiabá", "MT", "Centro-Oeste", true],
  ["3170206", "Uberlândia", "MG", "Sudeste"],
  ["3552205", "Sorocaba", "SP", "Sudeste"],
  ["3534401", "Osasco", "SP", "Sudeste"],
  ["2800308", "Aracaju", "SE", "Nordeste", true],
  ["3543402", "Ribeirão Preto", "SP", "Sudeste"],
  ["3549904", "São José dos Campos", "SP", "Sudeste"],
  ["2607901", "Jaboatão dos Guararapes", "PE", "Nordeste"],
  ["4209102", "Joinville", "SC", "Sul"],
  ["2910800", "Feira de Santana", "BA", "Nordeste"],
  ["3118601", "Contagem", "MG", "Sudeste"],
  ["4205407", "Florianópolis", "SC", "Sul", true],
  ["3205002", "Serra", "ES", "Sudeste"],
  ["4113700", "Londrina", "PR", "Sul"],
  ["3136702", "Juiz de Fora", "MG", "Sudeste"],
  ["5201405", "Aparecida de Goiânia", "GO", "Centro-Oeste"],
  ["1100205", "Porto Velho", "RO", "Norte", true],
  ["3301009", "Campos dos Goytacazes", "RJ", "Sudeste"],
  ["3300456", "Belford Roxo", "RJ", "Sudeste"],
  ["3303302", "Niterói", "RJ", "Sudeste"],
  ["1400100", "Boa Vista", "RR", "Norte", true],
  ["1600303", "Macapá", "AP", "Norte", true],
  ["1200401", "Rio Branco", "AC", "Norte", true],
  ["3205309", "Vitória", "ES", "Sudeste", true],
  ["1721000", "Palmas", "TO", "Norte", true],
];

export const SAMPLE_CITIES: readonly SampleCity[] = ROWS.map(([code, name, uf, region, capital]) => ({
  code, name, uf, region, capital: capital === true,
}));
