"""Resumo legível de um extracao.json (skill pbix-importar), para montar o template.

Mostra relacionamentos, cada página com seus visuais de dados (tipo, título, campos por papel),
os campos dos slicers, o DAX das medidas usadas pelos visuais (com as medidas que elas citam)
e as colunas das tabelas envolvidas.

Uso: python -I resumir_extracao.py <extracao.json> [--dax-max 600]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from typing import Any

DECOR = {"actionButton", "image", "pageNavigator", "bookmarkNavigator", "shape", "basicShape"}
REF = re.compile(r"(?<![\w'\]])\[([^\]]+)\]")


def ref(f: dict[str, Any]) -> str:
    kind = (f.get("tipo") or "?")[0]
    out = f"{kind}:{f.get('tabela')}.{f.get('nome')}"
    if f.get("funcao"):
        out += f"/{f['funcao']}"
    if f.get("nivel"):
        out += f"/{f['nivel']}"
    return out


def is_decor(tipo: str | None) -> bool:
    return not tipo or tipo in DECOR or tipo.startswith("simpleImage")


def print_pages(pages: list[dict[str, Any]], used: set[str]) -> None:
    for p in pages:
        counts = Counter(v["tipo_pbi"] for v in p["visuais"])
        print(f"\n=== {p['titulo']}  (oculta={p['oculta']})  {dict(counts)}")
        slicers: set[str] = set()
        visuals = sorted(p["visuais"], key=lambda v: ((v["posicao"].get("y") or 0), (v["posicao"].get("x") or 0)))
        for v in visuals:
            if is_decor(v["tipo_pbi"]):
                continue
            fields = [f for fs in v["papeis"].values() for f in fs]
            used.update(f["nome"] for f in fields if f.get("tipo") == "medida")
            if v["tipo_pbi"] == "slicer":
                slicers.update(ref(f) for f in fields)
                continue
            roles = "; ".join(f"{k}=[{', '.join(ref(f) for f in fs)}]" for k, fs in v["papeis"].items())
            text = f" TEXTO={v['texto'][:100]!r}" if v.get("texto") else ""
            print(f"- {v['tipo_pbi']} span={v['span_sugerido']} y={round(v['posicao'].get('y') or 0)}"
                  f" titulo={v['titulo']!r} {roles}{text}")
        if slicers:
            print("  SLICERS:", ", ".join(sorted(slicers)))


def print_measures(measures: dict[str, dict[str, Any]], used: set[str], dax_max: int) -> None:
    print("\n=== DAX das medidas usadas (e dependências)")
    seen: set[str] = set()

    def show(name: str, depth: int) -> None:
        if name in seen or name not in measures or depth > 3:
            return
        seen.add(name)
        m = measures[name]
        print(f"--- [{name}] ({m.get('TableName')})\n{str(m.get('Expression') or '').strip()[:dax_max]}\n")
        for dep in REF.findall(str(m.get("Expression") or "")):
            show(dep, depth + 1)

    for name in sorted(used):
        show(name, 0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("extracao")
    ap.add_argument("--dax-max", type=int, default=600)
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")

    with open(args.extracao, encoding="utf-8") as fh:
        d = json.load(fh)
    model = d.get("modelo") or {}
    print("=== Relacionamentos")
    for r in model.get("relacionamentos", []):
        print(f"  {r.get('FromTableName')}[{r.get('FromColumnName')}] -> {r.get('ToTableName')}[{r.get('ToColumnName')}]"
              f"{'' if r.get('IsActive', 1) else '  (INATIVO)'}")

    used: set[str] = set()
    print_pages(d["relatorio"]["paginas"], used)
    print_measures({m["Name"]: m for m in model.get("medidas", [])}, used, args.dax_max)

    print("=== Tabelas (não internas): nome, linhas exportadas, colunas")
    rows = {x["tabela"]: x.get("linhas") for x in d.get("dados", [])}
    for t in model.get("tabelas", []):
        if t["interna"] or t["nome"].startswith(("aux", "doc")):
            continue
        cols = ", ".join(f"{c['nome']}:{c['tipo']}" for c in t["colunas"])
        print(f"- {t['nome']} ({t['nome_pbi']}) linhas={rows.get(t['nome'])}: {cols}")
    calc = model.get("colunas_calculadas", [])
    if calc:
        print("\n=== Colunas calculadas")
        for c in calc:
            print(f"  {c.get('TableName')}[{c.get('ColumnName')}] = {str(c.get('Expression')).strip()[:160]!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
