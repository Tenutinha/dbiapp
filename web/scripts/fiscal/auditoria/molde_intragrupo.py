"""
A seção "Notas entre estabelecimentos do grupo" do molde "Auditoria fiscal": tabela, campos, medidas e visuais sobre o que
intragrupo.py grava. Documentação: docs/auditoria-fiscal.md.
"""
from intragrupo import MESES_NORMAIS, MOTIVOS, TOLERANCIA_VALOR

T = "intragrupo"
NAO_FECHA = f"{T}.situacao = 'Não fecha'"
# O detalhe: as notas que não fecham no mesmo mês (as que fecham no mesmo mês vêm somadas, sem chave).
DETALHE = f"{T}.chave IS NOT NULL"


def col(name: str, type_: str = "text", required: bool = False, description: str | None = None) -> dict:
    c = {"name": name, "type": type_, "required": required}
    if description:
        c["description"] = description
    return c


def lado(prefixo: str, quem: str) -> list[dict]:
    return [
        col(f"{prefixo}_competencia", description=f"Mês do arquivo do {quem} em que a nota está (vazio: não está)."),
        col(f"{prefixo}_operacao", description="Entrada ou Saída (IND_OPER)."),
        col(f"{prefixo}_situacao", description="Regular, Cancelada, Denegada ou Inutilizada (COD_SIT)."),
        col(f"{prefixo}_dt_doc", "date"), col(f"{prefixo}_dt_e_s", "date", description="Data de entrada ou saída (DT_E_S)."),
        col(f"{prefixo}_valor", "decimal", description="VL_DOC."),
        col(f"{prefixo}_cfop", description="CFOP dos C190 da nota, na ordem do arquivo."),
        col(f"{prefixo}_arquivo", description="Nome do arquivo original."),
        col(f"{prefixo}_linha", "integer", description="Linha do C100 no arquivo original."),
        col(f"{prefixo}_ocorrencias", "integer", description="Quantas vezes a chave aparece nos arquivos do estabelecimento."),
    ]


TABELAS = [{
    "name": T, "kind": "fact", "sortBy": "competencia, emitente, destinatario",
    "description": "Notas entre estabelecimentos do grupo (EFD ICMS/IPI): uma linha por nota que não fecha no mesmo mês, com os dois "
                   "lados, e uma linha por mês e par de estabelecimentos com as notas que fecham no mesmo mês, somadas. "
                   "Gerada por intragrupo.py a partir dos C100 e 0150 de todos os arquivos.",
    "columns": [
        col("competencia", required=True, description="Mês da nota (do emitente; sem ele, o do destinatário)."),
        col("ano", required=True),
        col("situacao", required=True, description="Fecha, Não fecha ou Falta arquivo."),
        col("motivo", required=True, description="Código do motivo (F0 a A2)."),
        col("motivo_descricao", required=True),
        col("chave", description="Chave de acesso (vazia nas linhas que somam as notas que fecham no mesmo mês)."),
        col("num_doc"), col("serie"), col("modelo"),
        col("emitente", required=True, description="CNPJ do estabelecimento que emitiu a nota (o da chave)."),
        col("destinatario", required=True, description="CNPJ do outro estabelecimento do grupo."),
        *lado("emit", "emitente"), *lado("dest", "destinatário"),
        col("valor", "decimal", description="Valor da nota (do emitente; sem ele, o do destinatário)."),
        col("diferenca", "decimal", description="Valor no destinatário menos valor no emitente."),
        col("meses", "integer", description="Meses da escrituração da saída à da entrada."),
        col("notas", "integer", True, "Quantas notas a linha representa (1 no detalhe)."),
    ],
}]

CAMPOS = [
    {"id": "ig_ano", "label": "Ano", "sql": f"{T}.ano"},
    {"id": "ig_competencia", "label": "Competência", "sql": f"{T}.competencia"},
    {"id": "ig_situacao", "label": "Situação", "sql": f"{T}.situacao"},
    {"id": "ig_motivo", "label": "Motivo", "sql": f"{T}.motivo_descricao"},
    {"id": "ig_emitente", "label": "Emitente", "sql": f"{T}.emitente"},
    {"id": "ig_destinatario", "label": "Destinatário", "sql": f"{T}.destinatario"},
    {"id": "ig_cfop", "label": "CFOP do emitente", "sql": f"coalesce({T}.emit_cfop, {T}.dest_cfop)"},
]

MEDIDAS = [
    {"id": "ig_notas", "label": "Notas", "sql": f"SUM({T}.notas)", "format": "integer"},
    {"id": "ig_fecham", "label": "Fecham", "sql": f"coalesce(SUM(CASE WHEN {T}.situacao = 'Fecha' THEN {T}.notas END), 0)", "format": "integer"},
    {"id": "ig_pct_fecham", "label": "Fecham (%)", "format": "percent",
     "sql": f"SUM(CASE WHEN {T}.situacao = 'Fecha' THEN {T}.notas END) / NULLIF(SUM({T}.notas), 0)"},
    {"id": "ig_nao_fecham", "label": "Não fecham", "sql": f"coalesce(SUM(CASE WHEN {NAO_FECHA} THEN {T}.notas END), 0)", "format": "integer"},
    {"id": "ig_falta_arquivo", "label": "Falta arquivo", "format": "integer",
     "sql": f"coalesce(SUM(CASE WHEN {T}.situacao = 'Falta arquivo' THEN {T}.notas END), 0)"},
    {"id": "ig_valor", "label": "Valor das notas", "sql": f"SUM({T}.valor)", "format": "currency"},
    {"id": "ig_valor_nao_fecha", "label": "Valor que não fecha", "sql": f"SUM(CASE WHEN {NAO_FECHA} THEN {T}.valor END)",
     "format": "currency"},
    {"id": "ig_diferenca_abs", "label": "Diferença de valor", "sql": f"SUM(abs({T}.diferenca))", "format": "currency"},
]

COLUNAS = [
    {"label": "Competência", "sql": f"{T}.competencia"}, {"label": "Motivo", "sql": f"{T}.motivo_descricao"},
    {"label": "Chave", "sql": f"{T}.chave"}, {"label": "Número", "sql": f"{T}.num_doc"},
    {"label": "Emitente", "sql": f"{T}.emitente"},
    {"label": "Emitente: mês", "sql": f"{T}.emit_competencia"}, {"label": "Emitente: operação", "sql": f"{T}.emit_operacao"},
    {"label": "Emitente: situação", "sql": f"{T}.emit_situacao"}, {"label": "Emitente: valor", "sql": f"{T}.emit_valor"},
    {"label": "Emitente: CFOP", "sql": f"{T}.emit_cfop"},
    {"label": "Destinatário", "sql": f"{T}.destinatario"},
    {"label": "Destinatário: mês", "sql": f"{T}.dest_competencia"}, {"label": "Destinatário: operação", "sql": f"{T}.dest_operacao"},
    {"label": "Destinatário: situação", "sql": f"{T}.dest_situacao"}, {"label": "Destinatário: valor", "sql": f"{T}.dest_valor"},
    {"label": "Destinatário: entrada", "sql": f"{T}.dest_dt_e_s"},
    {"label": "Diferença", "sql": f"{T}.diferenca"}, {"label": "Meses", "sql": f"{T}.meses"},
    {"label": "Emitente: arquivo", "sql": f"{T}.emit_arquivo"}, {"label": "Emitente: linha", "sql": f"{T}.emit_linha"},
    {"label": "Destinatário: arquivo", "sql": f"{T}.dest_arquivo"}, {"label": "Destinatário: linha", "sql": f"{T}.dest_linha"},
]


def leitura() -> str:
    motivos = "\n\n".join(f"{m[2]} ({m[1].lower()}). {m[3]}".rstrip() for m in MOTIVOS)
    return (
        "Uma nota em que os dois lados são estabelecimentos do grupo tem de estar nos dois arquivos de EFD ICMS/IPI com a mesma chave "
        "e sentidos opostos: a saída de um é a entrada do outro. O grupo é quem entrega EFD ICMS/IPI no espaço; o participante do C100 é "
        "reconhecido pelo CNPJ do 0150 (os de mesma raiz contam, mesmo sem arquivo).\n\n"
        "Cada nota é procurada pela chave nos arquivos da contraparte de todos os meses. Ordem dos motivos: situação, sentido, valor "
        f"(tolerância de R$ {TOLERANCIA_VALOR:.2f}".replace(".", ",") + f"), mês (até {MESES_NORMAIS} mês depois da saída é normal).\n\n"
        + motivos
    )


def secao(filtros: list[str]) -> tuple[list[dict], dict]:
    """Os visuais e a seção. Nenhum segue os filtros da página, que são dos achados: a seção filtra pelos próprios visuais."""
    comum = {"fact": T, "skipFilters": filtros}
    vis = [
        {"id": "k_ig_notas", "type": "kpi", "title": "Notas entre estabelecimentos do grupo", "span": 3, "measure": "ig_notas",
         "detail": {"measure": "ig_valor", "text": "em valor"}, **comum},
        {"id": "k_ig_fecham", "type": "kpi", "title": "Fecham", "span": 3, "measure": "ig_fecham",
         "detail": {"measure": "ig_pct_fecham", "text": "das notas"}, **comum},
        {"id": "k_ig_nao_fecham", "type": "kpi", "title": "Não fecham", "span": 3, "measure": "ig_nao_fecham",
         "detail": {"measure": "ig_valor_nao_fecha", "text": "em valor"}, **comum},
        {"id": "k_ig_falta_arquivo", "type": "kpi", "title": "Falta o arquivo da contraparte", "span": 3, "measure": "ig_falta_arquivo",
         "detail": {"text": "não é falha da nota"}, **comum},
        {"id": "t_ig_motivo", "type": "table", "title": "Notas por situação e motivo", "span": 5, "fields": ["ig_situacao", "ig_motivo"],
         "measures": ["ig_notas", "ig_valor", "ig_diferenca_abs"], "total": True, "limit": 20, **comum},
        {"id": "b_ig_mes", "type": "bar", "title": "Notas que não fecham por competência", "span": 7, "field": "ig_competencia",
         "measures": ["ig_nao_fecham"], "sort": "field", "limit": 200, **comum},
        {"id": "m_ig_estab_ano", "type": "matrix", "title": "Onde não fecha: emitente por ano (clique para filtrar)", "span": 12,
         "row": "ig_emitente", "column": "ig_ano", "measure": "ig_nao_fecham", **comum, "where": NAO_FECHA},
        {"id": "t_ig_par", "type": "table", "title": "Pares de estabelecimentos", "span": 7, "fields": ["ig_emitente", "ig_destinatario"],
         "measures": ["ig_notas", "ig_nao_fecham", "ig_pct_fecham", "ig_valor_nao_fecha"], "orderBy": "ig_nao_fecham", "total": True,
         "limit": 2000, **comum},
        {"id": "t_ig_cfop", "type": "table", "title": "Notas que não fecham por CFOP", "span": 5, "fields": ["ig_cfop"],
         "measures": ["ig_nao_fecham", "ig_valor_nao_fecha"], "total": True, "limit": 200, **comum, "where": NAO_FECHA},
        {"id": "r_ig_notas", "type": "rows", "title": "Notas que não fecham, os dois lados lado a lado (clique num motivo, par ou quadro do mapa para escolher)",
         "span": 12, "columns": COLUNAS, "orderBy": f"{T}.competencia DESC, {T}.emitente, {T}.chave", "limit": 1000, **comum, "where": f"{DETALHE} AND {T}.situacao <> 'Fecha'"},
        {"id": "x_ig_leitura", "type": "text", "title": "Como ler esta seção", "span": 12, "body": leitura()},
    ]
    return vis, {
        "id": "intragrupo", "title": "Notas entre estabelecimentos do grupo",
        "description": "A saída escriturada por um estabelecimento do grupo tem de aparecer como entrada no outro, com a mesma chave "
                       "(e vice-versa). Aqui está, para cada nota entre estabelecimentos do grupo nos arquivos de EFD ICMS/IPI, se o par "
                       "fecha e, se não fecha, por quê: chave ausente na contraparte, mesmo sentido nos dois lados, mês fora do prazo, "
                       "valor ou situação diferente, ou falta do arquivo da contraparte. Clique num quadro do mapa, numa linha ou num "
                       "motivo para ver só ele. Esta seção não segue os filtros da página.",
        "visuals": [v["id"] for v in vis],
    }
