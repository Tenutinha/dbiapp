"""
Extrai, dos arquivos originais da EFD Contribuições de uma pasta local, o que a matriz de PIS/COFINS por NCM precisa:

  contrib_0200.parquet   o cadastro de itens (0200 sob cada 0140) por estabelecimento, sem repetir, com o primeiro e o último
                         mês em que cada versão aparece
  contrib_itens.parquet  os itens das notas (C170 sob C100) somados por mês, estabelecimento, operação, item, CFOP, CST e
                         alíquota de PIS e COFINS: quantidade de itens, valor, desconto, base e valor de PIS e COFINS, e um
                         exemplo (arquivo e linha) para conferir no original

Soma ao ler: o arquivo inteiro tem dezenas de milhões de itens, a soma fica em centenas de milhares de linhas.
Com mais de um arquivo no mesmo mês, vale o de nome maior (o nome traz a data e hora da gravação).

Uso (em web/):
  AUDITORIA_PASTA=<pasta> uv run -q --no-project --python 3.11 --with duckdb python -I \
    scripts/fiscal/auditoria/ncm_contrib_extrair.py --origem <pasta com <cnpj>/original/efd_contribuicoes/*.txt>
"""
from __future__ import annotations

import argparse
import csv
import os
import re
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import duckdb

PASTA = Path(os.environ.get("AUDITORIA_PASTA", Path.cwd())).resolve()
SAIDA = PASTA / "entrada"
PROCESSOS = 3


def num(v: str) -> float:
    return float(v.replace(",", ".")) if v else 0.0


def campos(linha: str, n: int) -> list[str]:
    c = linha.rstrip("\r\n").split("|")
    return c + [""] * (n - len(c))


def ler_arquivo(caminho: str) -> dict:
    """Um arquivo: o mês, o cadastro por estabelecimento e os itens somados."""
    comp = ""
    estab_0140 = ""
    estab_c010 = ""
    oper = ""
    cadastro: set[tuple] = set()
    somas: dict[tuple, list] = {}
    nome = Path(caminho).name
    with open(caminho, "r", encoding="latin-1", newline="") as f:
        for n, linha in enumerate(f, start=1):
            if linha.startswith("|C170|"):
                c = campos(linha, 37)
                # |C170|NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|…|CST_PIS(25)|VL_BC_PIS|
                # ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS(30)|CST_COFINS(31)|VL_BC_COFINS|ALIQ_COFINS|…|VL_COFINS(36)|
                k = (estab_c010, oper, c[3], c[11], c[25], c[27], c[31], c[33])
                s = somas.get(k)
                if s is None:
                    somas[k] = s = [0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, nome, n]
                s[0] += 1
                s[1] += num(c[7])
                s[2] += num(c[8])
                s[3] += num(c[26])
                s[4] += num(c[30])
                s[5] += num(c[32])
                s[6] += num(c[36])
            elif linha.startswith("|C100|"):
                oper = linha.split("|", 3)[2]
            elif linha.startswith("|C010|"):
                estab_c010 = campos(linha, 3)[2]
            elif linha.startswith("|0200|"):
                c = campos(linha, 13)
                # |0200|COD_ITEM|DESCR_ITEM|COD_BARRA|COD_ANT_ITEM|UNID_INV|TIPO_ITEM|COD_NCM|EX_IPI|COD_GEN|COD_LST|ALIQ_ICMS|
                cadastro.add((estab_0140, c[2], c[3], c[4], c[7], c[8], c[9]))
            elif linha.startswith("|0140|"):
                estab_0140 = campos(linha, 5)[4]
            elif linha.startswith("|0000|"):
                c = campos(linha, 7)
                comp = f"{c[6][4:8]}-{c[6][2:4]}" if len(c[6]) == 8 else ""
    return {"nome": nome, "comp": comp, "cadastro": cadastro, "somas": somas}


def em_janela(ex: ProcessPoolExecutor, caminhos: list[str]):
    pendentes: deque = deque()
    for c in caminhos:
        pendentes.append(ex.submit(ler_arquivo, c))
        if len(pendentes) >= PROCESSOS + 1:
            yield pendentes.popleft().result()
    while pendentes:
        yield pendentes.popleft().result()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--origem", required=True)
    a = ap.parse_args()
    # PISCOFINS_<ini>_<fim>_<cnpj>_<Original|Retificadora>_<gravação>_<hash>.txt: um por CNPJ e período, o gravado por último.
    por_periodo: dict[tuple[str, str], Path] = {}
    for p in Path(a.origem).glob("*/original/efd_contribuicoes/*.txt"):
        m = re.match(r"PISCOFINS_(\d{8})_\d{8}_(\d{14})_\w+?_(\d{14})_", p.name)
        k = (m.group(2), m.group(1)) if m else (p.parent.parent.parent.name, p.name)
        atual = por_periodo.get(k)
        if atual is None or (m and m.group(3) > re.match(r"PISCOFINS_\d{8}_\d{8}_\d{14}_\w+?_(\d{14})_", atual.name).group(1)):
            por_periodo[k] = p
    arquivos = sorted(por_periodo.values())
    print(f"{len(arquivos)} arquivos a ler", flush=True)
    SAIDA.mkdir(parents=True, exist_ok=True)
    t_itens, t_cad = SAIDA / "_contrib_itens.tsv", SAIDA / "_contrib_0200.tsv"
    versoes: dict[tuple, list] = {}
    with open(t_itens, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["competencia", "estabelecimento", "ind_oper", "cod_item", "cfop", "cst_pis", "aliq_pis", "cst_cofins", "aliq_cofins",
                    "itens", "vl_item", "vl_desc", "vl_bc_pis", "vl_pis", "vl_bc_cofins", "vl_cofins", "arquivo", "linha"])
        with ProcessPoolExecutor(max_workers=PROCESSOS) as ex:
            # Janela limitada: ex.map guardaria os resultados de todos os arquivos que terminam antes de serem gravados.
            for i, r in enumerate(em_janela(ex, [str(p) for p in arquivos]), start=1):
                for k, s in r["somas"].items():
                    w.writerow([r["comp"], *k, s[0], *(round(x, 2) for x in s[1:7]), s[7], s[8]])
                for cad in r["cadastro"]:
                    v = versoes.get(cad)
                    if v is None:
                        versoes[cad] = [r["comp"], r["comp"]]
                    else:
                        v[0], v[1] = min(v[0], r["comp"]), max(v[1], r["comp"])
                print(f"  {i}/{len(arquivos)} {r['comp']}: {len(r['somas']):,} somas".replace(",", "."), flush=True)
    with open(t_cad, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["estabelecimento", "cod_item", "descr_item", "cod_barra", "tipo_item", "cod_ncm", "ex_ipi", "primeiro_mes", "ultimo_mes"])
        for k, v in versoes.items():
            w.writerow([*k, *v])

    con = duckdb.connect()
    con.execute(f"SET memory_limit = '4GB'; SET threads = 4; SET preserve_insertion_order = false; "
                f"SET temp_directory = '{(PASTA / '_duckdb_tmp').as_posix()}'")
    leia = lambda p: f"read_csv('{p.as_posix()}', delim = '\t', header = true, all_varchar = true, quote = '\"')"
    con.execute(f"COPY (SELECT * FROM {leia(t_cad)}) TO '{(SAIDA / 'contrib_0200.parquet').as_posix()}' (FORMAT parquet)")
    dec = ", ".join(f"CAST({c} AS DECIMAL(18, 2)) AS {c}" for c in ("vl_item", "vl_desc", "vl_bc_pis", "vl_pis", "vl_bc_cofins", "vl_cofins"))
    con.execute(f"""COPY (SELECT * REPLACE (CAST(itens AS BIGINT) AS itens, CAST(linha AS BIGINT) AS linha, {dec}) FROM {leia(t_itens)})
                    TO '{(SAIDA / 'contrib_itens.parquet').as_posix()}' (FORMAT parquet)""")
    t_cad.unlink()
    t_itens.unlink()
    for k in ("contrib_0200", "contrib_itens"):
        n = con.execute(f"SELECT count(*) FROM '{(SAIDA / f'{k}.parquet').as_posix()}'").fetchone()[0]
        print(f"{k}.parquet: {n:,} linhas".replace(",", "."))


if __name__ == "__main__":
    main()
