"""
Reforma tributária: monta as tabelas da seção "Reforma tributária" do dashboard "Auditoria fiscal" a partir dos resumos
já publicados da EFD ICMS/IPI e da EFD Contribuições. O que é dado da escrituração e o que é hipótese está em
docs/auditoria-fiscal.md (seção "Reforma tributária"); os parâmetros ficam em CENARIOS e TRANSICAO, com fonte e data.

Pasta de trabalho (AUDITORIA_PASTA, padrão: a pasta atual), fora do repositório:
  entrada/icms_paineis*.parquet     "paineis_todos_periodos" publicada da EFD ICMS/IPI (extrair.ts)
  entrada/contrib_paineis*.parquet  "paineis_todos_periodos" publicada da EFD Contribuições (extrair.ts)
  dados/reforma.parquet             fato extra: documentos por mês, estabelecimento, operação, CFOP e CST, e o valor a
                                    recolher de cada apuração
  dados/reforma_apuracao.parquet    fato extra: apuração por mês, estabelecimento e tributo (E110, M200, M600)
  dados/reforma_transicao.parquet   fato extra: o saldo do ano-base levado a cada ano da transição, por cenário

Uso: uv run -q --no-project --python 3.11 --with duckdb python -I web/scripts/fiscal/auditoria/reforma.py [--conferir]
"""
import os
import sys
from pathlib import Path
from typing import NamedTuple

import duckdb

PASTA = Path(os.environ.get("AUDITORIA_PASTA", Path.cwd())).resolve()
ENTRADA = PASTA / "entrada"
DADOS = PASTA / "dados"


class Cenario(NamedTuple):
    id: str
    rotulo: str
    cbs: float  # alíquota de referência da CBS, em %
    ibs: float  # alíquota de referência do IBS (estadual + municipal), em %
    fonte: str

    @property
    def total(self) -> float:
        return round(self.cbs + self.ibs, 2)


# Parâmetros declarados, não fatos: as alíquotas de referência são fixadas por resolução do Senado (LC 214/2025, art. 18)
# e, em 17/11/2026, nenhuma estava fixada. Ao mudar um valor, mude a fonte e a data.
CENARIOS = (
    Cenario("a", "26,5%", 8.8, 17.7,
            "soma que serve de gatilho de revisão na LC 214/2025 (art. 475), com a divisão CBS 8,8% + IBS 17,7% das "
            "estimativas do Ministério da Fazenda de 2024; não conferida em fonte primária"),
    Cenario("b", "27,91%", 9.21, 18.7,
            "estimativa não oficial do Comitê Gestor do IBS (CBS 9,21% + IBS 18,7%), citada pela Agência Senado; "
            "fonte secundária, lida em 17/11/2026"),
    Cenario("c", "29,0%", 11.3, 17.7,
            "CBS de 2027 calculada pelo TCU (11,3468%, plenário de 28/10/2026; o Senado ainda não a fixou em 17/11/2026) "
            "somada ao IBS do cenário de 26,5%"),
)
CENTRAL = CENARIOS[1]

# CBS de 2027 e 2028: o cálculo do TCU menos 0,1 ponto (ADCT, art. 127), em todos os cenários.
CBS_2027 = 11.3
REDUCAO_CBS_2027_2028 = 0.1
IBS_2027_2028 = 0.1


class Etapa(NamedTuple):
    ano: int
    etapa: str
    antigos_federais: float  # fração do PIS e da Cofins de hoje que continua
    antigos_locais: float    # fração do ICMS de hoje que continua
    ibs: float               # fração da alíquota de referência do IBS que se aplica (None = alíquota fixa)


# Cronograma do ADCT, arts. 125 a 129 (EC 132/2023), lido em resumo da página oficial em 17/11/2026.
TRANSICAO = (
    Etapa(2026, "Teste: CBS 0,9% e IBS 0,1%, compensados com PIS e Cofins", 1.0, 1.0, 0.0),
    Etapa(2027, "CBS no lugar de PIS e Cofins; IBS 0,1%", 0.0, 1.0, -1.0),
    Etapa(2028, "CBS no lugar de PIS e Cofins; IBS 0,1%", 0.0, 1.0, -1.0),
    Etapa(2029, "ICMS a 90%; IBS a 10% da referência", 0.0, 0.9, 0.1),
    Etapa(2030, "ICMS a 80%; IBS a 20% da referência", 0.0, 0.8, 0.2),
    Etapa(2031, "ICMS a 70%; IBS a 30% da referência", 0.0, 0.7, 0.3),
    Etapa(2032, "ICMS a 60%; IBS a 40% da referência", 0.0, 0.6, 0.4),
    Etapa(2033, "Regime pleno: CBS e IBS; ICMS extinto", 0.0, 0.0, 1.0),
)

VENDA = "Venda"
SERVICO = "Prestação de serviço"
DEV_VENDA = "Devolução de venda"
DEV_COMPRA = "Devolução de compra"
OUTRAS_RECEITAS = "Demais receitas"
# Aquisições que dão crédito de CBS e IBS na regra geral (LC 214/2025, art. 47): tudo o que não é uso e consumo pessoal.
CREDITO_NA_REFORMA = ("Compra para revenda ou produção", "Uso e consumo", "Ativo imobilizado",
                      "Energia, comunicação e transporte", "Serviços tomados", "Demais aquisições com crédito")
LISTA_CREDITO = "(" + ", ".join(f"'{n}'" for n in CREDITO_NA_REFORMA) + ")"


def num(expr: str) -> str:
    return f"coalesce(TRY_CAST(replace({expr}, ',', '.') AS DOUBLE), 0)"


def natureza(cfop: str, entrada: str) -> str:
    """A natureza da operação pelos três últimos dígitos do CFOP."""
    d = f"TRY_CAST(right({cfop}, 3) AS INT)"
    return f"""CASE
      WHEN {d} = 933 THEN '{SERVICO}'
      WHEN {d} BETWEEN 151 AND 156 OR {d} IN (408, 409, 552, 557, 658, 659) THEN 'Transferência entre estabelecimentos'
      WHEN {d} BETWEEN 201 AND 210 OR {d} BETWEEN 410 AND 413 OR {d} IN (503, 504, 553, 660, 661, 662)
        THEN CASE WHEN {entrada} THEN '{DEV_VENDA}' ELSE '{DEV_COMPRA}' END
      WHEN NOT {entrada} AND {d} = 556 THEN '{DEV_COMPRA}'
      WHEN {d} IN (406, 551) THEN CASE WHEN {entrada} THEN 'Ativo imobilizado' ELSE 'Venda de ativo imobilizado' END
      WHEN {entrada} AND {d} IN (407, 556, 653) THEN 'Uso e consumo'
      WHEN {d} = 922 THEN 'Faturamento para entrega futura'
      WHEN {d} BETWEEN 251 AND 258 OR {d} BETWEEN 301 AND 307 OR {d} BETWEEN 351 AND 360 OR {d} = 932
        THEN CASE WHEN {entrada} THEN 'Energia, comunicação e transporte' ELSE '{VENDA}' END
      WHEN {d} BETWEEN 101 AND 126 OR {d} BETWEEN 401 AND 405 OR {d} BETWEEN 651 AND 656 OR {d} IN (653, 667)
        THEN CASE WHEN {entrada} THEN 'Compra para revenda ou produção' ELSE '{VENDA}' END
      ELSE 'Remessas, retornos e outras' END"""


def destino(cfop: str) -> str:
    return f"""CASE WHEN left({cfop}, 1) IN ('1', '5') THEN 'Dentro do estado' WHEN left({cfop}, 1) IN ('2', '6') THEN 'Interestadual'
      WHEN left({cfop}, 1) IN ('3', '7') THEN 'Exterior' ELSE 'Sem CFOP' END"""


TRATAMENTO_ICMS = """CASE right(cst, 2) WHEN '00' THEN 'Tributada integralmente' WHEN '20' THEN 'Redução de base de cálculo'
  WHEN '10' THEN 'Substituição tributária' WHEN '30' THEN 'Substituição tributária' WHEN '60' THEN 'Substituição tributária'
  WHEN '70' THEN 'Substituição tributária' WHEN '40' THEN 'Isenta, não tributada ou suspensa'
  WHEN '41' THEN 'Isenta, não tributada ou suspensa' WHEN '50' THEN 'Isenta, não tributada ou suspensa'
  WHEN '51' THEN 'Diferimento' ELSE 'Outras' END"""
TRATAMENTO_CONTRIB = """CASE WHEN cst IN ('01', '02', '03') THEN 'Tributada' WHEN cst = '04' THEN 'Monofásica (alíquota zero na revenda)'
  WHEN cst = '05' THEN 'Substituição tributária' WHEN cst = '06' THEN 'Alíquota zero'
  WHEN cst IN ('07', '08', '09') THEN 'Isenta, sem incidência ou suspensa' WHEN cst BETWEEN '50' AND '56' THEN 'Entrada com crédito'
  WHEN cst BETWEEN '60' AND '66' THEN 'Entrada com crédito presumido' WHEN cst BETWEEN '70' AND '75' THEN 'Entrada sem crédito'
  ELSE 'Outras' END"""
RECEITA = "(NOT entrada AND cst BETWEEN '01' AND '09')"
CREDITO_HOJE = "(entrada AND cst BETWEEN '50' AND '66')"

COLUNAS = """competencia, left(competencia, 4) AS ano, estabelecimento, fonte, CASE WHEN entrada THEN 'Entrada' ELSE 'Saída' END AS operacao,
  cfop, natureza, destino, cst, tratamento, round(valor, 2) AS valor, round(icms_base, 2) AS icms_base,
  round(icms_debito, 2) AS icms_debito, round(icms_credito, 2) AS icms_credito, round(icms_st, 2) AS icms_st,
  round(pis_debito, 2) AS pis_debito, round(pis_credito, 2) AS pis_credito, round(cofins_debito, 2) AS cofins_debito,
  round(cofins_credito, 2) AS cofins_credito, round(receita, 2) AS receita, round(base_debito, 2) AS base_debito,
  round(base_credito, 2) AS base_credito, round(aquisicao_credito_hoje, 2) AS aquisicao_credito_hoje,
  round(aquisicao_credito_reforma, 2) AS aquisicao_credito_reforma"""


def fonte(padrao: str) -> str | None:
    return f"read_parquet('{(ENTRADA / padrao).as_posix()}')" if list(ENTRADA.glob(padrao)) else None


def documentos_icms(con: duckdb.DuckDBPyConnection, src: str) -> None:
    """C190 e os seus pares de outros modelos: CST, CFOP, alíquota, VL_OPR, base e ICMS nas mesmas posições."""
    con.execute(f"""
      CREATE OR REPLACE TEMP TABLE icms AS
      SELECT strftime(periodo, '%Y-%m') AS competencia, cnpj AS estabelecimento, oper = '0' AS entrada, c02 AS cfop, c01 AS cst,
             sum({num('c04')}) AS valor, sum({num('c05')}) AS base, sum({num('c06')}) AS icms,
             sum(CASE WHEN registro IN ('C190', 'C590', 'D590') THEN {num('c08')} ELSE 0 END) AS st
      FROM {src} WHERE registro IN ('C190', 'C490', 'C590', 'C850', 'D190', 'D590') GROUP BY ALL
    """)
    con.execute(f"""
      INSERT INTO reforma BY NAME
      SELECT {COLUNAS} FROM (
        SELECT *, CASE WHEN entrada THEN 0 ELSE icms END AS icms_debito, CASE WHEN entrada THEN icms ELSE 0 END AS icms_credito,
               0 AS pis_debito, 0 AS pis_credito, 0 AS cofins_debito, 0 AS cofins_credito, 0 AS receita,
               CASE WHEN NOT entrada AND natureza IN ('{VENDA}', '{SERVICO}') THEN -icms
                    WHEN entrada AND natureza = '{DEV_VENDA}' THEN icms ELSE 0 END AS base_debito,
               CASE WHEN entrada AND natureza IN {LISTA_CREDITO} THEN valor - icms
                    WHEN NOT entrada AND natureza = '{DEV_COMPRA}' THEN icms - valor ELSE 0 END AS base_credito,
               0 AS aquisicao_credito_hoje,
               CASE WHEN entrada AND natureza IN {LISTA_CREDITO} THEN valor ELSE 0 END AS aquisicao_credito_reforma
        FROM (SELECT competencia, estabelecimento, entrada, cfop, cst, valor, base AS icms_base, icms, st AS icms_st,
                     'EFD ICMS/IPI' AS fonte, {natureza('cfop', 'entrada')} AS natureza, {destino('cfop')} AS destino,
                     {TRATAMENTO_ICMS} AS tratamento FROM icms))
    """)


def documentos_contrib(con: duckdb.DuckDBPyConnection, src: str) -> None:
    """
    C170 (mercadorias), A170 (serviços) e F100 (demais operações) trazem valor, PIS e Cofins. D101/D105 (fretes) e
    C501/C505 (energia) só os créditos: o valor dessas aquisições vem da EFD ICMS/IPI, para não contar duas vezes.
    """
    con.execute(f"""
      CREATE OR REPLACE TEMP TABLE contrib AS
      SELECT strftime(periodo, '%Y-%m') AS competencia, cnpj AS estabelecimento, oper = '0' AS entrada, c10 AS cfop, c24 AS cst,
             NULL AS nat, sum({num('c06')} - {num('c07')}) AS valor, sum({num('c29')}) AS pis, sum({num('c35')}) AS cofins, true AS com_valor
      FROM {src} WHERE registro = 'C170' GROUP BY ALL
      UNION ALL
      SELECT strftime(periodo, '%Y-%m'), cnpj, oper = '0', NULL, c08, CASE WHEN oper = '0' THEN 'Serviços tomados' ELSE '{SERVICO}' END,
             sum({num('c04')} - {num('c05')}), sum({num('c11')}), sum({num('c15')}), true
      FROM {src} WHERE registro = 'A170' GROUP BY ALL
      UNION ALL
      SELECT strftime(periodo, '%Y-%m'), cnpj, c01 = '0', NULL, c06,
             CASE WHEN c01 = '0' THEN 'Demais aquisições com crédito' ELSE '{OUTRAS_RECEITAS}' END,
             sum({num('c05')}), sum({num('c09')}), sum({num('c13')}), true
      FROM {src} WHERE registro = 'F100' GROUP BY ALL
      UNION ALL
      SELECT strftime(periodo, '%Y-%m'), cnpj, true, NULL, c03, 'Energia, comunicação e transporte',
             sum(CASE WHEN registro = 'D101' THEN {num('c02')} ELSE 0 END),
             sum(CASE WHEN registro = 'D101' THEN {num('c07')} ELSE 0 END), sum(CASE WHEN registro = 'D105' THEN {num('c07')} ELSE 0 END), false
      FROM {src} WHERE registro IN ('D101', 'D105') GROUP BY ALL
      UNION ALL
      SELECT strftime(periodo, '%Y-%m'), cnpj, true, NULL, c01, 'Energia, comunicação e transporte',
             sum(CASE WHEN registro = 'C501' THEN {num('c02')} ELSE 0 END),
             sum(CASE WHEN registro = 'C501' THEN {num('c06')} ELSE 0 END), sum(CASE WHEN registro = 'C505' THEN {num('c06')} ELSE 0 END), false
      FROM {src} WHERE registro IN ('C501', 'C505') GROUP BY ALL
    """)
    liquido = "(valor - pis - cofins)"
    con.execute(f"""
      INSERT INTO reforma BY NAME
      SELECT {COLUNAS} FROM (
        SELECT * REPLACE (CASE WHEN com_valor THEN valor ELSE 0 END AS valor),
               0 AS icms_base, 0 AS icms_debito, 0 AS icms_credito, 0 AS icms_st,
               CASE WHEN entrada THEN 0 ELSE pis END AS pis_debito, CASE WHEN entrada THEN pis ELSE 0 END AS pis_credito,
               CASE WHEN entrada THEN 0 ELSE cofins END AS cofins_debito, CASE WHEN entrada THEN cofins ELSE 0 END AS cofins_credito,
               CASE WHEN {RECEITA} THEN valor ELSE 0 END AS receita,
               CASE WHEN {RECEITA} THEN {liquido} WHEN entrada AND natureza = '{DEV_VENDA}' THEN -{liquido} ELSE 0 END AS base_debito,
               CASE WHEN NOT entrada OR natureza NOT IN {LISTA_CREDITO} THEN 0
                    WHEN com_valor AND cfop IS NULL THEN {liquido} ELSE -(pis + cofins) END AS base_credito,
               -- Nos fretes e na energia o valor é o do registro do PIS: o da Cofins repete o mesmo documento.
               CASE WHEN {CREDITO_HOJE} THEN valor ELSE 0 END AS aquisicao_credito_hoje,
               CASE WHEN entrada AND com_valor AND cfop IS NULL AND natureza IN {LISTA_CREDITO} THEN valor ELSE 0 END AS aquisicao_credito_reforma
        FROM (SELECT competencia, estabelecimento, entrada, cfop, cst, valor, pis, cofins, com_valor, 'EFD Contribuições' AS fonte,
                     coalesce(nat, {natureza('cfop', 'entrada')}) AS natureza, {destino('cfop')} AS destino,
                     {TRATAMENTO_CONTRIB} AS tratamento FROM contrib))
    """)


def apuracao(con: duckdb.DuckDBPyConnection, icms: str | None, contrib: str | None) -> None:
    con.execute("""CREATE OR REPLACE TABLE reforma_apuracao (competencia VARCHAR, ano VARCHAR, estabelecimento VARCHAR, tributo VARCHAR,
                   debitos DOUBLE, creditos DOUBLE, a_recolher DOUBLE, saldo_credor DOUBLE)""")
    if icms:
        # E110: débitos (c01) e os seus ajustes (c02 a c04); créditos (c05) e os seus ajustes (c06 a c08).
        con.execute(f"""
          INSERT INTO reforma_apuracao
          SELECT strftime(periodo, '%Y-%m'), strftime(periodo, '%Y'), cnpj, 'ICMS',
                 round(sum({num('c01')} + {num('c02')} + {num('c03')} + {num('c04')}), 2),
                 round(sum({num('c05')} + {num('c06')} + {num('c07')} + {num('c08')}), 2),
                 round(sum({num('c12')} + {num('c14')}), 2), round(sum({num('c13')}), 2)
          FROM {icms} WHERE registro = 'E110' GROUP BY ALL
        """)
    if contrib:
        # M200 e M600: contribuição do período (c01 não cumulativa, c08 cumulativa), créditos descontados (c02 e c03)
        # e contribuição a recolher (c12).
        con.execute(f"""
          INSERT INTO reforma_apuracao
          SELECT strftime(periodo, '%Y-%m'), strftime(periodo, '%Y'), cnpj, CASE registro WHEN 'M200' THEN 'PIS' ELSE 'Cofins' END,
                 round(sum({num('c01')} + {num('c08')}), 2), round(sum({num('c02')} + {num('c03')}), 2),
                 round(sum({num('c12')}), 2), 0
          FROM {contrib} WHERE registro IN ('M200', 'M600') GROUP BY ALL
        """)


def transicao(con: duckdb.DuckDBPyConnection) -> str | None:
    """O valor a recolher e a base líquida do ano-base (o último ano com os doze meses) levado a cada ano do cronograma, por cenário."""
    con.execute("""CREATE OR REPLACE TABLE reforma_transicao (ano VARCHAR, etapa VARCHAR, tributo VARCHAR, cenario VARCHAR,
                   origem VARCHAR, valor DOUBLE)""")
    base = con.execute("""SELECT ano FROM reforma GROUP BY ano HAVING count(DISTINCT competencia) = 12
                          AND sum(receita) > 0 ORDER BY ano DESC LIMIT 1""").fetchone()
    if not base:
        print("aviso: nenhum ano com doze meses e receita; a transição fica vazia")
        return None
    federais, locais, liquida = con.execute("""
      SELECT sum(a_recolher_pis_cofins), sum(a_recolher_icms), sum(base_debito - base_credito) FROM reforma WHERE ano = ?""", [base[0]]).fetchone()
    linhas = []
    for e in TRANSICAO:
        linhas.append((str(e.ano), e.etapa, "PIS e Cofins", "Todos", "Escriturado", federais * e.antigos_federais))
        linhas.append((str(e.ano), e.etapa, "ICMS", "Todos", "Escriturado", locais * e.antigos_locais))
        for c in CENARIOS:
            if e.ano == 2026:
                cbs = ibs = 0.0  # as alíquotas de teste são compensadas com PIS e Cofins: não mudam o que se paga
            elif e.ano in (2027, 2028):
                cbs, ibs = CBS_2027 - REDUCAO_CBS_2027_2028, IBS_2027_2028
            else:
                cbs, ibs = c.cbs, c.ibs * e.ibs
            linhas.append((str(e.ano), e.etapa, "CBS", c.rotulo, "Simulado", liquida * cbs / 100))
            linhas.append((str(e.ano), e.etapa, "IBS", c.rotulo, "Simulado", liquida * ibs / 100))
    con.executemany("INSERT INTO reforma_transicao VALUES (?, ?, ?, ?, ?, round(?, 2))", linhas)
    return base[0]


def conferir(con: duckdb.DuckDBPyConnection) -> None:
    """Os documentos contra a apuração: diferença grande indica receita ou crédito em registros que o resumo não traz."""
    print("ano | ICMS débito doc × E110 | ICMS crédito doc × E110 | PIS débito doc × M200 | receita | base débito | base crédito")
    for r in con.execute("""
      WITH d AS (SELECT ano, sum(icms_debito) id, sum(icms_credito) ic, sum(pis_debito) pd, sum(receita) rec,
                        sum(base_debito) bd, sum(base_credito) bc FROM reforma GROUP BY 1),
           a AS (SELECT ano, sum(CASE WHEN tributo = 'ICMS' THEN debitos END) ad, sum(CASE WHEN tributo = 'ICMS' THEN creditos END) ac,
                        sum(CASE WHEN tributo = 'PIS' THEN debitos END) pm FROM reforma_apuracao GROUP BY 1)
      SELECT d.ano, id, ad, ic, ac, pd, pm, rec, bd, bc FROM d LEFT JOIN a USING (ano) ORDER BY 1""").fetchall():
        print(f"{r[0]} | {r[1]:,.0f} × {r[2] or 0:,.0f} | {r[3]:,.0f} × {r[4] or 0:,.0f} | {r[5]:,.0f} × {r[6] or 0:,.0f} | "
              f"{r[7]:,.0f} | {r[8]:,.0f} | {r[9]:,.0f}")
        if r[6] and abs(r[5] - r[6]) > 0.02 * r[6]:
            print(f"  aviso: em {r[0]} o PIS dos documentos difere da apuração em mais de 2%: há receita fora de C170, A170 e F100")


def main() -> None:
    DADOS.mkdir(exist_ok=True)
    icms, contrib = fonte("icms_paineis*.parquet"), fonte("contrib_paineis*.parquet")
    con = duckdb.connect()
    con.execute("""CREATE TABLE reforma (competencia VARCHAR, ano VARCHAR, estabelecimento VARCHAR, fonte VARCHAR, operacao VARCHAR,
      cfop VARCHAR, natureza VARCHAR, destino VARCHAR, cst VARCHAR, tratamento VARCHAR, valor DOUBLE, icms_base DOUBLE,
      icms_debito DOUBLE, icms_credito DOUBLE, icms_st DOUBLE, pis_debito DOUBLE, pis_credito DOUBLE, cofins_debito DOUBLE,
      cofins_credito DOUBLE, receita DOUBLE, base_debito DOUBLE, base_credito DOUBLE, aquisicao_credito_hoje DOUBLE,
      aquisicao_credito_reforma DOUBLE, a_recolher_icms DOUBLE DEFAULT 0, a_recolher_pis_cofins DOUBLE DEFAULT 0)""")
    if icms:
        documentos_icms(con, icms)
    else:
        print("aviso: sem entrada/icms_paineis*.parquet; a seção fica sem o ICMS e sem o valor das aquisições")
    if contrib:
        documentos_contrib(con, contrib)
    else:
        print("aviso: sem entrada/contrib_paineis*.parquet; a seção fica sem receita, PIS e Cofins")
    apuracao(con, icms, contrib)
    # O que a apuração manda recolher entra na mesma fato, para a carga de hoje sair de uma conta só com a receita.
    con.execute("""
      INSERT INTO reforma BY NAME
      SELECT competencia, ano, estabelecimento, 'Apuração' AS fonte, 'Apuração' AS operacao, 'Apuração' AS natureza,
             'Sem CFOP' AS destino, tributo AS tratamento, 0 AS valor, 0 AS icms_base, 0 AS icms_debito, 0 AS icms_credito, 0 AS icms_st,
             0 AS pis_debito, 0 AS pis_credito, 0 AS cofins_debito, 0 AS cofins_credito, 0 AS receita, 0 AS base_debito,
             0 AS base_credito, 0 AS aquisicao_credito_hoje, 0 AS aquisicao_credito_reforma,
             CASE WHEN tributo = 'ICMS' THEN a_recolher ELSE 0 END AS a_recolher_icms,
             CASE WHEN tributo = 'ICMS' THEN 0 ELSE a_recolher END AS a_recolher_pis_cofins
      FROM reforma_apuracao""")
    base = transicao(con)
    con.execute("ALTER TABLE reforma ADD COLUMN ano_base VARCHAR")
    con.execute("UPDATE reforma SET ano_base = CASE WHEN ano = ? THEN 'Sim' ELSE 'Não' END", [base or ""])
    conferir(con)
    if "--conferir" in sys.argv:
        return
    for tabela, ordem in (("reforma", "competencia, fonte, estabelecimento, operacao, cfop, cst"),
                          ("reforma_apuracao", "competencia, tributo, estabelecimento"),
                          ("reforma_transicao", "ano, cenario, tributo")):
        con.execute(f"COPY (SELECT * FROM {tabela} ORDER BY {ordem}) TO '{(DADOS / (tabela + '.parquet')).as_posix()}' (FORMAT parquet)")
        print(tabela, con.execute(f"SELECT count(*) FROM {tabela}").fetchone()[0], "linhas")
    print("ano-base:", base)


if __name__ == "__main__":
    main()
