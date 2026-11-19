"""
A seção "Cadastro e NCM" do molde "Auditoria fiscal": tabelas, campos, medidas e visuais sobre o que ncm.py grava.
Documentação: docs/auditoria-fiscal.md.
"""
from ncm import ANOS_PRAZO, NCM_GENERICO, SITUACOES

F, M, C = "ncm_fornecedor", "ncm_matriz", "ncm_cadastro"
DIVERGE = f"{F}.grupo = 'Revenda' AND {F}.situacao <> 'Igual ao fornecedor'"
NO_PRAZO = f"{M}.no_prazo = 'Sim'"


def col(name: str, type_: str = "text", required: bool = False, description: str | None = None) -> dict:
    c = {"name": name, "type": type_, "required": required}
    if description:
        c["description"] = description
    return c


def dec(name: str, description: str | None = None) -> dict:
    return col(name, "decimal", False, description)


def num(name: str, description: str | None = None) -> dict:
    return col(name, "integer", False, description)


TABELAS = [
    {
        "name": F, "kind": "fact", "sortBy": "grupo, valor",
        "description": "NCM do cadastro × NCM do fornecedor: uma linha por item do cadastro, grupo de entrada, NCM do 0200 e NCM do XML "
                       "de compra. Cada item do XML é casado com o C170 de entrada pela chave e pelo número do item.",
        "columns": [
            col("cod_item", required=True), col("descricao"), col("grupo", required=True, description="Revenda, uso e consumo, ativo, remessa e retorno ou outras, pelo CFOP de entrada."),
            col("ncm_cadastro"), col("ncm_fornecedor"),
            col("situacao", required=True, description="Igual ao fornecedor, outro subitem da mesma posição (4 dígitos iguais) ou outra posição."),
            col("generico", "boolean", description=f"Código que recebe produtos de mais de {NCM_GENERICO} NCM diferentes."),
            num("itens"), num("notas"), dec("valor", "Valor dos itens nos XML."), num("fornecedores"), num("estabelecimentos"),
            col("primeiro_mes"), col("ultimo_mes"), col("exemplo_descricao_fornecedor"), col("exemplo_chave"), num("exemplo_item"),
            col("exemplo_arquivo", description="EFD ICMS/IPI com o C170 do exemplo."), num("exemplo_linha"),
            col("ncm_cadastro_descricao"), col("ncm_fornecedor_descricao"), col("ncm_fornecedor_caminho"),
            col("ncm_cadastro_vigente", description="Sim quando o NCM do cadastro existe na NCM vigente."),
        ],
    },
    {
        "name": M, "kind": "fact", "sortBy": "ano, situacao_cod",
        "description": "Matriz de PIS/COFINS das vendas (C170 de saída da EFD Contribuições) contra as tabelas 4.3.10 a 4.3.17 do SPED: "
                       "uma linha por mês, item, CST e alíquota quando não bate com a tabela; o que bate vem somado por ano, situação e tabela.",
        "columns": [
            col("competencia"), col("ano", required=True), col("situacao_cod", required=True), col("situacao", required=True),
            col("no_prazo", required=True, description=f"Sim quando a competência está nos últimos {ANOS_PRAZO} anos (prazo de recuperação e de cobrança)."),
            col("cod_item"), col("descricao"), col("ncm"), col("ncm_descricao"), col("cst_pis"), col("aliq_pis"), col("cst_cofins"),
            col("tabela", description="Tabela do SPED em que o NCM está (vazia: em nenhuma das que trazem NCM)."), col("tratamento"),
            col("codigo", description="Código da linha da tabela."), col("regra", description="Descrição da linha da tabela."),
            num("itens"), dec("valor", "Valor dos itens menos o desconto."), dec("pis"), dec("cofins"),
            col("exemplo_arquivo", description="EFD Contribuições com a linha de maior valor."), num("exemplo_linha"),
            num("linhas", "Quantas combinações de mês, item, CST e alíquota a linha soma (1 no detalhe)."),
        ],
    },
    {
        "name": C, "kind": "fact", "sortBy": "vendido_12m",
        "description": "Cadastro de itens (0200 das duas EFD, de todos os estabelecimentos): uma linha por código, com o NCM do último mês "
                       "em que aparece e os problemas do cadastro.",
        "columns": [
            col("cod_item", required=True), col("descricao"), col("tipo_item", description="00 = mercadoria para revenda (TIPO_ITEM do 0200)."),
            col("ncm"), col("ncm_descricao"), col("ncm_caminho"),
            col("ncm_situacao", required=True, description="Vigente, Fora da NCM vigente (código extinto ou inexistente) ou Sem NCM."),
            num("ncms_no_mes", "NCM diferentes do item no último mês, entre estabelecimentos e entre as duas EFD."),
            col("lista_ncm"), num("ncms_na_historia", "NCM diferentes do item em todos os meses (reclassificações)."), col("fontes"),
            num("estabelecimentos"), col("cod_barra"), num("ncms_barra", "NCM diferentes com que o mesmo código de barras aparece no cadastro."),
            col("ultimo_mes"), dec("vendido_12m", "Vendas nos últimos 12 meses (EFD Contribuições)."),
            col("generico", "boolean"), col("diverge_fornecedor", "boolean", description="Na revenda, NCM diferente do fornecedor."),
        ],
    },
]

CAMPOS = [
    {"id": "nf_grupo", "label": "Grupo de entrada", "sql": f"{F}.grupo"},
    {"id": "nf_situacao", "label": "NCM × fornecedor", "sql": f"{F}.situacao"},
    {"id": "nf_par", "label": "Cadastro → fornecedor", "sql": f"concat({F}.ncm_cadastro, ' para ', {F}.ncm_fornecedor)"},
    {"id": "nm_ano", "label": "Ano", "sql": f"{M}.ano"},
    {"id": "nm_situacao", "label": "Situação", "sql": f"{M}.situacao"},
    {"id": "nm_prazo", "label": "No prazo de 5 anos", "sql": f"{M}.no_prazo"},
    {"id": "nm_tabela", "label": "Tabela do SPED", "sql": f"CASE WHEN {M}.tabela IS NULL THEN 'Fora das tabelas' ELSE concat({M}.tabela, ' ', {M}.tratamento) END"},
    {"id": "nm_cst", "label": "CST PIS", "sql": f"{M}.cst_pis"},
    {"id": "nc_situacao", "label": "Situação do NCM", "sql": f"{C}.ncm_situacao"},
    {"id": "nc_tipo", "label": "Tipo do item", "sql": f"CASE {C}.tipo_item WHEN '00' THEN 'Revenda' WHEN '07' THEN 'Uso e consumo' "
                                                       f"WHEN '08' THEN 'Ativo' WHEN '09' THEN 'Serviço' ELSE coalesce({C}.tipo_item, '') END"},
]

MEDIDAS = [
    {"id": "nf_itens", "label": "Itens de compra", "sql": f"SUM({F}.itens)", "format": "integer"},
    {"id": "nf_valor", "label": "Valor", "sql": f"SUM({F}.valor)", "format": "currency"},
    {"id": "nf_produtos", "label": "Produtos", "sql": f"COUNT(DISTINCT {F}.cod_item)", "format": "integer"},
    {"id": "nf_produtos_div", "label": "Produtos de revenda com NCM diferente", "format": "integer",
     "sql": f"COUNT(DISTINCT CASE WHEN {DIVERGE} THEN {F}.cod_item END)"},
    {"id": "nf_valor_div", "label": "Compras com NCM diferente", "format": "currency", "sql": f"SUM(CASE WHEN {DIVERGE} THEN {F}.valor END)"},
    {"id": "nm_vendas", "label": "Vendas", "sql": f"SUM({M}.valor)", "format": "currency"},
    {"id": "nm_pis_cofins", "label": "PIS + COFINS", "sql": f"SUM({M}.pis + {M}.cofins)", "format": "currency"},
    {"id": "nm_produtos", "label": "Produtos", "sql": f"COUNT(DISTINCT {M}.cod_item)", "format": "integer"},
    {"id": "nm_m1_pc", "label": "PIS + COFINS possivelmente a maior", "format": "currency",
     "sql": f"coalesce(SUM(CASE WHEN {M}.situacao_cod = 'M1' AND {NO_PRAZO} THEN {M}.pis + {M}.cofins END), 0)"},
    {"id": "nm_m2_vendas", "label": "Vendas sem débito fora das tabelas", "format": "currency",
     "sql": f"coalesce(SUM(CASE WHEN {M}.situacao_cod = 'M2' AND {NO_PRAZO} THEN {M}.valor END), 0)"},
    {"id": "nc_itens", "label": "Itens", "sql": "COUNT(*)", "format": "integer"},
    {"id": "nc_vendido", "label": "Vendido em 12 meses", "sql": f"SUM({C}.vendido_12m)", "format": "currency"},
    {"id": "nc_ncm_invalido", "label": "Itens de revenda sem NCM vigente", "format": "integer",
     "sql": f"COUNT(CASE WHEN {C}.ncm_situacao <> 'Vigente' AND {C}.tipo_item = '00' THEN 1 END)"},
    {"id": "nc_barra", "label": "Com código de barras em vários NCM", "format": "integer", "sql": f"COUNT(CASE WHEN {C}.ncms_barra > 1 THEN 1 END)"},
    {"id": "nc_mes", "label": "Com NCM diferente no mesmo mês", "format": "integer", "sql": f"COUNT(CASE WHEN {C}.ncms_no_mes > 1 THEN 1 END)"},
    {"id": "nc_generico", "label": "Códigos genéricos", "format": "integer", "sql": f"COUNT(CASE WHEN {C}.generico THEN 1 END)"},
]

COL_FORNECEDOR = [
    {"label": "Item", "sql": f"{F}.cod_item"}, {"label": "Descrição no cadastro", "sql": f"{F}.descricao", "wrap": True},
    {"label": "NCM do cadastro", "sql": f"{F}.ncm_cadastro"}, {"label": "O que é (cadastro)", "sql": f"{F}.ncm_cadastro_descricao", "wrap": True},
    {"label": "NCM do fornecedor", "sql": f"{F}.ncm_fornecedor"}, {"label": "O que é (fornecedor)", "sql": f"{F}.ncm_fornecedor_caminho", "wrap": True},
    {"label": "Situação", "sql": f"{F}.situacao"}, {"label": "Fornecedores", "sql": f"{F}.fornecedores"}, {"label": "Itens", "sql": f"{F}.itens"},
    {"label": "Valor", "sql": f"{F}.valor"}, {"label": "De", "sql": f"{F}.primeiro_mes"}, {"label": "Até", "sql": f"{F}.ultimo_mes"},
    {"label": "Descrição no XML", "sql": f"{F}.exemplo_descricao_fornecedor", "wrap": True}, {"label": "Chave (exemplo)", "sql": f"{F}.exemplo_chave"},
    {"label": "Item da nota", "sql": f"{F}.exemplo_item"}, {"label": "Arquivo", "sql": f"{F}.exemplo_arquivo"}, {"label": "Linha", "sql": f"{F}.exemplo_linha"},
]
COL_MATRIZ = [
    {"label": "Competência", "sql": f"{M}.competencia"}, {"label": "Situação", "sql": f"{M}.situacao"}, {"label": "No prazo", "sql": f"{M}.no_prazo"},
    {"label": "Item", "sql": f"{M}.cod_item"}, {"label": "Descrição", "sql": f"{M}.descricao", "wrap": True}, {"label": "NCM", "sql": f"{M}.ncm"},
    {"label": "CST PIS", "sql": f"{M}.cst_pis"}, {"label": "Alíquota PIS", "sql": f"{M}.aliq_pis"},
    {"label": "Tabela", "sql": f"concat({M}.tabela, ' ', {M}.codigo)"}, {"label": "Regra da tabela", "sql": f"{M}.regra", "wrap": True},
    {"label": "Vendas", "sql": f"{M}.valor"}, {"label": "PIS", "sql": f"{M}.pis"}, {"label": "COFINS", "sql": f"{M}.cofins"},
    {"label": "Arquivo", "sql": f"{M}.exemplo_arquivo"}, {"label": "Linha", "sql": f"{M}.exemplo_linha"},
]
COL_CADASTRO = [
    {"label": "Item", "sql": f"{C}.cod_item"}, {"label": "Descrição", "sql": f"{C}.descricao", "wrap": True}, {"label": "Tipo", "sql": f"{C}.tipo_item"},
    {"label": "NCM", "sql": f"{C}.ncm"}, {"label": "Situação do NCM", "sql": f"{C}.ncm_situacao"},
    {"label": "NCM no último mês", "sql": f"{C}.lista_ncm"}, {"label": "NCM na história", "sql": f"{C}.ncms_na_historia"},
    {"label": "Código de barras", "sql": f"{C}.cod_barra"}, {"label": "NCM do código de barras", "sql": f"{C}.ncms_barra"},
    {"label": "Genérico", "sql": f"CASE WHEN {C}.generico THEN 'Sim' ELSE '' END"},
    {"label": "Difere do fornecedor", "sql": f"CASE WHEN {C}.diverge_fornecedor THEN 'Sim' ELSE '' END"},
    {"label": "Último mês", "sql": f"{C}.ultimo_mes"}, {"label": "Vendido em 12 meses", "sql": f"{C}.vendido_12m"},
]
PROBLEMA_CADASTRO = (f"(({C}.ncm_situacao <> 'Vigente' AND {C}.tipo_item = '00') OR {C}.ncms_no_mes > 1 OR {C}.ncms_barra > 1 "
                     f"OR {C}.generico)")


def leitura(fontes: str) -> str:
    situacoes = "\n\n".join(f"{s[1]}. {s[2]}" for s in SITUACOES if s[2])
    return (
        "O NCM decide o tratamento do produto: monofásico, alíquota zero e substituição no PIS/COFINS, substituição tributária e "
        "alíquota do ICMS e, a partir de 2027, as reduções de CBS e IBS. Esta seção confere o NCM do cadastro (0200) de três jeitos.\n\n"
        "NCM × fornecedor: cada item comprado (XML do fornecedor) é ligado ao item do cadastro pelo C170 de entrada (chave e número do "
        "item). Quem fabrica classifica o produto: NCM diferente do fornecedor é o melhor indício de cadastro errado, mas o fornecedor "
        "também erra. \"Outro subitem da mesma posição\" costuma ser detalhe (material, capacidade, tensão) que muda o tratamento em "
        "poucos casos; \"Outra posição\" é produto classificado como outra coisa. Códigos genéricos (\"peças para assistência\", "
        "\"material de uso e consumo\") recebem qualquer produto e por isso divergem sempre.\n\n"
        "Matriz de PIS/COFINS: o CST de cada venda contra a tabela do SPED em que o NCM está. " + situacoes + "\n\n"
        f"No prazo: competência dos últimos {ANOS_PRAZO} anos. Antes disso, nem a empresa recupera nem o Fisco cobra (salvo processo em "
        "curso). As tabelas descrevem várias regras sem NCM (autopeças da Lei 10.485, programas com condição de preço ou de destino): "
        "essas não entram na matriz e aparecem como \"fora das tabelas\".\n\n"
        "Cadastro: NCM que não existe na NCM vigente (código extinto ou errado), item com NCM diferente entre estabelecimentos ou entre "
        "as duas EFD no mesmo mês, código de barras que aparece com mais de um NCM e códigos genéricos.\n\n"
        "Nada aqui é mudança automática de NCM: a classificação segue as regras da TIPI e a decisão final é do tributarista. "
        "Mudar o NCM para pagar menos, sem que o produto seja aquilo, é risco de autuação.\n\n"
        f"Fontes: {fontes}"
    )


def secao(filtros: list[str], fontes: str) -> tuple[list[dict], dict]:
    """Os visuais e a seção. Nenhum segue os filtros da página (são dos achados)."""
    f = {"fact": F, "skipFilters": filtros}
    m = {"fact": M, "skipFilters": filtros}
    c = {"fact": C, "skipFilters": filtros}
    vis = [
        {"id": "k_ncm_fornecedor", "type": "kpi", "title": "Produtos de revenda com NCM diferente do fornecedor", "span": 3,
         "measure": "nf_produtos_div", "detail": {"measure": "nf_valor_div", "text": "comprados"}, **f},
        {"id": "k_ncm_m1", "type": "kpi", "title": "PIS/COFINS possivelmente a maior (5 anos)", "span": 3, "measure": "nm_m1_pc",
         "detail": {"text": "tributado com tabela de não tributar"}, **m},
        {"id": "k_ncm_m2", "type": "kpi", "title": "Vendas sem débito fora das tabelas (5 anos)", "span": 3, "measure": "nm_m2_vendas",
         "detail": {"text": "a conferir"}, **m},
        {"id": "k_ncm_cadastro", "type": "kpi", "title": "Itens de revenda sem NCM vigente", "span": 3, "measure": "nc_ncm_invalido",
         "detail": {"text": "extinto, inexistente ou vazio"}, **c},
        {"id": "t_ncm_forn_situacao", "type": "table", "title": "NCM do cadastro × fornecedor, por grupo de entrada", "span": 6,
         "fields": ["nf_grupo", "nf_situacao"], "measures": ["nf_itens", "nf_produtos", "nf_valor"], "total": True, "limit": 30, **f},
        {"id": "t_ncm_forn_par", "type": "table", "title": "Revenda: trocas de NCM mais frequentes", "span": 6, "fields": ["nf_par"],
         "measures": ["nf_produtos", "nf_itens", "nf_valor"], "orderBy": "nf_valor", "total": True, "limit": 500, **f, "where": DIVERGE},
        {"id": "r_ncm_fornecedor", "type": "rows", "title": "Revenda: produtos com NCM diferente do fornecedor (clique numa troca para filtrar)",
         "span": 12, "columns": COL_FORNECEDOR, "orderBy": f"{F}.valor DESC, {F}.cod_item", "limit": 1000, **f, "where": DIVERGE},
        {"id": "t_ncm_matriz", "type": "table", "title": "Matriz de PIS/COFINS das vendas", "span": 7,
         "fields": ["nm_situacao", "nm_prazo", "nm_tabela"], "measures": ["nm_produtos", "nm_vendas", "nm_pis_cofins"], "total": True, "limit": 50, **m},
        {"id": "b_ncm_matriz_ano", "type": "bar", "title": "Vendas que não batem com as tabelas, por ano", "span": 5, "field": "nm_ano",
         "measures": ["nm_vendas"], "sort": "field", "limit": 20, **m, "where": f"{M}.situacao_cod IN ('M1', 'M2')"},
        {"id": "r_ncm_matriz", "type": "rows", "title": "Vendas que não batem com as tabelas, mês a mês", "span": 12, "columns": COL_MATRIZ,
         "orderBy": f"{M}.competencia DESC, {M}.valor DESC, {M}.cod_item", "limit": 1000, **m, "where": f"{M}.situacao_cod IN ('M1', 'M2')"},
        {"id": "t_ncm_cadastro", "type": "table", "title": "Cadastro de itens por situação do NCM", "span": 5, "fields": ["nc_tipo", "nc_situacao"],
         "measures": ["nc_itens", "nc_vendido"], "total": True, "limit": 50, **c},
        {"id": "t_ncm_cadastro_prob", "type": "table", "title": "Problemas do cadastro", "span": 7, "fields": ["nc_tipo"],
         "measures": ["nc_ncm_invalido", "nc_mes", "nc_barra", "nc_generico"], "total": True, "limit": 20, **c},
        {"id": "r_ncm_cadastro", "type": "rows", "title": "Itens com problema no cadastro (os mais vendidos primeiro)", "span": 12,
         "columns": COL_CADASTRO, "orderBy": f"{C}.vendido_12m DESC, {C}.ultimo_mes DESC, {C}.cod_item", "limit": 1000, **c, "where": PROBLEMA_CADASTRO},
        {"id": "x_ncm_leitura", "type": "text", "title": "Como ler esta seção", "span": 12, "body": leitura(fontes)},
    ]
    return vis, {
        "id": "cadastro_ncm", "title": "Cadastro e NCM",
        "description": "O NCM de cada item do cadastro conferido contra o NCM que o fornecedor usa, contra as tabelas de PIS/COFINS do SPED "
                       "(monofásico, alíquota zero, substituição) e contra a NCM vigente. Mostra onde a classificação pode estar errada "
                       "e o que isso muda no tributo, para o tributarista decidir. Esta seção não segue os filtros da página.",
        "visuals": [v["id"] for v in vis],
    }
