"""
Extrai, dos arquivos originais da EFD ICMS/IPI de uma pasta local, o que a seção "Cadastro e NCM" precisa:

  icms_0200.parquet   o cadastro de itens (0200) de cada estabelecimento, sem repetir: cada versão diferente de um item
                      (descrição, código de barras, unidade, tipo, NCM, CEST) com o primeiro e o último mês em que aparece
  icms_c170.parquet   os itens das notas de entrada com chave (C170 sob C100 com IND_OPER 0): chave, número e código do item,
                      CFOP, CST e valor, com o arquivo e a linha

Lê linha a linha e guarda só esses registros. Quando o mesmo estabelecimento tem mais de um arquivo no mesmo mês, vale o
gravado por último (como em intragrupo_extrair.py).

Uso (em web/):
  AUDITORIA_PASTA=<pasta> uv run -q --no-project --python 3.11 --with duckdb python -I \
    scripts/fiscal/auditoria/ncm_extrair.py --origem <pasta com <cnpj>/original/efd_icms_ipi/*.txt> [--desde AAAA-MM] [--ate AAAA-MM]
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import duckdb

PASTA = Path(os.environ.get("AUDITORIA_PASTA", Path.cwd())).resolve()
SAIDA = PASTA / "entrada"
PROCESSOS = 4
JANELA = 2 * PROCESSOS

CADASTRO = ["cod_item", "descr_item", "cod_barra", "unid_inv", "tipo_item", "cod_ncm", "ex_ipi", "cest"]
ITEM = ["chave", "num_item", "cod_item", "qtd", "unid", "vl_item", "cst_icms", "cfop"]


def campos(linha: str, n: int) -> list[str]:
    c = linha.rstrip("\r\n").split("|")
    return c + [""] * (n - len(c))


def ler_arquivo(caminho: str) -> dict:
    """Lê um .txt da EFD ICMS/IPI e devolve o 0000, os 0200 e os C170 das entradas com chave."""
    abertura: list[str] = []
    cadastro: list[tuple] = []
    itens: list[tuple] = []
    chave = ""  # chave da nota de entrada em curso ("" quando a nota atual não é entrada com chave)
    with open(caminho, "r", encoding="latin-1", newline="") as f:
        for n, linha in enumerate(f, start=1):
            if linha.startswith("|C170|"):
                if chave:
                    c = campos(linha, 12)
                    # |C170|NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|
                    itens.append((n, chave, c[2], c[3], c[5], c[6], c[7], c[10], c[11]))
            elif linha.startswith("|C100|"):
                c = campos(linha, 10)
                chave = c[9] if c[2] == "0" and len(c[9]) == 44 else ""
            elif linha.startswith("|0200|"):
                c = campos(linha, 14)
                # |0200|COD_ITEM|DESCR_ITEM|COD_BARRA|COD_ANT_ITEM|UNID_INV|TIPO_ITEM|COD_NCM|EX_IPI|COD_GEN|COD_LST|ALIQ_ICMS|CEST|
                cadastro.append((c[2], c[3], c[4], c[6], c[7], c[8], c[9], c[13]))
            elif linha.startswith("|0000|"):
                abertura = linha.rstrip("\r\n").split("|")
            elif linha.startswith("|D001|") or linha.startswith("|E001|"):
                chave = ""
    return {"caminho": caminho, "abertura": abertura, "cadastro": cadastro, "itens": itens}


def competencia(dt_ini: str) -> str:
    return f"{dt_ini[4:8]}-{dt_ini[2:4]}" if len(dt_ini) == 8 else ""


def em_janela(ex: ProcessPoolExecutor, caminhos: list[str]):
    pendentes: deque = deque()
    for c in caminhos:
        pendentes.append(ex.submit(ler_arquivo, c))
        if len(pendentes) >= JANELA:
            yield pendentes.popleft().result()
    while pendentes:
        yield pendentes.popleft().result()


def que_valem(arquivos: list[Path]) -> list[Path]:
    """Um arquivo por estabelecimento e mês (pelo nome): o gravado por último."""
    escolhido: dict[tuple[str, str], Path] = {}
    for p in arquivos:
        partes = p.name.split("-")
        chave = (partes[0], partes[2][:6] if len(partes) > 2 else p.name)
        atual = escolhido.get(chave)
        if atual is None or (os.path.getmtime(p), p.name) > (os.path.getmtime(atual), atual.name):
            escolhido[chave] = p
    return sorted(escolhido.values())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--origem", required=True)
    ap.add_argument("--desde", default="")
    ap.add_argument("--ate", default="9999-99")
    a = ap.parse_args()

    def mes_do_nome(p: Path) -> str:
        partes = p.name.split("-")
        return f"{partes[2][:4]}-{partes[2][4:6]}" if len(partes) > 3 and len(partes[2]) == 8 else ""

    arquivos = que_valem([p for p in Path(a.origem).glob("*/original/efd_icms_ipi/*.txt") if a.desde <= mes_do_nome(p) <= a.ate])
    print(f"{len(arquivos)} arquivos a ler", flush=True)
    SAIDA.mkdir(parents=True, exist_ok=True)
    tmp_itens = SAIDA / "_c170.tsv"
    # O cadastro se repete mês a mês: agrega aqui, por estabelecimento e versão do item.
    versoes: dict[tuple, list] = {}
    with open(tmp_itens, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["arquivo", "estabelecimento", "competencia", "linha", *ITEM])
        with ProcessPoolExecutor(max_workers=PROCESSOS) as ex:
            for i, r in enumerate(em_janela(ex, [str(p) for p in arquivos]), start=1):
                ab = r["abertura"]
                if len(ab) < 8:
                    print(f"  sem 0000: {r['caminho']}", file=sys.stderr)
                    continue
                nome, estab, comp = Path(r["caminho"]).name, ab[7], competencia(ab[4])
                for item in r["itens"]:
                    w.writerow([nome, estab, comp, *item])
                for cad in r["cadastro"]:
                    k = (estab, *cad)
                    v = versoes.get(k)
                    if v is None:
                        versoes[k] = [comp, comp, 1, nome]
                    else:
                        v[0], v[1], v[2] = min(v[0], comp), max(v[1], comp), v[2] + 1
                        if comp == v[1]:
                            v[3] = nome
                if i % 500 == 0:
                    print(f"  {i}/{len(arquivos)}, {len(versoes):,} versões de itens".replace(",", "."), flush=True)

    tmp_cad = SAIDA / "_0200.tsv"
    with open(tmp_cad, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["estabelecimento", *CADASTRO, "primeiro_mes", "ultimo_mes", "arquivos", "ultimo_arquivo"])
        for k, v in versoes.items():
            w.writerow([*k, *v])

    con = duckdb.connect()
    con.execute(f"SET memory_limit = '4GB'; SET threads = 4; SET preserve_insertion_order = false; "
                f"SET temp_directory = '{(PASTA / '_duckdb_tmp').as_posix()}'")
    leia = lambda p: f"read_csv('{p.as_posix()}', delim = '\t', header = true, all_varchar = true, quote = '\"')"
    con.execute(f"""COPY (SELECT * REPLACE (CAST(arquivos AS INTEGER) AS arquivos) FROM {leia(tmp_cad)})
                    TO '{(SAIDA / 'icms_0200.parquet').as_posix()}' (FORMAT parquet)""")
    con.execute(f"""COPY (SELECT * REPLACE (CAST(linha AS BIGINT) AS linha) FROM {leia(tmp_itens)})
                    TO '{(SAIDA / 'icms_c170.parquet').as_posix()}' (FORMAT parquet)""")
    tmp_cad.unlink()
    tmp_itens.unlink()
    for k in ("0200", "c170"):
        n = con.execute(f"SELECT count(*) FROM '{(SAIDA / f'icms_{k}.parquet').as_posix()}'").fetchone()[0]
        print(f"icms_{k}.parquet: {n:,} linhas".replace(",", "."))


if __name__ == "__main__":
    main()
