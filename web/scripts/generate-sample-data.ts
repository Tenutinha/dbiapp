/**
 * Generates realistic sample files for the "vendas-executivo" template in ./sample-data.
 * Fact + 2 dimensions as Parquet, dim_cliente as CSV (to exercise CSV → Parquet conversion).
 * Usage: npm run sample-data [-- <fact rows>]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const OUT_DIR = path.join(process.cwd(), "sample-data", "vendas-executivo");
const FACT_ROWS = Number(process.argv[2] ?? 1_000_000);
const out = (file: string): string => `'${path.join(OUT_DIR, file).replace(/\\/g, "/")}'`;

const STATEMENTS = [
  "SELECT setseed(0.42)",
  `COPY (
    SELECT i AS id_loja,
      'Loja ' || lpad(i::VARCHAR, 3, '0') AS loja,
      ['Sudeste','Sul','Nordeste','Centro-Oeste','Norte'][1 + (i % 5)] AS regiao,
      CASE WHEN i % 7 = 0 THEN 'E-commerce' WHEN i % 3 = 0 THEN 'Franquia' ELSE 'Loja própria' END AS canal
    FROM range(1, 61) t(i)
  ) TO ${out("dim_loja.parquet")} (FORMAT parquet)`,
  `COPY (
    SELECT i AS id_produto,
      ['Notebook','Monitor','Teclado','Mouse','Headset','Cadeira','Mesa','Webcam','SSD','Roteador'][1 + (i % 10)]
        || ' ' || ['Pro','Max','Lite','Plus','One'][1 + (i % 5)] || ' ' || i AS produto,
      CASE WHEN i % 10 IN (0,1,8) THEN 'Informática' WHEN i % 10 IN (2,3,7) THEN 'Periféricos'
           WHEN i % 10 IN (4,9) THEN 'Áudio e Rede' ELSE 'Móveis' END AS categoria,
      ['Atlas','Nimbus','Orion','Vega'][1 + (i % 4)] AS marca
    FROM range(1, 401) t(i)
  ) TO ${out("dim_produto.parquet")} (FORMAT parquet)`,
  `COPY (
    SELECT i AS id_cliente,
      'Cliente ' || i AS nome,
      ['Varejo','Corporativo','PME','Governo'][1 + (i % 4)] AS segmento,
      ['SP','RJ','MG','PR','RS','BA','PE','GO','SC','DF'][1 + (i % 10)] AS uf
    FROM range(1, 20001) t(i)
  ) TO ${out("dim_cliente.csv")} (HEADER, DELIMITER ',')`,
  `COPY (
    WITH base AS (
      SELECT i,
        (DATE '2024-01-01' + CAST(floor(random() * 700) AS INTEGER)) AS data,
        1 + CAST(floor(random() * 20000) AS INTEGER) AS id_cliente,
        1 + CAST(floor(random() * 400) AS INTEGER) AS id_produto,
        1 + CAST(floor(random() * 60) AS INTEGER) AS id_loja,
        1 + CAST(floor(random() * 4) AS INTEGER) AS quantidade,
        round(40 + random() * 2400, 2) AS preco,
        round(random() * 0.15, 3) AS desc_pct,
        round(0.45 + random() * 0.3, 3) AS custo_pct
      FROM range(0, ${FACT_ROWS}) t(i)
    )
    SELECT (i // 2) + 1 AS id_venda, data, id_cliente, id_produto, id_loja, quantidade,
      round(preco * quantidade, 2) AS valor_bruto,
      round(preco * quantidade * desc_pct, 2) AS desconto,
      round(preco * quantidade * (1 - desc_pct), 2) AS valor_liquido,
      round(preco * quantidade * custo_pct, 2) AS custo
    FROM base
  ) TO ${out("fato_vendas.parquet")} (FORMAT parquet, COMPRESSION zstd)`,
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  try {
    for (const stmt of STATEMENTS) await conn.run(stmt);
  } finally {
    conn.closeSync();
  }
  console.log(`sample data (${FACT_ROWS.toLocaleString("pt-BR")} sales rows) written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
