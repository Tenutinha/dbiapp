"""
Gera template.json do molde "Auditoria fiscal" na pasta de trabalho (AUDITORIA_PASTA, padrão: a pasta atual).
As regras vêm de preparar.py, para o texto da seção Regras. Documentação: docs/auditoria-fiscal.md.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from preparar import REGRAS

PASTA = Path(os.environ.get("AUDITORIA_PASTA", Path.cwd())).resolve()
A = "achados"


def col(name, type_="text", required=False, description=None):
    c = {"name": name, "type": type_, "required": required}
    if description:
        c["description"] = description
    return c


tables = [
    {
        "name": "achados", "kind": "fact", "sortBy": "competencia, regra",
        "description": "Uma linha por achado: uma regra de auditoria que a nota (ou o item da nota) não cumpriu. "
                       "Regras de nota têm os campos de item vazios.",
        "columns": [
            col("regra", required=True, description="Código da regra (ver o cadastro de regras)."),
            col("fonte", required=True, description="Arquivo em que o achado foi encontrado: EFD Contribuições, EFD ICMS/IPI ou NF-e (XML)."),
            col("competencia", required=True, description="Mês do arquivo (AAAA-MM); nos XML, o mês de emissão."),
            col("estabelecimento", description="CNPJ do estabelecimento que escriturou a nota."),
            col("chave", description="Chave de acesso da nota."),
            col("num_doc"), col("operacao", description="Entrada ou Saída."),
            col("cod_part", description="Código do participante no arquivo (no XML, o CNPJ da outra parte)."),
            col("num_item"), col("cod_item"), col("cfop"), col("cst_pis"), col("cst_cofins"),
            col("campo", description="Campo do layout que a regra confere."),
            col("esperado", "decimal", description="Valor que a regra calcula (soma dos itens, base × alíquota, valor no outro arquivo)."),
            col("encontrado", "decimal", description="Valor informado no arquivo."),
            col("diferenca", "decimal", description="Encontrado menos esperado."),
            col("arquivo", description="Nome do arquivo de origem."),
            col("linha", "integer", description="Linha do registro no arquivo de origem."),
        ],
    },
    {
        "name": "cobertura", "kind": "fact", "sortBy": "competencia",
        "description": "Uma linha por arquivo fiscal e mês: quantas notas regulares cada fonte trouxe e o valor delas. "
                       "Mostra o que a auditoria conseguiu cruzar.",
        "columns": [col("fonte", required=True), col("competencia", required=True),
                    col("notas", "integer", True), col("valor", "decimal")],
    },
    {
        "name": "regras", "kind": "dimension", "key": "regra",
        "description": "Cadastro das regras de auditoria: o que cada uma confere e o que fazer com o achado.",
        "columns": [col("regra", required=True), col("grupo", required=True), col("titulo", required=True),
                    col("gravidade", required=True), col("descricao", required=True), col("acao", required=True)],
    },
]

fields = [
    {"id": "ano", "label": "Ano", "sql": "left(achados.competencia, 4)"},
    {"id": "competencia", "label": "Competência", "sql": "achados.competencia"},
    {"id": "grupo", "label": "Grupo de regras", "sql": "regras.grupo"},
    {"id": "regra", "label": "Regra", "sql": "concat(regras.regra, ' - ', regras.titulo)"},
    {"id": "gravidade", "label": "Gravidade", "sql": "regras.gravidade"},
    {"id": "fonte", "label": "Arquivo", "sql": "achados.fonte"},
    {"id": "operacao", "label": "Operação", "sql": "achados.operacao"},
    {"id": "estabelecimento", "label": "Estabelecimento", "sql": "achados.estabelecimento"},
    {"id": "chave", "label": "Chave", "sql": "achados.chave"},
    {"id": "num_doc", "label": "Número", "sql": "achados.num_doc"},
    {"id": "participante", "label": "Participante", "sql": "achados.cod_part"},
    {"id": "cod_item", "label": "Item", "sql": "achados.cod_item"},
    {"id": "cfop", "label": "CFOP", "sql": "achados.cfop"},
    {"id": "cst_pis", "label": "CST PIS", "sql": "achados.cst_pis"},
    {"id": "cob_competencia", "label": "Competência", "sql": "cobertura.competencia"},
]

measures = [
    {"id": "achados", "label": "Achados", "sql": "COUNT(*)", "format": "integer"},
    {"id": "notas", "label": "Notas", "sql": "COUNT(DISTINCT achados.chave)", "format": "integer"},
    {"id": "itens", "label": "Itens", "sql": "COUNT(achados.num_item)", "format": "integer"},
    {"id": "regras_com_achado", "label": "Regras com achado", "sql": "COUNT(DISTINCT achados.regra)", "format": "integer"},
    {"id": "esperado", "label": "Esperado", "sql": "SUM(achados.esperado)", "format": "currency_exact"},
    {"id": "encontrado", "label": "Encontrado", "sql": "SUM(achados.encontrado)", "format": "currency_exact"},
    {"id": "diferenca", "label": "Diferença", "sql": "SUM(achados.diferenca)", "format": "currency_exact"},
    {"id": "diferenca_abs", "label": "Diferença absoluta", "sql": "SUM(abs(achados.diferenca))", "format": "currency"},
    {"id": "valor_notas", "label": "Valor das notas",
     "sql": "SUM(CASE WHEN achados.regra IN ('X01', 'O02', 'O03') THEN achados.esperado END)", "format": "currency"},
    {"id": "pis_monofasico", "label": "PIS destacado", "sql": "SUM(CASE WHEN achados.regra = 'O01' THEN achados.encontrado END)",
     "format": "currency"},
    {"id": "cob_contrib", "label": "EFD Contribuições", "format": "integer",
     "sql": "SUM(CASE WHEN cobertura.fonte = 'EFD Contribuições' THEN cobertura.notas END)"},
    {"id": "cob_icms", "label": "EFD ICMS/IPI", "format": "integer",
     "sql": "SUM(CASE WHEN cobertura.fonte = 'EFD ICMS/IPI' THEN cobertura.notas END)"},
    {"id": "cob_xml", "label": "NF-e (XML)", "format": "integer",
     "sql": "SUM(CASE WHEN cobertura.fonte = 'NF-e (XML)' THEN cobertura.notas END)"},
]

FILTROS = ["ano", "competencia", "grupo", "regra", "fonte", "operacao", "estabelecimento"]
DETALHE = [
    {"label": "Regra", "sql": "achados.regra"}, {"label": "Competência", "sql": "achados.competencia"},
    {"label": "Arquivo", "sql": "achados.fonte"}, {"label": "Operação", "sql": "achados.operacao"},
    {"label": "Chave", "sql": "achados.chave"}, {"label": "Número", "sql": "achados.num_doc"},
    {"label": "Participante", "sql": "achados.cod_part"}, {"label": "Item", "sql": "achados.num_item"},
    {"label": "Código do item", "sql": "achados.cod_item"}, {"label": "CFOP", "sql": "achados.cfop"},
    {"label": "CST PIS", "sql": "achados.cst_pis"}, {"label": "CST COFINS", "sql": "achados.cst_cofins"},
    {"label": "Campo", "sql": "achados.campo"}, {"label": "Esperado", "sql": "achados.esperado"},
    {"label": "Encontrado", "sql": "achados.encontrado"}, {"label": "Diferença", "sql": "achados.diferenca"},
    {"label": "Arquivo de origem", "sql": "achados.arquivo"}, {"label": "Linha", "sql": "achados.linha"},
]


def secao_grupo(prefixo, sid, titulo, descricao, medidas_extra):
    where = f"achados.regra LIKE '{prefixo}%'"
    vis = [
        {"id": f"b_{sid}_regra", "type": "bar", "title": "Achados por regra", "span": 6, "field": "regra",
         "measures": ["achados"], "sort": "measure_desc", "limit": 20, "horizontal": True, "where": where},
        {"id": f"l_{sid}_mes", "type": "line", "title": "Achados por competência", "span": 6, "field": "competencia",
         "measures": ["achados"], "sort": "field", "limit": 200, "where": where},
        {"id": f"t_{sid}_competencia", "type": "table", "title": "Achados por competência e regra", "span": 12,
         "fields": ["competencia", "regra"], "measures": ["achados", "notas", *medidas_extra], "sort": "field_desc",
         "total": True, "limit": 2000, "where": where},
        {"id": f"t_{sid}_nota", "type": "table", "title": "Notas com achados", "span": 12,
         "fields": ["competencia", "chave", "num_doc", "operacao", "regra"], "measures": ["achados", *medidas_extra],
         "sort": "field_desc", "total": True, "limit": 5000, "where": where},
        {"id": f"r_{sid}_detalhe", "type": "rows", "title": "Achados como vieram (escolha uma regra ou competência para ver mais)",
         "span": 12, "columns": DETALHE, "orderBy": "achados.competencia", "limit": 50,
         "expand": {"filter": "regra", "limit": 2000}, "where": where},
    ]
    return vis, {"id": sid, "title": titulo, "description": descricao, "visuals": [v["id"] for v in vis]}


visuals = [
    {"id": "k_achados", "type": "kpi", "title": "Achados", "span": 3, "measure": "achados"},
    {"id": "k_notas", "type": "kpi", "title": "Notas com achado", "span": 3, "measure": "notas"},
    {"id": "k_regras", "type": "kpi", "title": "Regras com achado", "span": 3, "measure": "regras_com_achado"},
    {"id": "k_diferenca", "type": "kpi", "title": "Diferença absoluta nos valores", "span": 3, "measure": "diferenca_abs"},
    {"id": "t_regras", "type": "table", "title": "Achados por regra", "span": 12,
     "fields": ["regra", "grupo", "gravidade"], "measures": ["achados", "notas", "diferenca_abs", "valor_notas"],
     "total": True, "limit": 50},
    {"id": "l_achados_mes", "type": "bar", "title": "Achados por competência", "span": 8, "field": "competencia",
     "measures": ["achados"], "sort": "field", "limit": 200},
    {"id": "d_grupo", "type": "donut", "title": "Achados por grupo de regras", "span": 4, "field": "grupo", "measure": "achados"},
]
analyses = [{
    "id": "visao_geral", "title": "Visão geral",
    "description": "Achados das regras de auditoria sobre os arquivos fiscais do espaço (EFD Contribuições, EFD ICMS/IPI e XML de NF-e). "
                   "Um achado é uma nota ou um item que não cumpriu uma regra; o que cada regra confere está na seção Regras. "
                   "A diferença absoluta soma as diferenças de valor sem sinal: é o tamanho do problema, não um valor a recuperar.",
    "visuals": [v["id"] for v in visuals],
}]

for prefixo, sid, titulo, descricao, extra in (
    ("C", "consistencia", "Consistência interna",
     ("Regras que conferem cada EFD Contribuições com ela mesma: a nota contra os seus itens, o valor contra base × alíquota, "
     "o CST contra a operação e o CFOP, a chave de acesso. Não dependem de interpretação tributária."),
     ["esperado", "encontrado", "diferenca"]),
    ("X", "cruzamento", "Cruzamento entre arquivos",
     ("A mesma nota nos outros arquivos: EFD ICMS/IPI contra EFD Contribuições (só nos estabelecimentos e meses que os dois cobrem) e "
     "XML de NF-e contra a EFD Contribuições, nas notas emitidas pela própria empresa."),
     ["esperado", "encontrado", "diferenca"]),
    ("O", "oportunidades", "Oportunidades a validar",
     ("Situações que podem indicar tributo pago a maior ou crédito não aproveitado: entradas que estão no ICMS/IPI ou nos XML e "
     "não na EFD Contribuições, e produto monofásico tributado na saída. Dependem da atividade da empresa e do direito ao crédito, e "
     "precisam da validação do tributário antes de qualquer pedido. Os XML não dizem se a nota foi cancelada ou recusada."),
     ["valor_notas", "pis_monofasico"]),
):
    vis, sec = secao_grupo(prefixo, sid, titulo, descricao, extra)
    visuals += vis
    analyses.append(sec)

textos = []
for grupo in dict.fromkeys(r[1] for r in REGRAS):
    corpo = "\n\n".join(f"{r[0]} - {r[2]} (gravidade {r[3].lower()}). {r[4]} O que fazer: {r[5]}" for r in REGRAS if r[1] == grupo)
    textos.append({"id": "x_regras_" + grupo.split()[0].lower().replace("ê", "e"), "type": "text", "title": grupo, "span": 12, "body": corpo})
visuals += [
    *textos,
    {"id": "t_cobertura", "type": "table", "title": "Notas regulares por arquivo e competência", "span": 12, "fact": "cobertura",
     "fields": ["cob_competencia"], "measures": ["cob_contrib", "cob_icms", "cob_xml"], "sort": "field_desc", "total": True,
     "limit": 500, "skipFilters": FILTROS},
]
analyses += [
    {"id": "regras", "title": "Regras", "description": "O que cada regra confere e o que fazer com o achado.", "visuals": [t["id"] for t in textos]},
    {"id": "cobertura", "title": "Cobertura dos arquivos",
     "description": "Quantas notas regulares (NF-e e NFC-e não canceladas) cada arquivo trouxe por mês. Um cruzamento só vale nos meses "
                    "em que os dois arquivos têm notas. Esta tabela não segue os filtros da página.",
     "visuals": ["t_cobertura"]},
]

template = {
    "id": "auditoria-fiscal", "version": 1, "name": "Auditoria fiscal", "area": "Fiscal", "origin": "web",
    "description": "Regras de auditoria sobre os arquivos fiscais (EFD Contribuições, EFD ICMS/IPI e XML de NF-e): "
                   "consistência de cada nota e item, cruzamento entre os arquivos e oportunidades a validar.",
    "tables": tables,
    "relationships": [{"from": {"table": "achados", "column": "regra"}, "to": {"table": "regras", "column": "regra"}}],
    "fields": fields, "measures": measures, "filters": FILTROS, "filterDefaults": {},
    "visuals": visuals, "analyses": analyses,
    "summary": [{"title": "Auditoria", "analyses": [a["id"] for a in analyses]}],
}
(PASTA / "template.json").write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"template.json: {len(visuals)} visuais, {len(analyses)} seções")
