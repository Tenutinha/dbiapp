"""
Seção "Cadastro e NCM" da Auditoria fiscal: o NCM do cadastro contra o do fornecedor, a matriz de PIS/COFINS das vendas contra
as tabelas do SPED e a qualidade do cadastro de itens.

Lê de <AUDITORIA_PASTA>/entrada/:
  icms_0200, icms_c170                (ncm_extrair.py: cadastro e itens de entrada da EFD ICMS/IPI)
  contrib_0200, contrib_itens         (ncm_contrib_extrair.py: cadastro e itens somados da EFD Contribuições)
  tabelas_pis, ncm_vigente            (tabelas_sped.py: tabelas 4.3.10 a 4.3.17 do SPED e a NCM vigente do Siscomex)
  nfe_itens_*.parquet                 (extrair.ts: a fato nfe_itens publicada do dashboard NF-e)

Grava em <AUDITORIA_PASTA>/dados/:
  ncm_fornecedor  uma linha por item do cadastro, grupo de entrada, NCM do cadastro e NCM do fornecedor (CD02)
  ncm_matriz      as vendas por mês, item, CST e alíquota de PIS que não batem com as tabelas do SPED, uma linha cada; as que
                  batem, somadas por ano, situação e tabela (CD04, PM01, PM03)
  ncm_cadastro    uma linha por item do cadastro, com os problemas dele (CD01, CD08, CZ08)

Uso (em web/):
  AUDITORIA_PASTA=<pasta> uv run -q --no-project --python 3.11 --with duckdb python -I scripts/fiscal/auditoria/ncm.py [--contar]
Documentação: docs/auditoria-fiscal.md (seção "Cadastro e NCM").
"""
from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path

import duckdb

PASTA = Path(os.environ.get("AUDITORIA_PASTA", Path.cwd())).resolve()
ENTRADA = PASTA / "entrada"
DADOS = PASTA / "dados"

# Raiz de CNPJ do grupo vem dos próprios arquivos (estabelecimentos que entregam EFD): compras de fora do grupo são as que têm
# NCM do fornecedor a comparar.
# Prazo para recuperar ou ser cobrado (CTN, arts. 150, § 4º, e 168): 5 anos contados da competência.
ANOS_PRAZO = 5
# Um código do cadastro que recebe produtos de mais NCM do que isto é genérico ("peças para assistência").
NCM_GENERICO = 20

# Grupos de entrada pelos três últimos dígitos do CFOP.
GRUPOS = {
    "Revenda": ("102", "403", "405", "152", "409", "117", "118", "121", "122"),
    "Uso e consumo": ("556", "407"),
    "Ativo": ("551", "406"),
    "Remessa e retorno": ("949", "915", "916", "912", "913", "908", "909", "910", "911", "949", "923", "924", "905", "906", "907"),
}
TRIBUTADO = ("01", "02", "03")
SEM_DEBITO = ("04", "05", "06", "07", "08", "09")

SITUACOES = [
    # (código, situação, o que fazer)
    ("M1", "Tributado, a tabela indica não tributar",
     "A tabela do SPED põe o NCM em monofásico, substituição ou alíquota zero, e a venda saiu com PIS/COFINS (CST 01 a 03). "
     "Possível pagamento a maior: conferir o NCM e a regra da tabela (exceções, destinação, vigência) e, se cabível, recuperar."),
    ("M2", "Sem débito, NCM fora das tabelas",
     "A venda saiu sem PIS/COFINS (CST 04 a 09) e o NCM não está em nenhuma linha das tabelas que traz NCM. Pode estar certo por "
     "uma regra descrita sem NCM (autopeças da Lei 10.485, benefício com condição, decisão judicial) ou pode ser débito a menor."),
    ("M0", "Coerente com as tabelas", ""),
    ("M9", "Outras saídas (CST 49 e outros)", ""),
]


def tabela(con: duckdb.DuckDBPyConnection, nome: str) -> str:
    return f"read_parquet('{(ENTRADA / nome).as_posix()}')"


def grupo_sql(coluna: str) -> str:
    casos = " ".join(f"WHEN right({coluna}, 3) IN ({', '.join(repr(c) for c in cfops)}) THEN '{g}'" for g, cfops in GRUPOS.items())
    return f"CASE {casos} ELSE 'Outras entradas' END"


def preparar_fornecedor(con: duckdb.DuckDBPyConnection) -> None:
    """CD02: cada item de compra de fora do grupo (XML) casado com o C170 de entrada (chave + número do item) e o 0200 do
    estabelecimento no mês da entrada."""
    con.execute(f"""
        CREATE TEMP TABLE raizes AS SELECT DISTINCT left(estabelecimento, 8) AS raiz FROM {tabela(con, 'icms_0200.parquet')};
        CREATE TEMP TABLE xml AS
        SELECT chnfe_xml AS chave, TRY_CAST(prod_item AS INTEGER) AS num, any_value(prod_ncm) AS ncm_forn, any_value(prod_xprod) AS xprod,
               any_value(prod_cean) AS cean, any_value(emit_cnpj) AS fornecedor, any_value(TRY_CAST(prod_vprod AS DOUBLE)) AS valor
        FROM read_parquet('{(ENTRADA / 'nfe_itens_*.parquet').as_posix()}')
        WHERE length(chnfe_xml) = 44 AND left(emit_cnpj, 8) NOT IN (SELECT raiz FROM raizes)
        GROUP BY 1, 2;
        CREATE TEMP TABLE compras AS
        SELECT row_number() OVER () AS id, x.*, i.estabelecimento, i.competencia, i.cod_item, i.cfop, i.arquivo, i.linha
        FROM xml x JOIN {tabela(con, 'icms_c170.parquet')} i ON i.chave = x.chave AND TRY_CAST(i.num_item AS INTEGER) = x.num;
        -- O NCM do cadastro no mês da entrada (havendo mais de uma versão do item no mês, a de último mês mais recente).
        CREATE TEMP TABLE compras_cad AS
        SELECT p.id, arg_max(c.cod_ncm, c.ultimo_mes) AS ncm_cad, arg_max(c.descr_item, c.ultimo_mes) AS descr_item
        FROM compras p JOIN {tabela(con, 'icms_0200.parquet')} c
          ON c.estabelecimento = p.estabelecimento AND c.cod_item = p.cod_item AND p.competencia BETWEEN c.primeiro_mes AND c.ultimo_mes
        GROUP BY p.id;
        CREATE TEMP TABLE genericos AS
        SELECT p.cod_item FROM compras p GROUP BY 1 HAVING count(DISTINCT p.ncm_forn) > {NCM_GENERICO};
        CREATE TEMP TABLE ncm_fornecedor AS
        SELECT p.cod_item, any_value(c.descr_item) AS descricao, {grupo_sql('p.cfop')} AS grupo, c.ncm_cad AS ncm_cadastro,
               p.ncm_forn AS ncm_fornecedor,
               CASE WHEN c.ncm_cad = p.ncm_forn THEN 'Igual ao fornecedor'
                    WHEN left(c.ncm_cad, 4) = left(p.ncm_forn, 4) THEN 'Outro subitem da mesma posição'
                    ELSE 'Outra posição' END AS situacao,
               p.cod_item IN (SELECT cod_item FROM genericos) AS generico,
               count(*) AS itens, count(DISTINCT p.chave) AS notas, sum(p.valor) AS valor, count(DISTINCT p.fornecedor) AS fornecedores,
               count(DISTINCT p.estabelecimento) AS estabelecimentos, min(p.competencia) AS primeiro_mes, max(p.competencia) AS ultimo_mes,
               arg_max(p.xprod, p.valor) AS exemplo_descricao_fornecedor, arg_max(p.chave, p.valor) AS exemplo_chave,
               arg_max(p.num, p.valor) AS exemplo_item, arg_max(p.arquivo, p.valor) AS exemplo_arquivo, arg_max(p.linha, p.valor) AS exemplo_linha
        FROM compras p JOIN compras_cad c USING (id)
        GROUP BY p.cod_item, grupo, c.ncm_cad, p.ncm_forn, generico;
    """)


def preparar_matriz(con: duckdb.DuckDBPyConnection) -> None:
    """CD04: CST e alíquota de PIS de cada venda (C170 de saída da EFD Contribuições) contra o tratamento que as tabelas do SPED
    dão ao NCM do item. O código do item é da empresa: o NCM é o mais frequente nos 0200 dos estabelecimentos naquele mês."""
    limite = date(date.today().year - ANOS_PRAZO, date.today().month, 1).strftime("%Y-%m")
    con.execute(f"""
        CREATE TEMP TABLE cad_mes AS
        SELECT cod_item, m.competencia, mode(cod_ncm) AS ncm, any_value(descr_item) AS descricao
        FROM {tabela(con, 'contrib_0200.parquet')} c
        JOIN (SELECT DISTINCT competencia FROM {tabela(con, 'contrib_itens.parquet')}) m ON m.competencia BETWEEN c.primeiro_mes AND c.ultimo_mes
        GROUP BY ALL;
        CREATE TEMP TABLE vendas AS
        SELECT i.competencia, i.cod_item, i.cst_pis, i.aliq_pis, i.cst_cofins, sum(i.itens) AS itens, sum(i.vl_item - i.vl_desc) AS valor,
               sum(i.vl_pis) AS pis, sum(i.vl_cofins) AS cofins, arg_max(i.arquivo, i.vl_item) AS exemplo_arquivo,
               arg_max(i.linha, i.vl_item) AS exemplo_linha
        FROM {tabela(con, 'contrib_itens.parquet')} i WHERE i.ind_oper = '1' GROUP BY ALL;
        CREATE TEMP TABLE regras AS SELECT * FROM {tabela(con, 'tabelas_pis.parquet')} WHERE ncm <> '';
        -- A linha da tabela que vale para o NCM no mês: a de prefixo mais longo, vigente no mês, sem o NCM nas exceções.
        CREATE TEMP TABLE vendas_ncm AS
        SELECT v.*, c.ncm, c.descricao,
               arg_max(r.tabela, length(r.ncm)) AS tabela, arg_max(r.tratamento, length(r.ncm)) AS tratamento,
               arg_max(r.codigo, length(r.ncm)) AS codigo, arg_max(r.descricao, length(r.ncm)) AS regra
        FROM vendas v
        LEFT JOIN cad_mes c ON c.cod_item = v.cod_item AND c.competencia = v.competencia
        LEFT JOIN regras r ON starts_with(c.ncm, r.ncm)
          AND CAST(v.competencia || '-01' AS DATE) BETWEEN coalesce(r.dt_ini, DATE '2000-01-01') AND coalesce(r.dt_fim, DATE '2100-12-31')
          AND NOT list_contains(string_split(coalesce(r.ncm_excecoes, ''), ';'), c.ncm)
        GROUP BY ALL;
        CREATE TEMP TABLE matriz_linhas AS
        SELECT *,
          CASE WHEN cst_pis IN {TRIBUTADO} AND tabela IN ('4.3.10', '4.3.11', '4.3.12', '4.3.13') THEN 'M1'
               WHEN cst_pis IN {SEM_DEBITO} AND tabela IS NULL THEN 'M2'
               WHEN cst_pis IN {TRIBUTADO + SEM_DEBITO} THEN 'M0'
               ELSE 'M9' END AS situacao_cod,
          CASE WHEN competencia >= '{limite}' THEN 'Sim' ELSE 'Não' END AS no_prazo
        FROM vendas_ncm;
    """)


def preparar_cadastro(con: duckdb.DuckDBPyConnection) -> None:
    """Uma linha por item: o NCM atual, se ele existe na NCM vigente, se o item tem NCM diferente entre estabelecimentos ou entre
    as duas EFD no mesmo mês, se o código de barras aparece com mais de um NCM, e quanto foi vendido nos últimos 12 meses."""
    con.execute(f"""
        CREATE TEMP TABLE cad AS
        SELECT 'EFD ICMS/IPI' AS fonte, estabelecimento, cod_item, descr_item, cod_barra, tipo_item, cod_ncm, primeiro_mes, ultimo_mes
        FROM {tabela(con, 'icms_0200.parquet')}
        UNION ALL
        SELECT 'EFD Contribuições', estabelecimento, cod_item, descr_item, cod_barra, tipo_item, cod_ncm, primeiro_mes, ultimo_mes
        FROM {tabela(con, 'contrib_0200.parquet')};
        CREATE TEMP TABLE ultimo AS SELECT max(ultimo_mes) AS mes FROM cad;
        -- Divergência no mesmo mês: o último mês de cada item, todas as versões que valem nele.
        CREATE TEMP TABLE item_mes AS SELECT cod_item, max(ultimo_mes) AS mes FROM cad GROUP BY 1;
        CREATE TEMP TABLE atual AS
        SELECT c.cod_item, mode(c.cod_ncm) AS ncm, arg_max(c.descr_item, c.ultimo_mes) AS descricao, mode(c.tipo_item) AS tipo_item,
               count(DISTINCT c.cod_ncm) AS ncms_no_mes, string_agg(DISTINCT c.cod_ncm, ', ' ORDER BY c.cod_ncm) AS lista_ncm,
               string_agg(DISTINCT c.fonte, ' e ' ORDER BY c.fonte) AS fontes, count(DISTINCT c.estabelecimento) AS estabelecimentos,
               max(nullif(c.cod_barra, '')) AS cod_barra, any_value(m.mes) AS ultimo_mes
        FROM cad c JOIN item_mes m ON m.cod_item = c.cod_item AND m.mes BETWEEN c.primeiro_mes AND c.ultimo_mes
        GROUP BY c.cod_item;
        CREATE TEMP TABLE historico AS SELECT cod_item, count(DISTINCT cod_ncm) AS ncms_na_historia FROM cad GROUP BY 1;
        CREATE TEMP TABLE barras AS
        SELECT cod_barra, count(DISTINCT cod_ncm) AS ncms_barra FROM cad
        WHERE length(cod_barra) IN (8, 12, 13, 14) AND cod_barra NOT LIKE '0000%' AND cod_barra NOT LIKE '2%' GROUP BY 1;
        CREATE TEMP TABLE vendido AS
        SELECT cod_item, sum(vl_item - vl_desc) AS vendido_12m FROM {tabela(con, 'contrib_itens.parquet')}
        WHERE ind_oper = '1' AND competencia > strftime(CAST((SELECT mes FROM ultimo) || '-01' AS DATE) - INTERVAL 12 MONTH, '%Y-%m')
        GROUP BY 1;
        CREATE TEMP TABLE ncm_cadastro AS
        SELECT a.cod_item, a.descricao, a.tipo_item, a.ncm, v.descricao AS ncm_descricao, v.caminho AS ncm_caminho,
               CASE WHEN a.ncm IS NULL OR a.ncm = '' THEN 'Sem NCM' WHEN v.ncm IS NULL THEN 'Fora da NCM vigente' ELSE 'Vigente' END AS ncm_situacao,
               a.ncms_no_mes, a.lista_ncm, h.ncms_na_historia, a.fontes, a.estabelecimentos, a.cod_barra,
               coalesce(b.ncms_barra, 0) AS ncms_barra, a.ultimo_mes, coalesce(s.vendido_12m, 0) AS vendido_12m,
               a.cod_item IN (SELECT cod_item FROM genericos) AS generico,
               coalesce(f.diverge, false) AS diverge_fornecedor
        FROM atual a
        JOIN historico h USING (cod_item)
        LEFT JOIN {tabela(con, 'ncm_vigente.parquet')} v ON v.ncm = a.ncm
        LEFT JOIN barras b ON b.cod_barra = a.cod_barra
        LEFT JOIN vendido s USING (cod_item)
        LEFT JOIN (SELECT cod_item, bool_or(situacao <> 'Igual ao fornecedor') AS diverge FROM ncm_fornecedor
                   WHERE grupo = 'Revenda' GROUP BY 1) f USING (cod_item);
    """)


def contar(con: duckdb.DuckDBPyConnection) -> None:
    def q(titulo: str, sql: str) -> None:
        print(titulo)
        for r in con.execute(sql).fetchall():
            print("  ", " | ".join("" if x is None else (f"{x:,.2f}" if isinstance(x, float) else str(x)) for x in r))
    q("NCM do cadastro × fornecedor (grupo, situação, itens, valor):",
      "SELECT grupo, situacao, sum(itens), round(sum(valor), 2) FROM ncm_fornecedor GROUP BY ALL ORDER BY 1, 2")
    q("Produtos de revenda com NCM diferente do fornecedor (produtos, com NCM único dos fornecedores):",
      """SELECT count(DISTINCT cod_item), count(DISTINCT cod_item) FILTER (WHERE k = 1) FROM (
           SELECT cod_item, count(DISTINCT ncm_fornecedor) OVER (PARTITION BY cod_item) AS k, situacao FROM ncm_fornecedor
           WHERE grupo = 'Revenda') WHERE situacao <> 'Igual ao fornecedor'""")
    q("Matriz PIS/COFINS (situação, no prazo, produtos, vendas, PIS+COFINS):",
      """SELECT situacao_cod, no_prazo, count(DISTINCT cod_item), round(sum(valor), 2), round(sum(pis + cofins), 2) FROM matriz_linhas
         GROUP BY ALL ORDER BY 1, 2""")
    q("Cadastro (situação do NCM, itens, vendido 12m):",
      "SELECT ncm_situacao, count(*), round(sum(vendido_12m), 2) FROM ncm_cadastro GROUP BY 1 ORDER BY 1")
    q("Cadastro: NCM diferente no mesmo mês / código de barras com vários NCM / genéricos:",
      "SELECT count(*) FILTER (WHERE ncms_no_mes > 1), count(*) FILTER (WHERE ncms_barra > 1), count(*) FILTER (WHERE generico) FROM ncm_cadastro")


def gravar(con: duckdb.DuckDBPyConnection) -> None:
    DADOS.mkdir(parents=True, exist_ok=True)
    con.execute("CREATE TEMP TABLE situacoes (situacao_cod VARCHAR, situacao VARCHAR, acao VARCHAR)")
    con.executemany("INSERT INTO situacoes VALUES (?, ?, ?)", SITUACOES)
    vig = tabela(con, "ncm_vigente.parquet")
    destino = lambda n: (DADOS / f"{n}.parquet").as_posix()
    con.execute(f"""
        COPY (SELECT f.*, vc.descricao AS ncm_cadastro_descricao, vf.descricao AS ncm_fornecedor_descricao,
                     vf.caminho AS ncm_fornecedor_caminho, CASE WHEN vc.ncm IS NULL THEN 'Não' ELSE 'Sim' END AS ncm_cadastro_vigente
              FROM ncm_fornecedor f LEFT JOIN {vig} vc ON vc.ncm = f.ncm_cadastro LEFT JOIN {vig} vf ON vf.ncm = f.ncm_fornecedor
              ORDER BY f.grupo, f.valor DESC)
        TO '{destino('ncm_fornecedor')}' (FORMAT parquet, COMPRESSION zstd)""")
    # A matriz: o detalhe só do que não bate (M1 e M2); o resto somado por ano, situação, tabela e CST.
    con.execute(f"""
        COPY (
          SELECT * FROM (
            SELECT m.competencia, left(m.competencia, 4) AS ano, m.situacao_cod, s.situacao, m.no_prazo, m.cod_item, m.descricao, m.ncm,
                   v.descricao AS ncm_descricao, m.cst_pis, m.aliq_pis, m.cst_cofins, m.tabela, m.tratamento, m.codigo, m.regra,
                   m.itens, m.valor, m.pis, m.cofins, m.exemplo_arquivo, m.exemplo_linha, 1 AS linhas
            FROM matriz_linhas m JOIN situacoes s USING (situacao_cod) LEFT JOIN {vig} v ON v.ncm = m.ncm
            WHERE m.situacao_cod IN ('M1', 'M2')
            UNION ALL BY NAME
            SELECT left(m.competencia, 4) AS ano, m.situacao_cod, s.situacao, m.no_prazo, m.cst_pis, m.tabela, m.tratamento,
                   sum(m.itens) AS itens, sum(m.valor) AS valor, sum(m.pis) AS pis, sum(m.cofins) AS cofins, count(*) AS linhas
            FROM matriz_linhas m JOIN situacoes s USING (situacao_cod)
            WHERE m.situacao_cod NOT IN ('M1', 'M2') GROUP BY ALL
          ) ORDER BY ano, situacao_cod, competencia, cod_item
        ) TO '{destino('ncm_matriz')}' (FORMAT parquet, COMPRESSION zstd)""")
    con.execute(f"COPY (SELECT * FROM ncm_cadastro ORDER BY vendido_12m DESC) TO '{destino('ncm_cadastro')}' (FORMAT parquet, COMPRESSION zstd)")
    for n in ("ncm_fornecedor", "ncm_matriz", "ncm_cadastro"):
        print(f"dados/{n}.parquet: {con.execute(f'SELECT count(*) FROM read_parquet(?)', [destino(n)]).fetchone()[0]:,} linhas".replace(",", "."))


def main() -> None:
    for n in ("icms_0200", "icms_c170", "contrib_0200", "contrib_itens", "tabelas_pis", "ncm_vigente"):
        if not (ENTRADA / f"{n}.parquet").exists():
            sys.exit(f"falta {ENTRADA / n}.parquet: rode ncm_extrair.py, ncm_contrib_extrair.py e tabelas_sped.py antes")
    con = duckdb.connect()
    con.execute(f"SET memory_limit = '5GB'; SET threads = 4; SET preserve_insertion_order = false; "
                f"SET temp_directory = '{(PASTA / '_duckdb_tmp').as_posix()}'")
    preparar_fornecedor(con)
    preparar_matriz(con)
    preparar_cadastro(con)
    contar(con)
    if "--contar" not in sys.argv:
        gravar(con)


if __name__ == "__main__":
    main()
