"""
Baixa do Portal do SPED (Sped Tabelas, sistema PIS/COFINS, pacote "Tabelas de Operações com Contribuição") as tabelas de
produtos por NCM da EFD Contribuições e grava <AUDITORIA_PASTA>/entrada/tabelas_pis.parquet, uma linha por tabela, código,
vigência e NCM (prefixo, como a tabela traz: capítulo, posição ou código completo).

  4.3.10  monofásico, alíquotas diferenciadas (CST 02 e 04)
  4.3.11  monofásico, alíquota por unidade (CST 03 e 04)
  4.3.12  substituição tributária (CST 05)
  4.3.13  alíquota zero (CST 06)
  4.3.14  isenção (CST 07)
  4.3.15  sem incidência (CST 08)
  4.3.16  suspensão (CST 09)
  4.3.17  outras alíquotas diferenciadas (CST 02)

Também grava entrada/ncm_vigente.parquet, a NCM em vigor do Portal Único Siscomex (tabelas-ncm/ncm.json).

Linhas sem NCM (a tabela descreve a operação ou remete a um anexo de lei, como autopeças) ficam com ncm vazio: servem para
o texto, não para casar item. Os .txt baixados ficam em <AUDITORIA_PASTA>/tabelas-sped/ (a primeira linha traz a versão).

Uso (em web/):
  AUDITORIA_PASTA=<pasta> uv run -q --no-project --python 3.11 --with duckdb --with requests python -I \
    scripts/fiscal/auditoria/tabelas_sped.py [--sem-baixar]
"""
from __future__ import annotations

import os
import re
import sys
from datetime import date
from pathlib import Path

import duckdb

PASTA = Path(os.environ.get("AUDITORIA_PASTA", Path.cwd())).resolve()
BRUTOS = PASTA / "tabelas-sped"
URL = "http://www.sped.fazenda.gov.br/spedtabelas/AppConsulta/publico/aspx/ConsultaTabelasExternas.aspx?CodSistema=SpedPisCofins"
PACOTE = "72"
# id no portal → (tabela, CST a que a tabela leva)
TABELAS = {
    "162": ("4.3.10", "02/04"), "164": ("4.3.11", "03/04"), "163": ("4.3.12", "05"), "166": ("4.3.13", "06"),
    "167": ("4.3.14", "07"), "168": ("4.3.15", "08"), "169": ("4.3.16", "09"), "165": ("4.3.17", "02"),
}
NOMES = {
    "4.3.10": "Monofásico", "4.3.11": "Monofásico por unidade", "4.3.12": "Substituição tributária", "4.3.13": "Alíquota zero",
    "4.3.14": "Isenção", "4.3.15": "Sem incidência", "4.3.16": "Suspensão", "4.3.17": "Alíquota diferenciada",
}


def baixar() -> None:
    """O portal é ASP.NET: escolher o pacote e a tabela são postbacks, e o botão "Baixar tabela" devolve o .txt."""
    import requests

    def ocultos(html: str) -> dict[str, str]:
        return {m.group(1): m.group(2) for m in re.finditer(r'<input type="hidden" name="([^"]+)" id="[^"]+" value="([^"]*)"', html)}

    BRUTOS.mkdir(parents=True, exist_ok=True)
    s = requests.Session()
    h = s.get(URL, timeout=60).text
    d = {**ocultos(h), "__EVENTTARGET": "ctl00$ContentPlaceHolder1$ddlPacotes", "__EVENTARGUMENT": "",
         "ctl00$ContentPlaceHolder1$ddlPacotes": PACOTE}
    h = s.post(URL, data=d, timeout=60).text
    for tid, (tabela, _) in TABELAS.items():
        base = {"ctl00$ContentPlaceHolder1$ddlPacotes": PACOTE, "ctl00$ContentPlaceHolder1$ddlTabelas": tid}
        h = s.post(URL, data={**ocultos(h), **base, "__EVENTTARGET": "ctl00$ContentPlaceHolder1$ddlTabelas", "__EVENTARGUMENT": ""},
                   timeout=60).text
        r = s.post(URL, data={**ocultos(h), **base, "ctl00$ContentPlaceHolder1$btnBaixarTabela": "Baixar tabela"}, timeout=120)
        if "attachment" not in (r.headers.get("content-disposition") or ""):
            sys.exit(f"o portal não devolveu a tabela {tabela} (resposta {r.status_code})")
        (BRUTOS / f"{tabela}.txt").write_bytes(r.content)
        print(f"  {tabela}: {len(r.content):,} bytes".replace(",", "."))


def data(ddmmaaaa: str) -> str | None:
    return f"{ddmmaaaa[4:8]}-{ddmmaaaa[2:4]}-{ddmmaaaa[0:2]}" if len(ddmmaaaa) == 8 else None


def ler() -> list[tuple]:
    linhas = []
    for tabela, cst in TABELAS.values():
        texto = (BRUTOS / f"{tabela}.txt").read_bytes().decode("latin-1")
        cabecalho, *corpo = texto.splitlines()
        versao = re.search(r"versão=(\d+)", cabecalho)
        colunas = [c.strip() for c in cabecalho.split(" ", 1)[1].split(",")]
        for ln in corpo:
            if not ln.strip():
                continue
            c = ln.split("|")
            c += [""] * (len(colunas) - len(c))
            reg = dict(zip(colunas, c))
            aliq = lambda k: float(reg[k].replace(",", ".")) if reg.get(k, "").strip() else None
            ncms = [n.strip().replace(".", "") for n in reg.get("NCM", "").split(";") if n.strip()] or [""]
            excecoes = ";".join(n.strip().replace(".", "") for n in reg.get("NCM_EX", "").split(";") if n.strip())
            for ncm in ncms:
                linhas.append((tabela, NOMES[tabela], cst, versao.group(1) if versao else None, reg["CODIGO"], reg["DESC_PROD"].strip(),
                               data(reg["DT_INI"]), data(reg.get("DT_FIM", "")), ncm, excecoes, reg.get("EX_IPI", "").strip(),
                               aliq("ALIQ_PIS") if "ALIQ_PIS" in reg else aliq("ALIQ_PIS_P"),
                               aliq("ALIQ_COFIN") if "ALIQ_COFIN" in reg else aliq("ALIQ_COF_P")))
    return linhas


URL_NCM = "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO"


def tabela_ncm(baixar_de_novo: bool) -> str:
    """A NCM vigente do Portal Único Siscomex (só códigos em vigor) → entrada/ncm_vigente.parquet, um código de 8 dígitos
    por linha, com a descrição dele e a dos níveis acima (capítulo, posição, subposição), que dão o sentido a "-- Outros"."""
    import json

    bruto = PASTA / "tabelas-ncm" / "ncm.json"
    if baixar_de_novo or not bruto.exists():
        import requests

        bruto.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(URL_NCM, timeout=180, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        bruto.write_bytes(r.content)
    dados = json.loads(bruto.read_text(encoding="utf-8"))
    desc = {n["Codigo"].replace(".", ""): re.sub(r"<[^>]+>", "", n["Descricao"]).strip() for n in dados["Nomenclaturas"]}
    inicio = {n["Codigo"].replace(".", ""): n["Data_Inicio"] for n in dados["Nomenclaturas"]}
    linhas = []
    for cod, d in desc.items():
        if len(cod) != 8:
            continue
        # A posição (4 dígitos) é longa; o caminho leva a subposição e os desdobramentos, que distinguem os "Outros".
        niveis = [desc[p] for p in (cod[:5], cod[:6], cod[:7]) if p in desc and p != cod]
        caminho = " › ".join(x.lstrip("- ").rstrip(":") for x in [*niveis, d])
        linhas.append((cod, d.lstrip("- "), caminho, desc.get(cod[:4], ""), inicio[cod]))
    con = duckdb.connect()
    con.execute("CREATE TABLE n (ncm VARCHAR, descricao VARCHAR, caminho VARCHAR, posicao VARCHAR, inicio VARCHAR)")
    con.executemany("INSERT INTO n VALUES (?, ?, ?, ?, ?)", linhas)
    destino = PASTA / "entrada" / "ncm_vigente.parquet"
    con.execute(f"COPY n TO '{destino.as_posix()}' (FORMAT parquet)")
    print(f"  NCM vigente ({dados['Data_Ultima_Atualizacao_NCM']}, {dados['Ato']}): {len(linhas):,} códigos".replace(",", "."))
    return f"NCM {dados['Data_Ultima_Atualizacao_NCM'].lower()} ({dados['Ato']}), do Portal Único Siscomex"


def main() -> None:
    if "--sem-baixar" not in sys.argv:
        baixar()
    fonte_ncm = tabela_ncm("--sem-baixar" not in sys.argv)
    linhas = ler()
    destino = PASTA / "entrada" / "tabelas_pis.parquet"
    destino.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("""CREATE TABLE t (tabela VARCHAR, tratamento VARCHAR, cst VARCHAR, versao VARCHAR, codigo VARCHAR, descricao VARCHAR,
                   dt_ini DATE, dt_fim DATE, ncm VARCHAR, ncm_excecoes VARCHAR, ex_ipi VARCHAR, aliq_pis DOUBLE, aliq_cofins DOUBLE)""")
    con.executemany("INSERT INTO t VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", linhas)
    con.execute(f"COPY t TO '{destino.as_posix()}' (FORMAT parquet)")
    versoes = []
    for tabela, versao, n, com_ncm in con.execute(
            "SELECT tabela, any_value(versao), count(*), count(*) FILTER (WHERE ncm <> '') FROM t GROUP BY 1 ORDER BY 1").fetchall():
        print(f"  {tabela} (versão {versao}): {n} linhas, {com_ncm} com NCM")
        versoes.append(f"{tabela} v{versao}")
    # O texto de fontes que o molde mostra (molde_ncm.py lê este arquivo).
    baixado = date.fromtimestamp((BRUTOS / "4.3.10.txt").stat().st_mtime).strftime("%d/%m/%Y")
    fontes = (f"tabelas do SPED da EFD Contribuições ({', '.join(versoes)}), baixadas do Portal do Sped Tabelas em {baixado}; "
              f"{fonte_ncm}.")
    (PASTA / "entrada" / "tabelas_fontes.txt").write_text(fontes, encoding="utf-8")
    print(f"  {fontes}")


if __name__ == "__main__":
    main()
