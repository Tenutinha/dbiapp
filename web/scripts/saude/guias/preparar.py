"""
Autorização de guias: monta as tabelas do molde "autorizacao-guias" a partir da extração do gerenciador de guias
(as tabelas F_GERENCIADOR_* / D_GERENCIADOR_* que alimentavam o app Qlik Sense de gerenciamento de guias).
Documentação: web/scripts/saude/guias/README.md.

Entrada (GUIAS_ORIGEM): pasta com os Parquet da extração, com os nomes originais (F_GERENCIADOR_GUIAS.parquet…).
Saída   (GUIAS_PASTA/dados, padrão: ./dados), fora do repositório:
  guias.parquet               fato, uma linha por guia
  prestadores.parquet         dimensão (chave: prestador)
  solicitantes.parquet        dimensão (chave: solicitante)
  locais_atendimento.parquet  dimensão (chave: local_atendimento)

Variáveis:
  GUIAS_ORIGEM       pasta da extração (obrigatória)
  GUIAS_PASTA        pasta de trabalho (padrão: a pasta atual); a saída vai para <pasta>/dados
  GUIAS_COOPERATIVA  código da cooperativa dona da carteira (ex.: 056): separa beneficiário local de intercâmbio
  GUIAS_SAL          segredo usado para pseudonimizar o beneficiário (obrigatório; o mesmo em todas as cargas
                     da mesma cooperativa, senão as contagens de beneficiários entre cargas deixam de bater).
                     Nunca vai para o repositório.

Dados pessoais: nome, carteirinha, cartão SUS, CPF e datas de nascimento do beneficiário NÃO são lidos. O
beneficiário vira um número irreversível (60 bits do md5 do sal + chave interna) e a idade vira faixa etária.

Uso: GUIAS_ORIGEM=... GUIAS_COOPERATIVA=056 GUIAS_SAL=... \
     uv run -q --no-project --python 3.11 --with duckdb python -I -X utf8 web/scripts/saude/guias/preparar.py [--contar]
"""
import os
import sys
from pathlib import Path

import duckdb

# Códigos TUSS de consulta (consulta em consultório e em pronto-socorro), como na regra do painel de origem.
CONSULTAS_TUSS = ("10101012", "10101039")
# Nome dado ao cadastro "não informado" de prestador, solicitante e local (o molde o tira dos rankings).
NAO_INFORMADO = "Não informado na guia"


def env(nome: str, padrao: str | None = None) -> str:
    valor = os.environ.get(nome, padrao)
    if not valor:
        sys.exit(f"Defina {nome} (veja o cabeçalho de {Path(__file__).name}).")
    return valor


ORIGEM = Path(env("GUIAS_ORIGEM")).as_posix()
PASTA = Path(os.environ.get("GUIAS_PASTA", Path.cwd())).resolve()
DADOS = PASTA / "dados"
COOPERATIVA = env("GUIAS_COOPERATIVA")
SAL = env("GUIAS_SAL")


def tabela(nome: str) -> str:
    return f"read_parquet('{ORIGEM}/{nome}.parquet')"


def sql_str(valor: str) -> str:
    return "'" + valor.replace("'", "''") + "'"


def main() -> None:
    DADOS.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order = false")
    tmp = (PASTA / "_duckdb_tmp").as_posix()
    con.execute(f"SET temp_directory = '{tmp}'")

    # Valores e serviços somados por guia (a extração traz uma linha por serviço da guia).
    con.execute(f"""
        CREATE TEMP TABLE servicos AS
        SELECT "%CHAVE_GUIA" AS chave_guia,
               SUM("MEDIDAS_VLR_SERVIÇO")::DECIMAL(18, 2) AS vlr_servico,
               SUM("MEDIDAS_VLR_COPARTICIPAÇÃO")::DECIMAL(18, 2) AS vlr_coparticipacao,
               COUNT(*)::INTEGER AS qtd_servicos,
               bool_or(regexp_replace("%CHAVE_SERVICO", '^[A-Z]-', '') IN {CONSULTAS_TUSS}) AS consulta
        FROM {tabela('D_GERENCIADOR_GUIA_SERVIÇOS')}
        GROUP BY 1
    """)

    # Prazo da auditoria, por processo de auditoria (um processo pode cobrir várias guias, ligadas pela mesma
    # %CHAVE_GUIA_AUDITORIA). Concluída: todas as etapas com data final. No prazo: a última etapa terminou até a
    # maior data prevista. Horas: do início da primeira etapa ao fim da última. Datas em número serial (dias).
    con.execute(f"""
        CREATE TEMP TABLE auditorias AS
        SELECT "%CHAVE_GUIA_AUDITORIA" AS chave,
               count(*) = count(TRY_CAST("GUIA_AUDITORIA_DATA_FINAL" AS DOUBLE)) AS concluida,
               min(TRY_CAST("GUIA_AUDITORIA_DATA_INÍCIO" AS DOUBLE)) AS inicio,
               max(TRY_CAST("GUIA_AUDITORIA_DATA_PREVISÃO" AS DOUBLE)) AS prazo,
               max(TRY_CAST("GUIA_AUDITORIA_DATA_FINAL" AS DOUBLE)) AS fim
        FROM {tabela('F_GERENCIADOR_AUDITORIA')}
        GROUP BY 1
    """)

    # A data vem como número serial (dias desde 30/12/1899, com a hora na fração).
    faixa = """CASE
        WHEN idade IS NULL THEN 'Não informada'
        WHEN idade <= 18 THEN '00 a 18' WHEN idade <= 23 THEN '19 a 23' WHEN idade <= 28 THEN '24 a 28'
        WHEN idade <= 33 THEN '29 a 33' WHEN idade <= 38 THEN '34 a 38' WHEN idade <= 43 THEN '39 a 43'
        WHEN idade <= 48 THEN '44 a 48' WHEN idade <= 53 THEN '49 a 53' WHEN idade <= 58 THEN '54 a 58'
        ELSE '59 ou mais' END"""
    # Rótulo de cada código, lido das tabelas de domínio (uma linha por código).
    joins = {
        "status": ("D_GERENCIADOR_GUIA_STATUS", "%CHAVE_GUIA_STATUS", "GUIA_STATUS_2"),
        "status_grupo": ("D_GERENCIADOR_GUIA_STATUS", "%CHAVE_GUIA_STATUS", "GUIA_STATUS_SIMPLIFICADO"),
        "regime": ("D_GERENCIADOR_GUIA_REGIME", "%CHAVE_GUIA_REGIME", "GUIA_REGIME"),
        "natureza": ("D_GERENCIADOR_GUIA_NATUREZA", "%CHAVE_GUIA_NATUREZA", "GUIA_NATUREZA"),
        "canal_emissao": ("D_GERENCIADOR_GUIA_LOCAL", "%CHAVE_GUIA_LOCAL", "GUIA_LOCAL"),
        "liberacao": ("D_GERENCIADOR_GUIA_LIBERAÇÃO", "%CHAVE_GUIA_LIBERAÇÃO", "GUIA_LIBERAÇÃO_2"),
        "tipo_atendimento": ("D_GERENCIADOR_GUIA_TIPO_ATENDIMENTO", "%CHAVE_GUIA_TIPO_ATENDIMENTO", "GUIA_TIPO_ATENDIMENTO"),
        "especialidade": ("D_GERENCIADOR_GUIA_ESPECIALIDADE", "%CHAVE_GUIA_ESPECIALIDADE", "GUIA_ESPECIALIDADE"),
        "cooperativa_origem": ("D_GERENCIADOR_UNIMEDS", "%CHAVE_BENEF_UNIMEDS", "BENEF_UNIMED_APELIDO"),
    }
    sel, frm = [], []
    for i, (col, (t, k, c)) in enumerate(joins.items()):
        a = f"j{i}"
        frm.append(f'LEFT JOIN (SELECT "{k}" AS k, any_value("{c}") AS v FROM {tabela(t)} GROUP BY 1) {a} ON f."{k}" = {a}.k')
        sel.append(f"COALESCE(NULLIF(trim({a}.v), ''), 'Não informado') AS {col}")

    con.execute(f"""
        COPY (
          SELECT
            f.TICKET_GUIA AS guia,
            (DATE '1899-12-30' + CAST(floor(TRY_CAST(f."DATA_EMISSÃO" AS DOUBLE)) AS INTEGER)) AS data_emissao,
            {', '.join(sel)},
            COALESCE(f.GUIA_AUDITORIA = 'S', false) AS auditoria,
            COALESCE(f.GUIA_AUDITORIA = 'S' AND au.concluida AND au.inicio IS NOT NULL, false) AS auditoria_concluida,
            COALESCE(f.GUIA_AUDITORIA = 'S' AND au.concluida AND au.fim <= au.prazo, false) AS auditoria_no_prazo,
            CASE WHEN f.GUIA_AUDITORIA = 'S' AND au.concluida AND au.inicio IS NOT NULL
                 THEN round((au.fim - au.inicio) * 24, 2)::DECIMAL(12, 2) END AS auditoria_horas,
            COALESCE(f.GUIA_FATURADA_2 = 'S', false) AS faturada,
            COALESCE(f.GUIA_PS = 'S', false) AS pronto_socorro,
            COALESCE(s.consulta, false) AS consulta,
            CASE WHEN f."%CHAVE_GUIA_NNUMEUSUA" IS NULL OR f."%CHAVE_GUIA_NNUMEUSUA" = '' THEN NULL
                 ELSE CAST(('0x' || substr(md5({sql_str(SAL)} || f."%CHAVE_GUIA_NNUMEUSUA"), 1, 15)) AS BIGINT) END AS beneficiario,
            CASE WHEN f."%CHAVE_BENEF_UNIMEDS" IS NULL OR f."%CHAVE_BENEF_UNIMEDS" = '' THEN 'Não informado'
                 WHEN f."%CHAVE_BENEF_UNIMEDS" = {sql_str(COOPERATIVA)} THEN 'Local'
                 ELSE 'Intercâmbio' END AS beneficiario_origem,
            (SELECT {faixa} FROM (SELECT TRY_CAST(f.GUIA_BENEF_IDADE AS INTEGER) AS idade)) AS faixa_etaria,
            f."%CHAVE_GUIA_PRESTADOR" AS prestador,
            f."%CHAVE_GUIA_SOLICITANTE" AS solicitante,
            f."%CHAVE_GUIA_LOCAL_ATENDIMENTO" AS local_atendimento,
            COALESCE(s.vlr_servico, 0)::DECIMAL(18, 2) AS vlr_servico,
            COALESCE(s.vlr_coparticipacao, 0)::DECIMAL(18, 2) AS vlr_coparticipacao,
            COALESCE(s.qtd_servicos, 0)::INTEGER AS qtd_servicos
          FROM {tabela('F_GERENCIADOR_GUIAS')} f
          LEFT JOIN servicos s ON s.chave_guia = f."%CHAVE_GUIA"
          LEFT JOIN auditorias au ON au.chave = f."%CHAVE_GUIA_AUDITORIA"
          {' '.join(frm)}
          ORDER BY data_emissao
        ) TO '{(DADOS / 'guias.parquet').as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 122880)
    """)

    # Cadastros: a extração repete algumas chaves; fica uma linha por chave.
    cadastros = {
        "prestadores": ("D_GERENCIADOR_PRESTADOR", "%CHAVE_GUIA_PRESTADOR", "prestador", "PRESTADOR"),
        "solicitantes": ("D_GERENCIADOR_SOLICITANTE", "%CHAVE_GUIA_SOLICITANTE", "solicitante", "SOLICITANTE"),
        "locais_atendimento": ("D_GERENCIADOR_LOCAL_ATENDIMENTO", "%CHAVE_GUIA_LOCAL_ATENDIMENTO", "local_atendimento", "LOCAL_ATENDIMENTO"),
    }
    # A guia sem executante (pedido de exame) aponta para um cadastro de "não informado" (chave NINF ou cidade
    # NÃO INFORMADO NA GUIA): o nome dele vira NAO_INFORMADO, para os rankings poderem deixá-lo de fora.
    for arquivo, (t, k, chave, p) in cadastros.items():
        texto = lambda c: f"""COALESCE(NULLIF(trim(any_value("{p}_{c}")), ''), 'Não informado')"""
        sem_cadastro = f"""("{k}" = 'NINF' OR any_value("{p}_CIDADE") = 'NÃO INFORMADO NA GUIA')"""
        con.execute(f"""
            COPY (
              SELECT "{k}" AS {chave},
                     CASE WHEN {sem_cadastro} THEN {sql_str(NAO_INFORMADO)} ELSE {texto('NOME')} END AS {chave}_nome,
                     {texto('CIDADE')} AS {chave}_cidade,
                     {texto('ESTADO')} AS {chave}_uf,
                     {texto('CLASSIFICAÇÃO')} AS {chave}_classificacao,
                     {texto('ESPECIALIDADE')} AS {chave}_especialidade
              FROM {tabela(t)}
              WHERE "{k}" IS NOT NULL AND "{k}" <> ''
              GROUP BY 1 ORDER BY 1
            ) TO '{(DADOS / f'{arquivo}.parquet').as_posix()}' (FORMAT parquet, COMPRESSION zstd)
        """)

    if "--contar" in sys.argv:
        for arquivo in ["guias", *cadastros]:
            n = con.execute(f"SELECT count(*) FROM read_parquet('{(DADOS / f'{arquivo}.parquet').as_posix()}')").fetchone()[0]
            print(f"{arquivo}: {n:,} linhas")


if __name__ == "__main__":
    main()
