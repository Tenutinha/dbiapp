"""
A seção "Reforma tributária" do molde "Auditoria fiscal": tabelas, campos, medidas e visuais sobre o que reforma.py grava.
As alíquotas das medidas vêm de CENARIOS, em reforma.py: mudar um parâmetro é mudar lá e gerar o molde de novo.
Documentação: docs/auditoria-fiscal.md.
"""
from reforma import CBS_2027, CENARIOS, CENTRAL, IBS_2027_2028, REDUCAO_CBS_2027_2028, Cenario

R = "reforma"
BASE = "reforma.ano_base = 'Sim'"


def col(name: str, type_: str = "text", required: bool = False, description: str | None = None) -> dict:
    c = {"name": name, "type": type_, "required": required}
    if description:
        c["description"] = description
    return c


def dec(name: str, description: str | None = None) -> dict:
    return col(name, "decimal", False, description)


def pct(valor: float) -> str:
    return f"{valor:.2f}".rstrip("0").rstrip(".").replace(".", ",") + "%"


TABELAS = [
    {
        "name": "reforma", "kind": "fact", "sortBy": "competencia, fonte",
        "description": "Reforma tributária: uma linha por mês, estabelecimento, arquivo, operação, CFOP e CST, com os valores "
                       "escriturados e as bases da simulação de CBS e IBS. As linhas de arquivo Apuração trazem só o valor a recolher.",
        "columns": [
            col("competencia", required=True, description="Mês do arquivo (AAAA-MM)."), col("ano", required=True),
            col("estabelecimento", required=True, description="CNPJ do estabelecimento (nos serviços e nas apurações de PIS e Cofins, o do arquivo)."),
            col("fonte", required=True, description="EFD ICMS/IPI, EFD Contribuições ou Apuração."),
            col("operacao", required=True, description="Entrada, Saída ou Apuração."), col("cfop"),
            col("natureza", required=True, description="Natureza da operação, pelo CFOP (venda, compra, transferência, devolução…)."),
            col("destino", required=True, description="Dentro do estado, interestadual ou exterior, pelo primeiro dígito do CFOP."),
            col("cst", description="CST do ICMS (EFD ICMS/IPI) ou do PIS (EFD Contribuições)."),
            col("tratamento", required=True, description="O tratamento tributário que o CST indica; nas apurações, o tributo."),
            dec("valor", "Valor da operação (EFD ICMS/IPI) ou do item menos o desconto (EFD Contribuições)."),
            dec("icms_base"), dec("icms_debito"), dec("icms_credito"), dec("icms_st", "ICMS retido por substituição tributária destacado no documento."),
            dec("pis_debito"), dec("pis_credito"), dec("cofins_debito"), dec("cofins_credito"),
            dec("receita", "Valor das saídas com CST de receita (01 a 09) na EFD Contribuições."),
            dec("base_debito", "Simulação: receita sem o ICMS, o PIS e a Cofins de hoje, menos as devoluções de venda."),
            dec("base_credito", "Simulação: aquisições que dão crédito na regra geral, sem o ICMS, o PIS e a Cofins creditados hoje."),
            dec("aquisicao_credito_hoje", "Valor das aquisições com crédito de PIS e Cofins hoje (CST 50 a 66)."),
            dec("aquisicao_credito_reforma", "Valor das aquisições que dão crédito de CBS e IBS na regra geral."),
            dec("a_recolher_icms", "ICMS a recolher da apuração (E110)."),
            dec("a_recolher_pis_cofins", "PIS e Cofins a recolher da apuração (M200 e M600)."),
            col("ano_base", required=True, description="Sim no último ano com os doze meses: é o ano dos indicadores e da transição."),
        ],
    },
    {
        "name": "reforma_apuracao", "kind": "fact", "sortBy": "competencia",
        "description": "Uma linha por mês, estabelecimento e tributo, da apuração de cada arquivo: E110 (ICMS), M200 (PIS) e M600 (Cofins).",
        "columns": [col("competencia", required=True), col("ano", required=True), col("estabelecimento", required=True),
                    col("tributo", required=True), dec("debitos", "Débitos e ajustes a débito."), dec("creditos", "Créditos e ajustes a crédito."),
                    dec("a_recolher"), dec("saldo_credor", "Saldo credor a transportar para o mês seguinte (só no ICMS).")],
    },
    {
        "name": "reforma_transicao", "kind": "fact", "sortBy": "ano",
        "description": "O ano-base levado a cada ano da transição: uma linha por ano, tributo e cenário. ICMS, PIS e Cofins partem do "
                       "valor a recolher escriturado; CBS e IBS são simulados.",
        "columns": [col("ano", required=True), col("etapa", required=True, description="O que muda no ano."), col("tributo", required=True),
                    col("cenario", required=True, description="Soma de CBS e IBS do cenário; Todos nos tributos de hoje."),
                    col("origem", required=True, description="Escriturado ou Simulado."), dec("valor")],
    },
]

CAMPOS = [
    {"id": "rf_ano", "label": "Ano", "sql": "reforma.ano"},
    {"id": "rf_natureza", "label": "Natureza da operação", "sql": "reforma.natureza"},
    {"id": "rf_destino", "label": "Destino ou origem", "sql": "reforma.destino"},
    {"id": "rf_tratamento", "label": "Tratamento", "sql": "reforma.tratamento"},
    {"id": "rf_operacao", "label": "Operação", "sql": "reforma.operacao"},
    {"id": "rfa_competencia", "label": "Competência", "sql": "reforma_apuracao.competencia"},
    {"id": "rfa_ano", "label": "Ano", "sql": "reforma_apuracao.ano"},
    {"id": "rft_ano", "label": "Ano", "sql": "reforma_transicao.ano"},
    {"id": "rft_etapa", "label": "O que muda", "sql": "reforma_transicao.etapa"},
]

HOJE = "SUM(reforma.a_recolher_icms + reforma.a_recolher_pis_cofins)"
RECEITA = "NULLIF(SUM(reforma.receita), 0)"
LIQUIDA = "(SUM(reforma.base_debito) - SUM(reforma.base_credito))"


def medidas_do_cenario(c: Cenario) -> list[dict]:
    taxa = c.total / 100
    return [
        {"id": f"rf_debito_{c.id}", "label": f"Débito simulado ({c.rotulo})", "sql": f"SUM(reforma.base_debito) * {taxa}", "format": "currency"},
        {"id": f"rf_credito_{c.id}", "label": f"Crédito simulado ({c.rotulo})", "sql": f"SUM(reforma.base_credito) * {taxa}", "format": "currency"},
        {"id": f"rf_saldo_{c.id}", "label": f"CBS + IBS a {c.rotulo}", "sql": f"{LIQUIDA} * {taxa}", "format": "currency"},
        {"id": f"rf_carga_{c.id}", "label": f"Carga a {c.rotulo}", "sql": f"{LIQUIDA} * {taxa} / {RECEITA}", "format": "percent"},
        {"id": f"rf_diferenca_{c.id}", "label": f"Diferença a {c.rotulo}", "sql": f"{LIQUIDA} * {taxa} - {HOJE}", "format": "currency"},
        {"id": f"rft_total_{c.id}", "label": f"Total a {c.rotulo}", "format": "currency",
         "sql": f"SUM(CASE WHEN reforma_transicao.cenario IN ('Todos', '{c.rotulo}') THEN reforma_transicao.valor END)"},
    ]


def tributo_da_transicao(mid: str, label: str, tributo: str, cenario: str) -> dict:
    return {"id": mid, "label": label, "format": "currency",
            "sql": f"SUM(CASE WHEN reforma_transicao.tributo = '{tributo}' AND reforma_transicao.cenario = '{cenario}' "
                   "THEN reforma_transicao.valor END)"}


def apurado(mid: str, label: str, coluna: str, tributo: str) -> dict:
    return {"id": mid, "label": label, "format": "currency",
            "sql": f"SUM(CASE WHEN reforma_apuracao.tributo = '{tributo}' THEN reforma_apuracao.{coluna} END)"}


MEDIDAS = [
    {"id": "rf_receita", "label": "Receita", "sql": "SUM(reforma.receita)", "format": "currency"},
    {"id": "rf_ano_base", "label": "Ano-base", "sql": "MAX(CASE WHEN reforma.ano_base = 'Sim' THEN reforma.ano END)", "format": "text"},
    {"id": "rf_hoje", "label": "A recolher hoje", "sql": HOJE, "format": "currency"},
    {"id": "rf_hoje_icms", "label": "ICMS a recolher", "sql": "SUM(reforma.a_recolher_icms)", "format": "currency"},
    {"id": "rf_hoje_pis_cofins", "label": "PIS e Cofins a recolher", "sql": "SUM(reforma.a_recolher_pis_cofins)", "format": "currency"},
    {"id": "rf_carga_hoje", "label": "Carga hoje", "sql": f"{HOJE} / {RECEITA}", "format": "percent"},
    {"id": "rf_base_debito", "label": "Base dos débitos", "sql": "SUM(reforma.base_debito)", "format": "currency"},
    {"id": "rf_base_credito", "label": "Base dos créditos", "sql": "SUM(reforma.base_credito)", "format": "currency"},
    {"id": "rf_base_liquida", "label": "Base líquida", "sql": LIQUIDA, "format": "currency"},
    *[m for c in CENARIOS for m in medidas_do_cenario(c)],
    {"id": "rf_valor", "label": "Valor das operações", "sql": "SUM(reforma.valor)", "format": "currency"},
    {"id": "rf_icms", "label": "ICMS destacado", "sql": "SUM(reforma.icms_debito + reforma.icms_credito)", "format": "currency"},
    {"id": "rf_aquis_hoje", "label": "Com crédito de PIS e Cofins hoje", "sql": "SUM(reforma.aquisicao_credito_hoje)", "format": "currency"},
    {"id": "rf_aquis_reforma", "label": "Com crédito de CBS e IBS", "sql": "SUM(reforma.aquisicao_credito_reforma)", "format": "currency"},
    {"id": "rf_icms_credito", "label": "ICMS creditado", "sql": "SUM(reforma.icms_credito)", "format": "currency"},
    {"id": "rf_pis_cofins_credito", "label": "PIS e Cofins creditados", "sql": "SUM(reforma.pis_credito + reforma.cofins_credito)", "format": "currency"},
    apurado("rfa_saldo_credor", "Saldo credor de ICMS", "saldo_credor", "ICMS"),
    apurado("rfa_recolher_icms", "ICMS", "a_recolher", "ICMS"),
    apurado("rfa_recolher_pis", "PIS", "a_recolher", "PIS"),
    apurado("rfa_recolher_cofins", "Cofins", "a_recolher", "Cofins"),
    tributo_da_transicao("rft_icms", "ICMS", "ICMS", "Todos"),
    tributo_da_transicao("rft_pis_cofins", "PIS e Cofins", "PIS e Cofins", "Todos"),
    tributo_da_transicao("rft_cbs", "CBS", "CBS", CENTRAL.rotulo),
    tributo_da_transicao("rft_ibs", "IBS", "IBS", CENTRAL.rotulo),
]

LEITURA = (
    "Esta seção é uma simulação para dimensionar o efeito da reforma do consumo (EC 132/2023 e LC 214/2025) sobre os números que a "
    "empresa já escriturou. Não é aconselhamento tributário nem projeção de preço, margem ou caixa.\n\n"
    "Dado da escrituração: receita, ICMS, PIS e Cofins dos documentos (EFD ICMS/IPI e EFD Contribuições) e o valor a recolher de cada "
    "apuração (E110, M200 e M600).\n\n"
    "Hipótese: CBS e IBS calculados por fora, sobre a receita sem o ICMS, o PIS e a Cofins de hoje, numa alíquota única; crédito sobre "
    "todas as aquisições de mercadorias, uso e consumo, ativo, energia, comunicação, transporte e serviços, sem o ICMS, o PIS e a "
    "Cofins creditados hoje; preços sem tributos iguais aos de hoje e todos os fornecedores no regime regular.\n\n"
    "O que a simulação não vê: o ICMS de substituição tributária pago antes na cadeia não aparece na escrituração de quem revende. "
    "Ele fica fora do valor a recolher de hoje e dentro do custo das compras, o que aumenta o crédito simulado. Também ficam de fora o ISS, "
    "o IPI, o Imposto Seletivo, a cesta básica com alíquota zero, as alíquotas reduzidas e os regimes específicos por produto, o "
    "aproveitamento do saldo credor e a receita escriturada só em registros consolidados de cupom fiscal. Onde a substituição "
    "tributária pesa, a comparação com hoje vale como ordem de grandeza."
)


def parametros() -> str:
    cenarios = "\n\n".join(f"{c.rotulo}: CBS {pct(c.cbs)} + IBS {pct(c.ibs)}. Fonte: {c.fonte}." for c in CENARIOS)
    return (
        "As alíquotas de referência de CBS e IBS são fixadas por resolução do Senado e, em 17/11/2026, nenhuma estava fixada. "
        "Os cenários abaixo são parâmetros declarados, não a alíquota que valerá.\n\n" + cenarios + "\n\n"
        f"Transição (ADCT, arts. 125 a 129, conferidos em resumo da página oficial em 17/11/2026): em 2026 as alíquotas de teste são "
        f"compensadas com PIS e Cofins; em 2027 e 2028 a CBS é a calculada pelo TCU para 2027 ({pct(CBS_2027)}) menos "
        f"{pct(REDUCAO_CBS_2027_2028).replace('%', '')} ponto, em todos os cenários, e o IBS é de {pct(IBS_2027_2028)}; de 2029 a 2032 o "
        "cenário passa a valer, e por isso os cenários com CBS menor que a do TCU mostram queda da CBS em 2029; nesses anos o "
        "ICMS cai a 90%, 80%, 70% e 60% e o IBS sobe a 10%, 20%, 30% e 40% da referência; em 2033 o ICMS é extinto. O gráfico da "
        f"transição usa o cenário de {CENTRAL.rotulo}."
    )


def secao(filtros: list[str]) -> tuple[list[dict], dict]:
    """Os visuais e a seção. Nenhum segue os filtros da página, que são dos achados."""
    comum = {"fact": R, "skipFilters": filtros}
    base = {**comum, "where": BASE}
    apur = {"fact": "reforma_apuracao", "skipFilters": filtros}
    tran = {"fact": "reforma_transicao", "skipFilters": filtros}
    c = CENTRAL
    vis = [
        {"id": "x_rf_leitura", "type": "text", "title": "Como ler esta seção", "span": 12, "body": LEITURA},
        {"id": "k_rf_receita", "type": "kpi", "title": "Receita", "span": 3, "measure": "rf_receita",
         "detail": {"measure": "rf_ano_base", "text": "ano-base"}, **base},
        {"id": "k_rf_hoje", "type": "kpi", "title": "ICMS, PIS e Cofins a recolher hoje", "span": 3, "measure": "rf_hoje",
         "detail": {"measure": "rf_carga_hoje", "text": "da receita"}, **base},
        {"id": "k_rf_saldo", "type": "kpi", "title": f"CBS + IBS simulados a {c.rotulo}", "span": 3, "measure": f"rf_saldo_{c.id}",
         "detail": {"measure": f"rf_carga_{c.id}", "text": "da receita"}, **base},
        {"id": "k_rf_diferenca", "type": "kpi", "title": "Diferença para hoje", "span": 3, "measure": f"rf_diferenca_{c.id}",
         "detail": {"text": "simulado menos o que se recolhe hoje"}, **base},
        {"id": "t_rf_cenarios", "type": "table", "title": "Hoje e cenários por ano", "span": 12, "fields": ["rf_ano"],
         "measures": ["rf_receita", "rf_hoje", "rf_carga_hoje", *[f"rf_saldo_{x.id}" for x in CENARIOS],
                      *[f"rf_carga_{x.id}" for x in CENARIOS]], "sort": "field_desc", "limit": 30, **comum},
        {"id": "b_rf_debito_credito", "type": "bar", "title": f"Débito e crédito simulados por ano ({c.rotulo})", "span": 6, "field": "rf_ano",
         "measures": [f"rf_debito_{c.id}", f"rf_credito_{c.id}"], "sort": "field", "limit": 30, **comum},
        {"id": "b_rf_hoje", "type": "bar", "title": "ICMS, PIS e Cofins a recolher por ano", "span": 6, "field": "rfa_ano",
         "measures": ["rfa_recolher_icms", "rfa_recolher_pis", "rfa_recolher_cofins"], "sort": "field", "limit": 30, **apur},
        {"id": "t_rf_credito", "type": "table", "title": "Aquisições e crédito por natureza no ano-base", "span": 7, "fields": ["rf_natureza"],
         "measures": ["rf_valor", "rf_aquis_reforma", "rf_icms_credito"], "total": True, "limit": 30,
         **comum, "where": f"{BASE} AND reforma.operacao = 'Entrada' AND reforma.fonte = 'EFD ICMS/IPI'"},
        {"id": "t_rf_credito_hoje", "type": "table", "title": "Crédito de PIS e Cofins hoje no ano-base", "span": 5, "fields": ["rf_tratamento"],
         "measures": ["rf_aquis_hoje", "rf_pis_cofins_credito"], "total": True, "limit": 30,
         **comum, "where": f"{BASE} AND reforma.operacao = 'Entrada' AND reforma.fonte = 'EFD Contribuições'"},
        {"id": "d_rf_tratamento", "type": "donut", "title": "Vendas por tratamento do ICMS no ano-base", "span": 4, "field": "rf_tratamento",
         "measure": "rf_valor", **comum,
         "where": f"{BASE} AND reforma.operacao = 'Saída' AND reforma.fonte = 'EFD ICMS/IPI' AND reforma.natureza = 'Venda'"},
        {"id": "t_rf_destino", "type": "table", "title": "Operações por destino ou origem no ano-base", "span": 8,
         "fields": ["rf_operacao", "rf_destino", "rf_natureza"], "measures": ["rf_valor", "rf_icms"], "limit": 60,
         **comum, "where": f"{BASE} AND reforma.fonte = 'EFD ICMS/IPI'"},
        {"id": "l_rf_saldo_credor", "type": "line", "title": "Saldo credor de ICMS por competência", "span": 12, "field": "rfa_competencia",
         "measures": ["rfa_saldo_credor"], "sort": "field", "limit": 200, **apur},
        {"id": "b_rf_transicao", "type": "bar", "title": f"Tributos por ano da transição ({c.rotulo})", "span": 12, "field": "rft_ano",
         "measures": ["rft_pis_cofins", "rft_icms", "rft_cbs", "rft_ibs"], "sort": "field", "limit": 20, **tran},
        {"id": "t_rf_transicao", "type": "table", "title": "Total por ano da transição e cenário", "span": 12, "fields": ["rft_ano", "rft_etapa"],
         "measures": [f"rft_total_{x.id}" for x in CENARIOS], "sort": "field", "limit": 20, **tran},
        {"id": "x_rf_parametros", "type": "text", "title": "Parâmetros e fontes", "span": 12, "body": parametros()},
    ]
    return vis, {
        "id": "reforma_tributaria", "title": "Reforma tributária",
        "description": "Simulação do efeito da reforma do consumo (CBS e IBS no lugar de PIS, Cofins e ICMS) sobre o que a empresa já "
                       "escriturou: quanto se recolhe hoje, quanto seria em cada cenário de alíquota, o que muda no crédito, o peso da "
                       "substituição tributária e de outros tratamentos que deixam de existir, o saldo credor de ICMS e o caminho ano a ano "
                       "até 2033. Os indicadores e a transição usam o ano-base, o último ano com os doze meses. As alíquotas são parâmetros "
                       "declarados, não fatos. Esta seção não segue os filtros da página.",
        "visuals": [v["id"] for v in vis],
    }
