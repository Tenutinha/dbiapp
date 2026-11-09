/** Fictitious vocabulary of the sample data. Nothing here names a real company, person or party. */

export interface SampleProduct {
  noun: string;
  line: string;
  group: string;
}

export const PRODUCTS: readonly SampleProduct[] = [
  { noun: "Notebook", line: "Informática", group: "Computadores" },
  { noun: "Monitor", line: "Informática", group: "Monitores" },
  { noun: "Teclado", line: "Periféricos", group: "Entrada" },
  { noun: "Mouse", line: "Periféricos", group: "Entrada" },
  { noun: "Headset", line: "Áudio e Rede", group: "Áudio" },
  { noun: "Webcam", line: "Periféricos", group: "Vídeo" },
  { noun: "SSD", line: "Informática", group: "Armazenamento" },
  { noun: "Roteador", line: "Áudio e Rede", group: "Redes" },
  { noun: "Cadeira", line: "Móveis", group: "Assentos" },
  { noun: "Mesa", line: "Móveis", group: "Mesas" },
  { noun: "Impressora", line: "Informática", group: "Impressão" },
  { noun: "Tablet", line: "Informática", group: "Computadores" },
  { noun: "Caixa de Som", line: "Áudio e Rede", group: "Áudio" },
  { noun: "Switch", line: "Áudio e Rede", group: "Redes" },
  { noun: "Suporte", line: "Móveis", group: "Acessórios" },
];

export const PRODUCT_VARIANTS = ["Pro", "Max", "Lite", "Plus", "One", "Air", "Neo", "Prime", "Flex", "Ultra"] as const;

/** How many distinct products the vocabulary yields (noun × variant). */
export const PRODUCT_COUNT = PRODUCTS.length * PRODUCT_VARIANTS.length;

export const BRANDS = ["Atlas", "Nimbus", "Orion", "Vega", "Lumen", "Zênite"] as const;

export const COMPANY_NAMES = [
  "Alfa", "Aurora", "Boreal", "Cascata", "Delta", "Estrela", "Horizonte", "Ipê", "Jatobá", "Litoral",
  "Mirante", "Nativa", "Oásis", "Pampa", "Quartzo", "Rio Claro", "Serra Azul", "Tropical", "União", "Vale Verde",
] as const;

export const COMPANY_KINDS = [
  "Comércio Ltda", "Distribuidora Ltda", "Atacado S.A.", "Supermercados Ltda", "Materiais de Construção Ltda",
  "Autopeças Ltda", "Farmácias S.A.", "Transportes Ltda", "Alimentos S.A.", "Móveis Ltda", "Serviços Ltda",
  "Engenharia Ltda",
] as const;

export const FIRST_NAMES = [
  "Ana", "Bruno", "Carla", "Diego", "Elaine", "Fábio", "Gabriela", "Hugo", "Isabela", "João", "Karina", "Lucas",
  "Marina", "Nelson", "Olívia", "Paulo", "Renata", "Sérgio",
] as const;

export const LAST_NAMES = [
  "Almeida", "Barbosa", "Cardoso", "Dias", "Esteves", "Ferreira", "Gomes", "Lima", "Martins", "Nogueira",
  "Oliveira", "Pereira", "Ramos", "Santos", "Teixeira", "Vieira",
] as const;

export const CHANNELS = ["Loja própria", "E-commerce", "Franquia"] as const;
export const SEGMENTS = ["Varejo", "Corporativo", "PME", "Governo"] as const;
export const JOB_TITLES = ["Vendedor", "Vendedor", "Vendedor", "Supervisor", "Gerente", "Caixa"] as const;
export const PARTIES = ["PAB", "PCD", "PEF", "PGH", "PIJ", "PKL"] as const;
export const SPECTRUM = ["Esquerda", "Centro", "Direita"] as const;
export const COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#475569",
  "#0d9488", "#9333ea",
] as const;
export const WAREHOUSES = ["Depósito Central", "Loja", "Avariados"] as const;
export const GENERIC_STATUS = ["Ativo", "Pendente", "Concluído"] as const;
