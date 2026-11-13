"""
Auditoria fiscal: monta as tabelas do dashboard "Auditoria fiscal" a partir dos arquivos fiscais já lidos.
Documentação: docs/auditoria-fiscal.md.

Pasta de trabalho (AUDITORIA_PASTA, padrão: a pasta atual), fora do repositório:
  entrada/contrib_c/*.parquet   C010, C100 e C170 de cada EFD Contribuições, linha a linha (extrair.ts)
  entrada/icms_registros.parquet  fato "registros" publicada da EFD ICMS/IPI (extrair.ts)
  entrada/nfe_itens_*.parquet     fato "nfe_itens" publicada do dashboard NF-e (extrair.ts)
  dados/                          saída: achados.parquet (fato), regras.parquet (dimensão), cobertura.parquet (fato extra)

Uso: uv run -q --no-project --python 3.11 --with duckdb python -I web/scripts/fiscal/auditoria/preparar.py [--contar]
"""
import os
import sys
from pathlib import Path

import duckdb

PASTA = Path(os.environ.get("AUDITORIA_PASTA", Path.cwd())).resolve()
ENTRADA = PASTA / "entrada"
DADOS = PASTA / "dados"
CONTRIB_C = os.environ.get("AUDITORIA_CONTRIB_C", (ENTRADA / "contrib_c" / "*.parquet").as_posix())
TOL_SOMA = 0.05   # R$: diferença aceita entre a nota e a soma dos itens
TOL_CALC = 0.02   # R$: diferença aceita entre base × alíquota e o valor informado

# Regras: id, grupo, título, gravidade, o que confere, o que fazer.
REGRAS = [
    ("C01", "Consistência interna", "Itens não somam o PIS da nota", "Alta",
     "O PIS do C100 difere da soma do PIS dos seus itens (C170), com tolerância de R$ 0,05.",
     "Conferir a nota no sistema de origem e corrigir o C100 ou os itens."),
    ("C02", "Consistência interna", "Itens não somam a COFINS da nota", "Alta",
     "A COFINS do C100 difere da soma da COFINS dos seus itens (C170), com tolerância de R$ 0,05.",
     "Conferir a nota no sistema de origem e corrigir o C100 ou os itens."),
    ("C03", "Consistência interna", "Itens não somam o valor das mercadorias", "Média",
     "O VL_MERC do C100 difere da soma do VL_ITEM dos itens (C170), com tolerância de R$ 0,05.",
     "Conferir valores de itens e descontos da nota."),
    ("C04", "Consistência interna", "PIS diferente de base × alíquota", "Alta",
     "No item, VL_PIS difere de VL_BC_PIS × ALIQ_PIS ÷ 100 (tolerância de R$ 0,02). Itens tributados por quantidade ficam fora.",
     "Recalcular o PIS do item; diferença a maior é recolhimento indevido, a menor é risco de autuação."),
    ("C05", "Consistência interna", "COFINS diferente de base × alíquota", "Alta",
     "No item, VL_COFINS difere de VL_BC_COFINS × ALIQ_COFINS ÷ 100 (tolerância de R$ 0,02). Itens tributados por quantidade ficam fora.",
     "Recalcular a COFINS do item; diferença a maior é recolhimento indevido, a menor é risco de autuação."),
    ("C06", "Consistência interna", "CST do PIS diferente do CST da COFINS", "Média",
     "No item, CST_PIS e CST_COFINS deveriam ser iguais: as duas contribuições seguem o mesmo tratamento.",
     "Revisar a parametrização fiscal do item ou da operação."),
    ("C07", "Consistência interna", "CST incompatível com a operação", "Alta",
     "CST de saída (01 a 49) numa entrada, ou CST de entrada (50 a 99) numa saída.",
     "Corrigir o CST: o de entrada define o crédito, o de saída o débito."),
    ("C08", "Consistência interna", "CFOP incompatível com a operação", "Média",
     "CFOP de saída (5, 6, 7) numa entrada, ou de entrada (1, 2, 3) numa saída.",
     "Corrigir o CFOP ou o indicador de operação da nota."),
    ("C09", "Consistência interna", "CST tributado sem valor", "Média",
     "CST 01, 02 ou 03 (saída tributada) ou 50 a 56 (entrada com crédito) com PIS zerado.",
     "Na saída, risco de débito não recolhido; na entrada, crédito possivelmente não aproveitado."),
    ("C10", "Consistência interna", "CST sem tributação com valor", "Alta",
     "CST de operação sem incidência, isenta, suspensa ou sem crédito (04, 06 a 09, 70 a 75) com PIS informado.",
     "Na saída, possível recolhimento indevido; na entrada, crédito indevido."),
    ("C11", "Consistência interna", "Chave de acesso inválida", "Média",
     "NF-e ou NFC-e regular cuja chave não tem 44 dígitos ou cujo dígito verificador não confere.",
     "Corrigir a chave do C100 a partir do XML."),
    ("C12", "Consistência interna", "Nota escriturada mais de uma vez", "Alta",
     "A mesma chave aparece em mais de um C100 regular (no mesmo período ou em períodos diferentes).",
     "Verificar se o crédito ou o débito foi lançado em duplicidade."),
    ("X01", "Cruzamento entre arquivos", "Nota na Contribuições e fora do ICMS/IPI", "Média",
     "Chave regular na EFD Contribuições que não aparece na EFD ICMS/IPI do mesmo estabelecimento e mês (só nos estabelecimentos e meses que têm EFD ICMS/IPI).",
     "Conferir se a nota foi escriturada no período certo da EFD ICMS/IPI."),
    ("X02", "Cruzamento entre arquivos", "Valor da nota diferente entre ICMS/IPI e Contribuições", "Média",
     "A mesma chave tem VL_DOC diferente nos dois arquivos (tolerância de R$ 0,05).",
     "Conferir qual escrituração está certa a partir do XML."),
    ("X03", "Cruzamento entre arquivos", "PIS do XML diferente do escriturado (emissão própria)", "Alta",
     "Nota emitida pela empresa: o PIS somado dos itens do XML difere do VL_PIS do C100 (tolerância de R$ 0,05).",
     "Conferir a escrituração da saída contra o XML."),
    ("O01", "Oportunidade a validar", "Produto monofásico com PIS na saída", "A validar",
     "Item de NF-e emitida pela empresa com NCM monofásico, CST 01 e PIS destacado. Na revenda de produto monofásico a alíquota é zero (CST 04).",
     "Validar com o tributário se a empresa é revendedora do item: se for, há recolhimento indevido a recuperar."),
    ("O02", "Oportunidade a validar", "Entrada no ICMS/IPI sem C100 na Contribuições", "A validar",
     "Nota de entrada regular na EFD ICMS/IPI que não aparece em nenhum C100 da EFD Contribuições. Entradas sem direito a crédito podem ficar fora da Contribuições; as demais podem ser crédito não aproveitado.",
     "Separar as entradas com direito a crédito (insumos, mercadorias para revenda) e avaliar a escrituração extemporânea do crédito."),
    ("O03", "Oportunidade a validar", "Compra em XML sem C100 na Contribuições", "A validar",
     "XML de NF-e de compra (emitida por terceiro com CFOP de venda, até o último mês da EFD Contribuições) cuja chave não aparece em nenhum C100. Notas canceladas ou recusadas aparecem aqui também.",
     "Confirmar a situação da nota e se a mercadoria dá direito a crédito; se der, avaliar o crédito extemporâneo."),
]

PIS_SAIDA_TRIB = "('01','02','03')"
PIS_ENTRADA_CRED = "('50','51','52','53','54','55','56')"
PIS_SEM_TRIB = "('04','06','07','08','09','70','71','72','73','74','75')"


def num(expr: str) -> str:
    return f"TRY_CAST(replace({expr}, ',', '.') AS DOUBLE)"


def regras_do_arquivo(rotulo: str) -> str:
    """C01 a C11 sobre as notas (nf) e os itens (itf) de um arquivo."""
    nota_cols = """'EFD Contribuições' AS fonte, n.competencia, n.cnpj_estab AS estabelecimento, n.chave, n.num_doc,
                   CASE n.ind_oper WHEN '0' THEN 'Entrada' ELSE 'Saída' END AS operacao, n.cod_part, n.arquivo, n.linha"""
    item_cols = "i.num_item, i.cod_item, i.cfop, i.cst_pis, i.cst_cofins"
    sem_item = "NULL AS num_item, NULL AS cod_item, NULL AS cfop, NULL AS cst_pis, NULL AS cst_cofins"
    item_join = "FROM itf i JOIN nf n ON n.linha = i.linha_nota"
    partes = []
    for regra, campo, nota, soma in (("C01", "VL_PIS", "vl_pis", "pis"), ("C02", "VL_COFINS", "vl_cofins", "cofins"), ("C03", "VL_MERC", "vl_merc", "merc")):
        partes.append(f"""
          SELECT '{regra}' AS regra, {nota_cols}, {sem_item}, '{campo}' AS campo, s.{soma} AS esperado, n.{nota} AS encontrado
          FROM nf n JOIN (SELECT linha_nota, sum(vl_pis) AS pis, sum(vl_cofins) AS cofins, sum(vl_item) AS merc FROM itf GROUP BY 1) s
            ON s.linha_nota = n.linha
          WHERE abs(coalesce(n.{nota}, 0) - coalesce(s.{soma}, 0)) > {TOL_SOMA}""")
    for regra, campo, vl, bc, aliq, qtd in (("C04", "VL_PIS", "vl_pis", "bc_pis", "aliq_pis", "qtd_bc_pis"),
                                            ("C05", "VL_COFINS", "vl_cofins", "bc_cofins", "aliq_cofins", "qtd_bc_cofins")):
        partes.append(f"""
          SELECT '{regra}', {nota_cols}, {item_cols}, '{campo}', round(i.{bc} * i.{aliq} / 100, 2), i.{vl} {item_join}
          WHERE i.{qtd} IS NULL AND abs(coalesce(i.{vl}, 0) - coalesce(round(i.{bc} * i.{aliq} / 100, 2), 0)) > {TOL_CALC}""")
    partes.append(f"SELECT 'C06', {nota_cols}, {item_cols}, 'CST_COFINS', NULL, NULL {item_join} WHERE i.cst_pis <> i.cst_cofins")
    partes.append(f"""SELECT 'C07', {nota_cols}, {item_cols}, 'CST_PIS', NULL, NULL {item_join}
          WHERE (n.ind_oper = '0' AND TRY_CAST(i.cst_pis AS INT) < 50) OR (n.ind_oper = '1' AND TRY_CAST(i.cst_pis AS INT) >= 50)""")
    partes.append(f"""SELECT 'C08', {nota_cols}, {item_cols}, 'CFOP', NULL, NULL {item_join}
          WHERE (n.ind_oper = '0' AND left(i.cfop, 1) IN ('5','6','7')) OR (n.ind_oper = '1' AND left(i.cfop, 1) IN ('1','2','3'))""")
    partes.append(f"""SELECT 'C09', {nota_cols}, {item_cols}, 'VL_PIS', NULL, i.vl_pis {item_join}
          WHERE (i.cst_pis IN {PIS_SAIDA_TRIB} OR i.cst_pis IN {PIS_ENTRADA_CRED}) AND coalesce(i.vl_pis, 0) = 0""")
    partes.append(f"""SELECT 'C10', {nota_cols}, {item_cols}, 'VL_PIS', 0, i.vl_pis {item_join}
          WHERE i.cst_pis IN {PIS_SEM_TRIB} AND coalesce(i.vl_pis, 0) > 0""")
    # Dígito verificador da chave: módulo 11 sobre os 43 primeiros dígitos, pesos 2 a 9 da direita para a esquerda.
    partes.append(f"""SELECT 'C11', {nota_cols}, {sem_item}, 'CHV_NFE', NULL, NULL
          FROM (SELECT *, list_sum(list_transform(range(1, 44),
                  k -> TRY_CAST(substr(chave, 44 - k, 1) AS INT) * (2 + (k - 1) % 8))) AS dv FROM nf) n
          WHERE {REGULAR.replace('cod_', 'n.cod_')} AND (NOT regexp_full_match(coalesce(n.chave, ''), '[0-9]{{44}}')
             OR (CASE WHEN 11 - n.dv % 11 >= 10 THEN 0 ELSE 11 - n.dv % 11 END) <> TRY_CAST(right(n.chave, 1) AS INT))""")
    return " UNION ALL ".join(partes)


REGULAR = "cod_sit IN ('00','01','06','07','08') AND cod_mod IN ('55','65')"


def montar(con: duckdb.DuckDBPyConnection) -> None:
    """Arquivo a arquivo (o Parquet está agrupado por arquivo, e cada leitura pega só o seu trecho)."""
    src = f"read_parquet('{CONTRIB_C}')"
    arquivos = [r[0] for r in con.execute(f"SELECT DISTINCT arquivo FROM {src} ORDER BY 1").fetchall()]
    sql_regras = regras_do_arquivo("")
    for n_arq, arquivo in enumerate(arquivos, 1):
        # Cada item (C170) é da nota (C100) anterior mais próxima; cada nota, do estabelecimento (C010) anterior.
        con.execute(f"""
          CREATE OR REPLACE TEMP TABLE f AS
          SELECT arquivo, cnpj, strftime(periodo, '%Y-%m') AS competencia, linha, registro,
                 c01, c02, c03, c04, c05, c06, c07, c08, c10, c11, c15, c24, c25, c26, c27, c29, c30, c31, c32, c33, c35,
                 max(CASE WHEN registro = 'C010' THEN linha END) OVER w AS linha_estab,
                 max(CASE WHEN registro = 'C100' THEN linha END) OVER w AS linha_nota
          FROM {src} WHERE arquivo = ? AND registro IN ('C010', 'C100', 'C170')
          WINDOW w AS (ORDER BY linha ROWS UNBOUNDED PRECEDING)
        """, [arquivo])
        con.execute("""CREATE OR REPLACE TEMP TABLE f AS
          SELECT f.*, e.c01 AS cnpj_estab FROM f LEFT JOIN (SELECT linha, c01 FROM f WHERE registro = 'C010') e ON e.linha = f.linha_estab""")
        con.execute(f"""
          CREATE OR REPLACE TEMP TABLE nf AS
          SELECT arquivo, cnpj, cnpj_estab, competencia, linha, c01 AS ind_oper, c02 AS ind_emit, c03 AS cod_part,
                 c04 AS cod_mod, c05 AS cod_sit, c07 AS num_doc, c08 AS chave, {num('c11')} AS vl_doc, {num('c15')} AS vl_merc,
                 {num('c25')} AS vl_pis, {num('c26')} AS vl_cofins
          FROM f WHERE registro = 'C100'
        """)
        con.execute(f"""
          CREATE OR REPLACE TEMP TABLE itf AS
          SELECT linha, linha_nota, c01 AS num_item, c02 AS cod_item, {num('c06')} AS vl_item, c10 AS cfop,
                 c24 AS cst_pis, {num('c25')} AS bc_pis, {num('c26')} AS aliq_pis, NULLIF(c27, '') AS qtd_bc_pis, {num('c29')} AS vl_pis,
                 c30 AS cst_cofins, {num('c31')} AS bc_cofins, {num('c32')} AS aliq_cofins, NULLIF(c33, '') AS qtd_bc_cofins,
                 {num('c35')} AS vl_cofins
          FROM f WHERE registro = 'C170'
        """)
        if n_arq == 1:
            con.execute("CREATE OR REPLACE TABLE notas AS SELECT * FROM nf LIMIT 0")
            con.execute(f"CREATE OR REPLACE TABLE achados_contrib AS SELECT * FROM ({sql_regras}) LIMIT 0")
        con.execute("INSERT INTO notas SELECT * FROM nf")
        con.execute(f"INSERT INTO achados_contrib {sql_regras}")
        print(f"  {n_arq}/{len(arquivos)} {arquivo}", flush=True)
    con.execute(f"CREATE OR REPLACE TABLE regulares AS SELECT * FROM notas WHERE {REGULAR}")
    con.execute("""
      INSERT INTO achados_contrib
      SELECT 'C12', 'EFD Contribuições', n.competencia, n.cnpj_estab, n.chave, n.num_doc,
             CASE n.ind_oper WHEN '0' THEN 'Entrada' ELSE 'Saída' END, n.cod_part, n.arquivo, n.linha,
             NULL, NULL, NULL, NULL, NULL, 'CHV_NFE', NULL, count(*) OVER (PARTITION BY n.chave)
      FROM regulares n WHERE length(n.chave) = 44 QUALIFY count(*) OVER (PARTITION BY n.chave) > 1
    """)


def cruzar(con: duckdb.DuckDBPyConnection) -> None:
    # Sem dashboard EFD ICMS/IPI ou NF-e no espaço, as regras que cruzam com ele ficam sem achados.
    icms = ENTRADA / "icms_registros.parquet"
    xmls = sorted(ENTRADA.glob("nfe_itens_*.parquet"))
    if xmls:
        con.execute(f"""CREATE OR REPLACE TABLE nfe AS SELECT * FROM read_parquet('{(ENTRADA / "nfe_itens_*.parquet").as_posix()}')
                        QUALIFY row_number() OVER (PARTITION BY chnfe, prod_item ORDER BY nome_arquivo_txt) = 1""")
    else:
        print("aviso: sem XML de NF-e na entrada; X03, O01 e O03 ficam sem achados")
        con.execute("""CREATE OR REPLACE TABLE nfe (chnfe VARCHAR, prod_item VARCHAR, ide_nnf VARCHAR, emit_cnpj VARCHAR,
                       dest_cnpj VARCHAR, emissao_data DATE, imposto_pis_vpis VARCHAR, prod_vprod VARCHAR, nome_arquivo_txt VARCHAR,
                       prod_cfop VARCHAR, prod_cprod VARCHAR, ncm_monofasico VARCHAR, imposto_pis_cst VARCHAR, imposto_cofins_cst VARCHAR)""")
    if icms.exists():
        con.execute(f"""
          CREATE OR REPLACE TABLE icms AS
          SELECT arquivo, cnpj, strftime(periodo, '%Y-%m') AS competencia, linha, c01 AS ind_oper, c03 AS cod_part, c07 AS num_doc,
                 c08 AS chave, {num('c11')} AS vl_doc
          FROM read_parquet('{icms.as_posix()}') WHERE registro = 'C100' AND c05 IN ('00','01','06','07','08') AND c04 IN ('55','65')
        """)
    else:
        print("aviso: sem EFD ICMS/IPI na entrada; X01, X02 e O02 ficam sem achados")
        con.execute("""CREATE OR REPLACE TABLE icms (arquivo VARCHAR, cnpj VARCHAR, competencia VARCHAR, linha BIGINT, ind_oper VARCHAR,
                       cod_part VARCHAR, num_doc VARCHAR, chave VARCHAR, vl_doc DOUBLE)""")
    con.execute("CREATE OR REPLACE TABLE meses_icms AS SELECT DISTINCT cnpj, competencia FROM icms")
    cols_icms = """'EFD ICMS/IPI' AS fonte, i.competencia, i.cnpj AS estabelecimento, i.chave, i.num_doc,
                   CASE i.ind_oper WHEN '0' THEN 'Entrada' ELSE 'Saída' END, i.cod_part, i.arquivo, i.linha"""
    sem_item = "NULL, NULL, NULL, NULL, NULL"
    nota_cols = """'EFD Contribuições', n.competencia, n.cnpj_estab, n.chave, n.num_doc,
                   CASE n.ind_oper WHEN '0' THEN 'Entrada' ELSE 'Saída' END, n.cod_part, n.arquivo, n.linha"""
    con.execute(f"""
      INSERT INTO achados_contrib
      SELECT 'O02', {cols_icms}, {sem_item}, 'CHV_NFE', i.vl_doc, NULL FROM icms i
      WHERE i.ind_oper = '0' AND NOT EXISTS (SELECT 1 FROM regulares n WHERE n.chave = i.chave)
      UNION ALL
      SELECT 'X01', {nota_cols}, {sem_item}, 'CHV_NFE', n.vl_doc, NULL FROM regulares n
      WHERE (n.cnpj_estab, n.competencia) IN (SELECT (cnpj, competencia) FROM meses_icms)
        AND NOT EXISTS (SELECT 1 FROM icms i WHERE i.chave = n.chave AND i.competencia = n.competencia)
      UNION ALL
      SELECT 'X02', {nota_cols}, {sem_item}, 'VL_DOC', i.vl_doc, n.vl_doc FROM regulares n
      JOIN icms i ON i.chave = n.chave AND i.competencia = n.competencia WHERE abs(i.vl_doc - n.vl_doc) > {TOL_SOMA}
    """)
    # NF-e: uma linha por nota (somando os itens) e os itens monofásicos.
    con.execute("""
      CREATE OR REPLACE TABLE xml AS
      SELECT chnfe AS chave, any_value(ide_nnf) AS num_doc, any_value(emit_cnpj) AS emit, any_value(dest_cnpj) AS dest,
             strftime(min(emissao_data), '%Y-%m') AS competencia, sum(TRY_CAST(imposto_pis_vpis AS DOUBLE)) AS vl_pis,
             sum(TRY_CAST(prod_vprod AS DOUBLE)) AS vl_prod, any_value(nome_arquivo_txt) AS arquivo,
             bool_or(left(prod_cfop, 2) IN ('51', '61', '54', '64')) AS compra
      FROM nfe GROUP BY chnfe
    """)
    raiz = con.execute("SELECT left(any_value(cnpj), 8) FROM notas").fetchone()[0]
    ultimo = con.execute("SELECT max(competencia) FROM notas").fetchone()[0]
    cols_xml = f"""'NF-e (XML)', x.competencia, CASE WHEN left(x.emit, 8) = '{raiz}' THEN x.emit ELSE x.dest END, x.chave, x.num_doc,
                   CASE WHEN left(x.emit, 8) = '{raiz}' THEN 'Saída' ELSE 'Entrada' END,
                   CASE WHEN left(x.emit, 8) = '{raiz}' THEN x.dest ELSE x.emit END, x.arquivo, NULL"""
    con.execute(f"""
      INSERT INTO achados_contrib
      SELECT 'O03', {cols_xml}, {sem_item}, 'CHV_NFE', x.vl_prod, NULL FROM xml x
      WHERE x.competencia <= '{ultimo}' AND left(x.emit, 8) <> '{raiz}' AND left(x.dest, 8) = '{raiz}' AND x.compra
        AND NOT EXISTS (SELECT 1 FROM notas n WHERE n.chave = x.chave)
      UNION ALL
      SELECT 'X03', {nota_cols}, {sem_item}, 'VL_PIS', x.vl_pis, n.vl_pis FROM xml x
      JOIN regulares n ON n.chave = x.chave AND n.ind_emit = '0'
      WHERE left(x.emit, 8) = '{raiz}' AND abs(coalesce(x.vl_pis, 0) - coalesce(n.vl_pis, 0)) > {TOL_SOMA}
    """)
    con.execute(f"""
      INSERT INTO achados_contrib
      SELECT 'O01', 'NF-e (XML)', strftime(emissao_data, '%Y-%m'), emit_cnpj, chnfe, ide_nnf, 'Saída', dest_cnpj,
             nome_arquivo_txt, NULL, prod_item, prod_cprod, prod_cfop, imposto_pis_cst, imposto_cofins_cst, 'VL_PIS', 0,
             TRY_CAST(imposto_pis_vpis AS DOUBLE)
      FROM nfe
      WHERE ncm_monofasico = 'S' AND imposto_pis_cst = '01' AND TRY_CAST(imposto_pis_vpis AS DOUBLE) > 0 AND left(emit_cnpj, 8) = '{raiz}'
    """)


def cobertura(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("""
      CREATE OR REPLACE TABLE cobertura AS
      SELECT 'EFD Contribuições' AS fonte, competencia, count(*) AS notas, sum(vl_doc) AS valor FROM notas GROUP BY ALL
      UNION ALL SELECT 'EFD ICMS/IPI', competencia, count(*), sum(vl_doc) FROM icms GROUP BY ALL
      UNION ALL SELECT 'NF-e (XML)', competencia, count(*), sum(vl_prod) FROM xml GROUP BY ALL
    """)


def main() -> None:
    DADOS.mkdir(exist_ok=True)
    if not list((ENTRADA / 'contrib_c').glob('*.parquet')) and 'AUDITORIA_CONTRIB_C' not in os.environ:
        sys.exit(f'falta {ENTRADA / "contrib_c"}: rode extrair.ts antes')
    con = duckdb.connect(str(PASTA / "_trabalho.duckdb"))
    con.execute("SET memory_limit='5GB'; SET threads=4; SET preserve_insertion_order=false")
    con.execute(f"SET temp_directory='{(PASTA / '_duckdb_tmp').as_posix()}'")
    montar(con)
    cruzar(con)
    cobertura(con)
    if "--contar" in sys.argv:
        for r in con.execute("SELECT regra, count(*), count(DISTINCT chave) FROM achados_contrib GROUP BY 1 ORDER BY 1").fetchall():
            print(r)
        return
    regras = ", ".join("(" + ", ".join("'" + v.replace("'", "''") + "'" for v in r) + ")" for r in REGRAS)
    con.execute(f"""COPY (SELECT * FROM (VALUES {regras}) t(regra, grupo, titulo, gravidade, descricao, acao))
                    TO '{(DADOS / 'regras.parquet').as_posix()}' (FORMAT parquet)""")
    con.execute(f"""
      COPY (
        SELECT a.regra, a.fonte, a.competencia, a.estabelecimento, a.chave, a.num_doc, a.operacao, a.cod_part, a.num_item,
               a.cod_item, a.cfop, a.cst_pis, a.cst_cofins, a.campo, round(a.esperado, 2) AS esperado,
               round(a.encontrado, 2) AS encontrado, round(a.encontrado - a.esperado, 2) AS diferenca,
               regexp_replace(a.arquivo, '^.*/', '') AS arquivo, a.linha
        FROM achados_contrib a ORDER BY a.competencia, a.regra, a.chave
      ) TO '{(DADOS / 'achados.parquet').as_posix()}' (FORMAT parquet, ROW_GROUP_SIZE 122880)
    """)
    con.execute(f"COPY (SELECT * FROM cobertura ORDER BY competencia, fonte) TO '{(DADOS / 'cobertura.parquet').as_posix()}' (FORMAT parquet)")
    print(con.execute(f"SELECT count(*) FROM '{(DADOS / 'achados.parquet').as_posix()}'").fetchone())


if __name__ == "__main__":
    main()
