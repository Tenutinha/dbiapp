"""
Gera template.json do molde "Auditoria fiscal" na pasta de trabalho (AUDITORIA_PASTA, padrão: a pasta atual).
As regras vêm de preparar.py, para o texto da seção Regras; o Glossário lê a tabela que glossario.py grava.
Documentação: docs/auditoria-fiscal.md.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import molde_intragrupo
import molde_ncm
import molde_reforma
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
        "name": "glossario", "kind": "fact", "sortBy": "ordem",
        "description": "Glossário: uma linha por auditoria, as que já rodam (Ativa) e as do catálogo (Planejada). "
                       "Gerada por glossario.py a partir de docs/auditorias-catalogo.md e das regras do preparo.",
        "columns": [
            col("ordem", "integer", True, "Ordem de leitura: tema a tema, as ativas primeiro."),
            col("codigo", required=True, description="Código da auditoria (C01, X02, O03 nas regras ativas; EC01, CR17… no catálogo)."),
            col("tema_ordem", "integer", True, "Número do tema no catálogo (1 a 15)."),
            col("tema", required=True), col("auditoria", required=True, description="Nome curto."),
            col("situacao", required=True, description="Ativa (já roda) ou Planejada (está no catálogo)."),
            col("confere", required=True, description="O que a auditoria confere."),
            col("importa", required=True, description="Por que importa para a empresa; nas regras ativas, o que fazer com o achado."),
            col("dificuldade", description="Baixa, média ou alta; vazia nas regras ativas."),
            col("tributarista", required=True, description="Sim quando o achado depende de validação do tributarista."),
            col("resultado", required=True, description="Erro, risco, oportunidade de recuperação ou indicador."),
        ],
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
    {"id": "gl_tema", "label": "Tema", "sql": "glossario.tema"},
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
    {"id": "gl_auditorias", "label": "Auditorias", "sql": "COUNT(glossario.codigo)", "format": "integer"},
    {"id": "gl_ativas", "label": "Ativas", "format": "integer",
     "sql": "COUNT(CASE WHEN glossario.situacao = 'Ativa' THEN 1 END)"},
    {"id": "gl_planejadas", "label": "Planejadas", "format": "integer",
     "sql": "COUNT(CASE WHEN glossario.situacao = 'Planejada' THEN 1 END)"},
    {"id": "gl_tributarista", "label": "Dependem do tributarista", "format": "integer",
     "sql": "COUNT(CASE WHEN glossario.tributarista = 'Sim' THEN 1 END)"},
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


def secao_glossario() -> tuple[list[dict], dict]:
    """A primeira seção: os números do glossário e o catálogo numa listagem só, por tema. Não segue os filtros da página."""
    comum = {"fact": "glossario", "skipFilters": FILTROS}
    colunas = [
        {"label": "Código", "sql": "glossario.codigo"}, {"label": "Auditoria", "sql": "glossario.auditoria", "wrap": True},
        {"label": "Situação", "sql": "glossario.situacao"}, {"label": "O que confere", "sql": "glossario.confere", "wrap": True},
        {"label": "Por que importa", "sql": "glossario.importa", "wrap": True}, {"label": "Dificuldade", "sql": "glossario.dificuldade"},
        {"label": "Tributarista", "sql": "glossario.tributarista"}, {"label": "Resultado", "sql": "glossario.resultado"},
    ]
    vis = [
        {"id": "k_gl_auditorias", "type": "kpi", "title": "Auditorias no glossário", "span": 3, "measure": "gl_auditorias", **comum},
        {"id": "k_gl_ativas", "type": "kpi", "title": "Ativas", "span": 3, "measure": "gl_ativas", **comum},
        {"id": "k_gl_planejadas", "type": "kpi", "title": "Planejadas", "span": 3, "measure": "gl_planejadas", **comum},
        {"id": "k_gl_tributarista", "type": "kpi", "title": "Dependem do tributarista", "span": 3, "measure": "gl_tributarista", **comum},
        {"id": "t_gl_temas", "type": "table", "title": "Auditorias por tema", "span": 12, "fields": ["gl_tema"],
         "measures": ["gl_ativas", "gl_planejadas", "gl_auditorias"], "total": True, "limit": 50, **comum},
        # Uma listagem só: cada tema é um tópico (linha de título) e as suas auditorias, os subtópicos.
        {"id": "r_gl_auditorias", "type": "rows", "title": "Catálogo de auditorias", "span": 12, "columns": colunas,
         "orderBy": "glossario.ordem", "groupBy": "concat(glossario.tema_ordem, '. ', glossario.tema)", "limit": 1000, **comum},
    ]
    return vis, {
        "id": "glossario", "title": "Glossário",
        "description": "Todas as auditorias que fazemos e que podemos fazer com os arquivos fiscais do espaço, num catálogo só: "
                       "cada tema é um tópico e as suas auditorias vêm logo abaixo. "
                       "Ativa: já roda (as regras C, X e O têm os achados nas seções seguintes; a inclusão de insumos gera o arquivo "
                       "corrigido à parte). Planejada: está no catálogo e ainda não foi implementada. "
                       "Onde o tributarista aparece como \"Sim\", o achado só vira oportunidade ou risco depois de validado. "
                       "Esta seção não segue os filtros da página.",
        "visuals": [v["id"] for v in vis],
    }


vis_glossario, sec_glossario = secao_glossario()

visuals = [
    *vis_glossario,
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
analyses = [sec_glossario, {
    "id": "visao_geral", "title": "Visão geral",
    "description": "Achados das regras de auditoria sobre os arquivos fiscais do espaço (EFD Contribuições, EFD ICMS/IPI e XML de NF-e). "
                   "Um achado é uma nota ou um item que não cumpriu uma regra; o que cada regra confere está na seção Regras. "
                   "A diferença absoluta soma as diferenças de valor sem sinal: é o tamanho do problema, não um valor a recuperar.",
    "visuals": [v["id"] for v in visuals if v not in vis_glossario],
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
    if sid == "cruzamento":
        # Logo depois do cruzamento entre arquivos: a mesma nota nos arquivos de dois estabelecimentos do grupo.
        vis_ig, sec_ig = molde_intragrupo.secao(FILTROS)
        visuals += vis_ig
        analyses.append(sec_ig)
        # Depois, o cadastro de itens: o NCM contra o fornecedor, as tabelas de PIS/COFINS e a NCM vigente (ncm.py).
        fontes = PASTA / "entrada" / "tabelas_fontes.txt"
        vis_ncm, sec_ncm = molde_ncm.secao(FILTROS, fontes.read_text(encoding="utf-8") if fontes.exists() else
                                           "tabelas do SPED da EFD Contribuições e NCM vigente do Portal Único Siscomex.")
        visuals += vis_ncm
        analyses.append(sec_ncm)

vis_reforma, sec_reforma = molde_reforma.secao(FILTROS)
visuals += vis_reforma
analyses.append(sec_reforma)

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
                   "consistência de cada nota e item, cruzamento entre os arquivos, oportunidades a validar e a simulação da "
                   "reforma tributária.",
    "density": "compact",
    "tables": tables + molde_intragrupo.TABELAS + molde_ncm.TABELAS + molde_reforma.TABELAS,
    "relationships": [{"from": {"table": "achados", "column": "regra"}, "to": {"table": "regras", "column": "regra"}}],
    "fields": fields + molde_intragrupo.CAMPOS + molde_ncm.CAMPOS + molde_reforma.CAMPOS,
    "measures": measures + molde_intragrupo.MEDIDAS + molde_ncm.MEDIDAS + molde_reforma.MEDIDAS, "filters": FILTROS, "filterDefaults": {},
    "visuals": visuals, "analyses": analyses,
    "summary": [{"title": "Auditoria", "analyses": [a["id"] for a in analyses]}],
}
(PASTA / "template.json").write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"template.json: {len(visuals)} visuais, {len(analyses)} seções")
