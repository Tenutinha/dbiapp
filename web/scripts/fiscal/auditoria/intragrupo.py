"""
Fechamento das notas entre estabelecimentos do grupo (EFD ICMS/IPI).

Uma nota em que os dois lados são estabelecimentos do grupo (o participante do C100, pelo CNPJ do 0150, é um
estabelecimento que também entrega EFD ICMS/IPI no espaço, ou tem a mesma raiz de CNPJ) tem de estar escriturada nos dois
arquivos com a mesma chave e sentidos opostos: a saída de um é a entrada do outro.

Lê o que intragrupo_extrair.py gravou em <AUDITORIA_PASTA>/entrada/ e grava <AUDITORIA_PASTA>/dados/intragrupo.parquet:
uma linha por nota e par de estabelecimentos, com os dois lados lado a lado e a situação do par.

Uso (em web/):
  AUDITORIA_PASTA=<pasta> uv run -q --no-project --python 3.11 --with duckdb python -I scripts/fiscal/auditoria/intragrupo.py [--contar]

--contar mostra quantas notas fecham e quantas não, por motivo, sem gravar nada.
Documentação: docs/auditoria-fiscal.md (seção "Notas entre estabelecimentos do grupo").
"""
from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

import duckdb

PASTA = Path(os.environ.get("AUDITORIA_PASTA", Path.cwd())).resolve()
ENTRADA = PASTA / "entrada"
DADOS = PASTA / "dados"
PARTES = PASTA / "_intragrupo_partes"
# Faixas de chaves processadas uma de cada vez (memória).
FAIXAS = 8

# Tolerância de valor entre os dois lados (R$), a mesma das outras regras da Auditoria.
TOLERANCIA_VALOR = 0.05
# Entrada escriturada até este número de meses depois da saída é o normal (mercadoria em trânsito, nota recebida no mês
# seguinte); além disso, ou antes da saída, é desvio.
MESES_NORMAIS = 1
# Situações do C100 que não são nota regular: 02/03 cancelada, 04 denegada, 05 numeração inutilizada.
SIT_CANCELADA = ("02", "03")
SIT_DENEGADA = ("04",)
SIT_INUTILIZADA = ("05",)

MOTIVOS = [
    # (código, situação, motivo, o que fazer)
    ("F0", "Fecha", "Fecha no mesmo mês", ""),
    ("F1", "Fecha", "Fecha no mês seguinte", "Normal: a entrada foi escriturada no mês seguinte ao da saída."),
    ("F2", "Fecha", "Cancelada nos dois lados", ""),
    ("F3", "Fecha", "Cancelada pelo emitente e fora da contraparte", "Normal: nota cancelada não entra no arquivo de quem a receberia."),
    ("N1", "Não fecha", "Chave ausente na contraparte",
     "A contraparte entregou o arquivo do mês e a nota não está nele (nem em outro mês). Escriturar a nota na contraparte ou conferir se ela foi recusada."),
    ("N2", "Não fecha", "Mesmo sentido nos dois lados",
     "Os dois estabelecimentos escrituraram a nota como saída, ou os dois como entrada. Corrigir o IND_OPER de um dos lados."),
    ("N3", "Não fecha", "Mês fora do prazo",
     "A entrada foi escriturada mais de um mês depois da saída, ou antes dela. Conferir a data de entrada e o período de escrituração."),
    ("N4", "Não fecha", "Valor diferente",
     "O VL_DOC é diferente nos dois lados. Conferir qual arquivo está certo pelo XML."),
    ("N5", "Não fecha", "Situação diferente",
     "Cancelada ou denegada de um lado e regular do outro. Uma nota cancelada não pode ser escriturada como regular pela contraparte."),
    ("A1", "Falta arquivo", "Arquivo da contraparte não enviado",
     "A contraparte não tem EFD ICMS/IPI no espaço no mês da nota nem no vizinho (o seguinte à saída, o anterior à entrada): não é falha da nota, é falta do arquivo."),
    ("A2", "Falta arquivo", "Contraparte sem EFD no espaço",
     "O participante tem a raiz de CNPJ do grupo, mas não há nenhum arquivo dele no espaço."),
]


def rodar(con: duckdb.DuckDBPyConnection, comandos: str) -> None:
    """Roda os comandos um a um e mostra quanto cada um levou (o preparo de todos os meses leva minutos)."""
    for c in (x.strip() for x in comandos.split(";")):
        if not c:
            continue
        t = time.perf_counter()
        con.execute(c)
        nome = c.split("CREATE TEMP TABLE ")[-1].split()[0] if "CREATE TEMP TABLE" in c else c[:40]
        print(f"  {nome}: {time.perf_counter() - t:.1f} s", flush=True)


def preparar_comum(con: duckdb.DuckDBPyConnection) -> None:
    e = lambda n: f"'{(ENTRADA / n).as_posix()}'"
    sit_irregular = "('02', '03', '04', '05')"
    rodar(con, f"""
        CREATE TEMP TABLE arquivos AS
        SELECT *, row_number() OVER (ORDER BY estabelecimento, competencia, arquivo) AS id
        FROM read_parquet({e('icms_arquivos.parquet')}) WHERE vale;
        -- Estabelecimentos do grupo: os que entregam EFD no espaço, e as raízes deles.
        CREATE TEMP TABLE grupo AS SELECT DISTINCT estabelecimento AS cnpj FROM arquivos;
        CREATE TEMP TABLE raizes AS SELECT DISTINCT left(cnpj, 8) AS raiz FROM grupo;
        CREATE TEMP TABLE meses AS SELECT DISTINCT estabelecimento AS cnpj, competencia FROM arquivos;

        -- Participantes que são do grupo (raiz de CNPJ de quem entrega EFD), arquivo a arquivo. Filtrar aqui deixa de
        -- fora quase todo o 0150 (clientes e fornecedores de fora) antes de juntar com os 24 milhões de C100.
        CREATE TEMP TABLE participantes AS
        SELECT DISTINCT arquivo, cod_part, cnpj FROM read_parquet({e('icms_0150.parquet')})
        WHERE left(cnpj, 8) IN (SELECT raiz FROM raizes) AND arquivo IN (SELECT arquivo FROM arquivos);

    """)


def preparar_faixa(con: duckdb.DuckDBPyConnection, faixa: int) -> None:
    """Uma faixa de chaves (hash da chave módulo FAIXAS): cada chave só depende das próprias linhas, então as faixas são
    independentes, e dividir mantém a memória dentro do limite (as 24 milhões de notas de uma vez não cabem)."""
    e = lambda n: f"'{(ENTRADA / n).as_posix()}'"
    sit_irregular = "('02', '03', '04', '05')"
    for t in ("pares", "primeiras", "lados", "pares_orientados", "intragrupo"):
        con.execute(f"DROP TABLE IF EXISTS {t}")
    rodar(con, f"""
        -- Pares (chave, estabelecimento, estabelecimento do grupo): de qualquer um dos lados que cite o outro.
        CREATE TEMP TABLE pares AS
        SELECT DISTINCT n.chv_nfe AS chave, least(a.estabelecimento, p.cnpj) AS a, greatest(a.estabelecimento, p.cnpj) AS b
        FROM read_parquet({e('icms_c100.parquet')}) n
        JOIN arquivos a USING (arquivo)
        JOIN participantes p ON p.arquivo = n.arquivo AND p.cod_part = n.cod_part
        WHERE length(n.chv_nfe) = 44 AND p.cnpj <> a.estabelecimento AND hash(n.chv_nfe) % {FAIXAS} = {faixa};

        -- Um lado = as linhas da chave nos arquivos de um estabelecimento (a primeira, pela competência, e quantas são).
        -- Um lado = as linhas da chave nos arquivos de um estabelecimento: a primeira (pela competência e linha) e quantas são.
        -- A primeira sai por uma chave numérica (id do arquivo, que segue a competência, e linha): mais leve que min() de texto.
        CREATE TEMP TABLE primeiras AS
        SELECT a.estabelecimento AS dono, n.chv_nfe AS chave, count(*) AS ocorrencias, min(a.id * 100000000 + n.linha) AS pos
        FROM read_parquet({e('icms_c100.parquet')}) n
        JOIN arquivos a USING (arquivo)
        WHERE n.chv_nfe IN (SELECT chave FROM pares)
        GROUP BY ALL;

        CREATE TEMP TABLE lados AS
        SELECT p.dono, p.chave, p.ocorrencias, a.competencia, n.linha, n.ind_oper, n.cod_sit, n.dt_doc, n.dt_e_s,
               TRY_CAST(replace(nullif(n.vl_doc, ''), ',', '.') AS DECIMAL(18, 2)) AS vl_doc,
               n.num_doc, n.ser, n.cod_mod, n.arquivo, n.cfops
        FROM primeiras p
        JOIN arquivos a ON a.id = p.pos // 100000000
        JOIN read_parquet({e('icms_c100.parquet')}) n ON n.arquivo = a.arquivo AND n.linha = p.pos % 100000000
    """)
    # Lado 1 = o emitente da nota (CNPJ na chave); se nenhum dos dois é o emitente, o menor CNPJ.
    rodar(con, f"""
        CREATE TEMP TABLE pares_orientados AS
        SELECT chave,
               CASE WHEN substr(chave, 7, 14) = b THEN b ELSE a END AS emitente,
               CASE WHEN substr(chave, 7, 14) = b THEN a ELSE b END AS destinatario
        FROM pares;

        CREATE TEMP TABLE intragrupo AS
        WITH base AS (
          SELECT p.chave, p.emitente, p.destinatario,
                 e.competencia AS e_comp, e.ind_oper AS e_oper, e.cod_sit AS e_sit, e.dt_doc AS e_dt_doc, e.dt_e_s AS e_dt_e_s,
                 e.vl_doc AS e_valor, e.cfops AS e_cfops, e.arquivo AS e_arquivo, e.linha AS e_linha, e.ocorrencias AS e_ocorrencias,
                 d.competencia AS d_comp, d.ind_oper AS d_oper, d.cod_sit AS d_sit, d.dt_doc AS d_dt_doc, d.dt_e_s AS d_dt_e_s,
                 d.vl_doc AS d_valor, d.cfops AS d_cfops, d.arquivo AS d_arquivo, d.linha AS d_linha, d.ocorrencias AS d_ocorrencias,
                 coalesce(e.num_doc, d.num_doc) AS num_doc, coalesce(e.ser, d.ser) AS serie, coalesce(e.cod_mod, d.cod_mod) AS modelo,
                 coalesce(e.competencia, d.competencia) AS competencia_ref,
                 -- O mês vizinho em que o outro lado pode estar: o seguinte, se o lado presente é a saída, ou o anterior, se é a entrada.
                 strftime(CAST(coalesce(e.competencia, d.competencia) || '-01' AS DATE)
                          + INTERVAL (CASE coalesce(e.ind_oper, d.ind_oper) WHEN '1' THEN 1 ELSE -1 END) MONTH, '%Y-%m') AS mes_vizinho,
                 -- O lado que falta: ele tem arquivo no mês da nota ou no seguinte? Tem algum arquivo no espaço?
                 CASE WHEN e.chave IS NULL THEN p.emitente ELSE p.destinatario END AS falta_cnpj
          FROM pares_orientados p
          LEFT JOIN lados e ON e.dono = p.emitente AND e.chave = p.chave
          LEFT JOIN lados d ON d.dono = p.destinatario AND d.chave = p.chave
        ),
        com_meses AS (
          SELECT b.*,
                 CASE WHEN e_comp IS NOT NULL AND d_comp IS NOT NULL THEN
                   (CAST(left(d_comp, 4) AS INT) * 12 + CAST(right(d_comp, 2) AS INT))
                   - (CAST(left(e_comp, 4) AS INT) * 12 + CAST(right(e_comp, 2) AS INT)) END AS meses,
                 g.cnpj IS NOT NULL AS falta_tem_efd,
                 (m0.cnpj IS NOT NULL OR m1.cnpj IS NOT NULL) AS falta_tem_mes
          FROM base b
          LEFT JOIN grupo g ON g.cnpj = b.falta_cnpj
          LEFT JOIN meses m0 ON m0.cnpj = b.falta_cnpj AND m0.competencia = b.competencia_ref
          LEFT JOIN meses m1 ON m1.cnpj = b.falta_cnpj AND m1.competencia = b.mes_vizinho
        )
        SELECT *,
          CASE
            WHEN e_comp IS NOT NULL AND d_comp IS NOT NULL THEN
              CASE
                WHEN e_sit IN {sit_irregular} AND d_sit IN {sit_irregular} THEN 'F2'
                WHEN (e_sit IN {sit_irregular}) <> (d_sit IN {sit_irregular}) THEN 'N5'
                WHEN e_oper = d_oper THEN 'N2'
                WHEN abs(coalesce(e_valor, 0) - coalesce(d_valor, 0)) > {TOLERANCIA_VALOR} THEN 'N4'
                WHEN abs(meses_saida_entrada) > 0 AND (meses_saida_entrada < 0 OR meses_saida_entrada > {MESES_NORMAIS}) THEN 'N3'
                WHEN meses_saida_entrada = 0 THEN 'F0'
                ELSE 'F1'
              END
            WHEN e_comp IS NOT NULL AND e_sit IN {sit_irregular} THEN 'F3'
            WHEN NOT falta_tem_efd THEN 'A2'
            WHEN NOT falta_tem_mes THEN 'A1'
            ELSE 'N1'
          END AS motivo
        FROM (SELECT *,
                -- Meses da saída à entrada, qualquer que seja o lado que emitiu.
                CASE WHEN e_oper = '0' AND d_oper = '1' THEN -meses ELSE meses END AS meses_saida_entrada
              FROM com_meses);
    """)


def gravar_faixa(con: duckdb.DuckDBPyConnection, faixa: int) -> None:
    oper = lambda c: f"CASE {c} WHEN '0' THEN 'Entrada' WHEN '1' THEN 'Saída' END"
    sit = lambda c: (f"CASE WHEN {c} IN ('02', '03') THEN 'Cancelada' WHEN {c} = '04' THEN 'Denegada' "
                     f"WHEN {c} = '05' THEN 'Inutilizada' WHEN {c} IS NULL THEN NULL ELSE 'Regular' END")
    data = lambda c: f"TRY_CAST(strptime(nullif({c}, ''), '%d%m%Y') AS DATE)"
    con.execute(f"""
        COPY (
          SELECT i.competencia_ref AS competencia, left(i.competencia_ref, 4) AS ano, m.situacao, i.motivo,
                 m.descricao AS motivo_descricao, i.chave, i.num_doc, i.serie, i.modelo,
                 i.emitente, i.destinatario,
                 i.e_comp AS emit_competencia, {oper('i.e_oper')} AS emit_operacao, {sit('i.e_sit')} AS emit_situacao,
                 {data('i.e_dt_doc')} AS emit_dt_doc, {data('i.e_dt_e_s')} AS emit_dt_e_s, i.e_valor AS emit_valor, i.e_cfops AS emit_cfop,
                 i.e_arquivo AS emit_arquivo, i.e_linha AS emit_linha, i.e_ocorrencias AS emit_ocorrencias,
                 i.d_comp AS dest_competencia, {oper('i.d_oper')} AS dest_operacao, {sit('i.d_sit')} AS dest_situacao,
                 {data('i.d_dt_doc')} AS dest_dt_doc, {data('i.d_dt_e_s')} AS dest_dt_e_s, i.d_valor AS dest_valor, i.d_cfops AS dest_cfop,
                 i.d_arquivo AS dest_arquivo, i.d_linha AS dest_linha, i.d_ocorrencias AS dest_ocorrencias,
                 coalesce(i.e_valor, i.d_valor) AS valor,
                 CASE WHEN i.e_valor IS NOT NULL AND i.d_valor IS NOT NULL THEN i.d_valor - i.e_valor END AS diferenca,
                 i.meses_saida_entrada AS meses
          FROM intragrupo i JOIN motivos m USING (motivo)
        ) TO '{(PARTES / f'{faixa}.parquet').as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")


def contar(con: duckdb.DuckDBPyConnection) -> None:
    partes = f"'{PARTES.as_posix()}/*.parquet'"
    total = con.execute(f"SELECT count(*) FROM {partes}").fetchone()[0]
    print(f"Notas entre estabelecimentos do grupo (nota × par): {total:,}".replace(",", "."))
    for cod, sit, desc, n, valor in con.execute(f"""
        SELECT motivo, situacao, motivo_descricao, count(*), sum(valor) FROM {partes} GROUP BY ALL ORDER BY 1""").fetchall():
        print(f"  {cod} {sit:<14} {desc:<48} {n:>10,}  R$ {float(valor or 0):>18,.2f}".replace(",", "_").replace(".", ",").replace("_", "."))


def gravar(con: duckdb.DuckDBPyConnection) -> None:
    """Uma tabela só, para a seção filtrar tudo junto: uma linha por nota que não fecha no mesmo mês (com os dois lados) e,
    das que fecham no mesmo mês (milhões, sem ação a tomar), uma linha por mês e par de estabelecimentos com a contagem.
    A coluna notas diz quantas notas a linha representa (1 no detalhe)."""
    DADOS.mkdir(parents=True, exist_ok=True)
    partes = f"'{PARTES.as_posix()}/*.parquet'"
    destino = (DADOS / "intragrupo.parquet").as_posix()
    con.execute(f"""
        COPY (
          SELECT * FROM (
            SELECT *, 1::BIGINT AS notas FROM {partes} WHERE motivo <> 'F0'
            UNION ALL BY NAME
            SELECT competencia, ano, situacao, motivo, motivo_descricao, emitente, destinatario,
                   count(*) AS notas, sum(valor) AS valor
            FROM {partes} WHERE motivo = 'F0' GROUP BY ALL
          ) ORDER BY competencia, emitente, destinatario, motivo, chave
        ) TO '{destino}' (FORMAT parquet, COMPRESSION zstd)""")
    linhas, notas = con.execute(f"SELECT count(*), sum(notas) FROM '{destino}'").fetchone()
    print(f"dados/intragrupo.parquet: {linhas:,} linhas, {notas:,} notas".replace(",", "."))


def main() -> None:
    for n in ("icms_arquivos.parquet", "icms_0150.parquet", "icms_c100.parquet"):
        if not (ENTRADA / n).exists():
            sys.exit(f"falta {ENTRADA / n}: rode intragrupo_extrair.py antes")
    tmp = PASTA / "_duckdb_tmp"
    con = duckdb.connect()
    con.execute(f"SET memory_limit = '5GB'; SET threads = 4; SET temp_directory = '{tmp.as_posix()}'; SET preserve_insertion_order = false")
    shutil.rmtree(PARTES, ignore_errors=True)
    PARTES.mkdir(parents=True)
    con.execute("CREATE TEMP TABLE motivos (motivo VARCHAR, situacao VARCHAR, descricao VARCHAR, acao VARCHAR)")
    con.executemany("INSERT INTO motivos VALUES (?, ?, ?, ?)", MOTIVOS)
    preparar_comum(con)
    for faixa in range(FAIXAS):
        print(f"faixa {faixa + 1}/{FAIXAS}", flush=True)
        preparar_faixa(con, faixa)
        gravar_faixa(con, faixa)
    contar(con)
    if "--contar" not in sys.argv:
        gravar(con)
    shutil.rmtree(PARTES, ignore_errors=True)


if __name__ == "__main__":
    main()
