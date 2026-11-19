"""
Extrai, dos arquivos originais da EFD ICMS/IPI de uma pasta local, o que o fechamento das notas entre estabelecimentos do
grupo precisa: o 0000 (estabelecimento, mês, finalidade), o 0150 (participante e CNPJ) e o C100 (as notas, com os CFOP dos C190 de cada uma) de cada arquivo.

Lê linha a linha e guarda só esses três registros, então não pesa na memória. Quando o mesmo estabelecimento tem mais de um
arquivo no mesmo mês (retificadora ao lado da original), vale o gravado por último (data de modificação), como no envio ao
bucket.

Saída, em <AUDITORIA_PASTA>/entrada/:
  icms_arquivos.parquet   um por arquivo lido (estabelecimento, mês, finalidade, nome, se é o que vale)
  icms_0150.parquet       participantes de cada arquivo (cod_part → CNPJ)
  icms_c100.parquet       notas de cada arquivo, com a linha

Uso (em web/):
  AUDITORIA_PASTA=<pasta de trabalho> uv run -q --no-project --python 3.11 --with duckdb python -I \
    scripts/fiscal/auditoria/intragrupo_extrair.py --origem <pasta com <cnpj>/original/efd_icms_ipi/*.txt> [--desde AAAA-MM] [--ate AAAA-MM]
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

C100_CAMPOS = ["ind_oper", "ind_emit", "cod_part", "cod_mod", "cod_sit", "ser", "num_doc", "chv_nfe", "dt_doc", "dt_e_s", "vl_doc"]


def ler_arquivo(caminho: str) -> dict:
    """Lê um .txt da EFD ICMS/IPI e devolve o 0000, os 0150 e os C100 (com o número da linha)."""
    abertura: list[str] = []
    participantes: list[tuple[str, str, str]] = []
    notas: list[list] = []
    with open(caminho, "r", encoding="latin-1", newline="") as f:
        for n, linha in enumerate(f, start=1):
            if linha.startswith("|C190|"):
                # O C190 é filho do C100 anterior: os CFOP da nota, sem repetir, na ordem do arquivo.
                cfop = linha.split("|", 5)[3]
                if notas and cfop and cfop not in notas[-1][-1]:
                    notas[-1][-1].append(cfop)
            elif linha.startswith("|C100|"):
                c = linha.rstrip("\r\n").split("|")
                c += [""] * (13 - len(c))
                notas.append([n, *c[2:13], []])
            elif linha.startswith("|0150|"):
                c = linha.rstrip("\r\n").split("|")
                c += [""] * (7 - len(c))
                participantes.append((c[2], c[5], c[6]))
            elif linha.startswith("|0000|"):
                abertura = linha.rstrip("\r\n").split("|")
    return {"caminho": caminho, "abertura": abertura, "participantes": participantes, "notas": notas}


def competencia(dt_ini: str) -> str:
    """DDMMAAAA → AAAA-MM."""
    return f"{dt_ini[4:8]}-{dt_ini[2:4]}" if len(dt_ini) == 8 else ""


def em_janela(ex: ProcessPoolExecutor, caminhos: list[str]):
    """Lê os arquivos em paralelo com no máximo JANELA resultados em memória (ex.map guardaria todos os que chegam antes)."""
    pendentes: deque = deque()
    for c in caminhos:
        pendentes.append(ex.submit(ler_arquivo, c))
        if len(pendentes) >= JANELA:
            yield pendentes.popleft().result()
    while pendentes:
        yield pendentes.popleft().result()


def listar(origem: Path) -> list[Path]:
    return sorted(origem.glob("*/original/efd_icms_ipi/*.txt"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--origem", required=True)
    ap.add_argument("--desde", default="")
    ap.add_argument("--ate", default="9999-99")
    a = ap.parse_args()

    arquivos = listar(Path(a.origem))
    # O mês sai do nome (…-DDMMAAAA-DDMMAAAA-…) para filtrar antes de abrir; o 0000 confirma depois.
    def mes_do_nome(p: Path) -> str:
        partes = p.name.split("-")
        return f"{partes[2][:4]}-{partes[2][4:6]}" if len(partes) > 3 and len(partes[2]) == 8 else ""
    arquivos = [p for p in arquivos if a.desde <= mes_do_nome(p) <= a.ate]
    print(f"{len(arquivos)} arquivos a ler", flush=True)
    SAIDA.mkdir(parents=True, exist_ok=True)
    tmp = {k: SAIDA / f"_{k}.tsv" for k in ("arquivos", "0150", "c100")}
    fs = {k: open(v, "w", encoding="utf-8", newline="") for k, v in tmp.items()}
    ws = {k: csv.writer(f, delimiter="\t", quoting=csv.QUOTE_MINIMAL) for k, f in fs.items()}
    ws["arquivos"].writerow(["arquivo", "estabelecimento", "competencia", "cod_fin", "dt_ini", "dt_fin", "modificado", "notas"])
    ws["0150"].writerow(["arquivo", "cod_part", "cnpj", "cpf"])
    ws["c100"].writerow(["arquivo", "linha", *C100_CAMPOS, "cfops"])
    try:
        with ProcessPoolExecutor(max_workers=PROCESSOS) as ex:
            for i, r in enumerate(em_janela(ex, [str(p) for p in arquivos]), start=1):
                ab = r["abertura"]
                if len(ab) < 8:
                    print(f"  sem 0000: {r['caminho']}", file=sys.stderr)
                    continue
                nome = Path(r["caminho"]).name
                ws["arquivos"].writerow([nome, ab[7], competencia(ab[4]), ab[3], ab[4], ab[5],
                                         int(os.path.getmtime(r["caminho"])), len(r["notas"])])
                for p in r["participantes"]:
                    ws["0150"].writerow([nome, *p])
                for n in r["notas"]:
                    ws["c100"].writerow([nome, *n[:-1], ",".join(n[-1])])
                if i % 500 == 0:
                    print(f"  {i}/{len(arquivos)}", flush=True)
    finally:
        for f in fs.values():
            f.close()

    con = duckdb.connect()
    con.execute(f"SET memory_limit = '4GB'; SET threads = 4; SET preserve_insertion_order = false; "
                f"SET temp_directory = '{(PASTA / '_duckdb_tmp').as_posix()}'")
    leia = lambda k: f"read_csv('{tmp[k].as_posix()}', delim = '\t', header = true, all_varchar = true, quote = '\"')"
    con.execute(f"""
        COPY (SELECT *, row_number() OVER (PARTITION BY estabelecimento, competencia ORDER BY modificado DESC, arquivo DESC) = 1 AS vale
              FROM (SELECT * REPLACE (CAST(modificado AS BIGINT) AS modificado, CAST(notas AS BIGINT) AS notas) FROM {leia('arquivos')}))
        TO '{(SAIDA / 'icms_arquivos.parquet').as_posix()}' (FORMAT parquet)""")
    con.execute(f"COPY (SELECT * FROM {leia('0150')}) TO '{(SAIDA / 'icms_0150.parquet').as_posix()}' (FORMAT parquet)")
    con.execute(f"""COPY (SELECT * REPLACE (CAST(linha AS BIGINT) AS linha) FROM {leia('c100')})
                    TO '{(SAIDA / 'icms_c100.parquet').as_posix()}' (FORMAT parquet)""")
    for v in tmp.values():
        v.unlink()
    for k in ("arquivos", "0150", "c100"):
        n = con.execute(f"SELECT count(*) FROM '{(SAIDA / f'icms_{k}.parquet').as_posix()}'").fetchone()[0]
        print(f"icms_{k}.parquet: {n:,} linhas".replace(",", "."))


if __name__ == "__main__":
    main()
