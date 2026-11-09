"""Extrai de um .pbix o modelo (tabelas, colunas, relacionamentos, DAX, Power Query),
o relatório (páginas e visuais) e, opcionalmente, os dados de cada tabela em Parquet.

Saída (em --saida):
  extracao.json          tudo normalizado, pronto para virar um template da DBI
  dados/<tabela>.parquet só com --dados; nomes e colunas já em snake_case

Uso:
  uv run --no-project --python 3.11 --with pbixray --with "kaitaistruct>=0.11" --with pyarrow \
      python -I extrair_pbix.py ARQUIVO.pbix --saida PASTA [--dados] [--max-linhas N]
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from typing import Any

INTERNAL_TABLE = re.compile(r"^(LocalDateTable_|DateTableTemplate_)")
# QueryAggregateFunction do Power BI. Na interface, "Contagem (Distinta)" = Count e "Contagem" = CountNonNull.
AGG_FUNCTIONS = {0: "Sum", 1: "Avg", 2: "Count", 3: "Min", 4: "Max", 5: "CountNonNull",
                 6: "Median", 7: "StandardDeviation", 8: "Variance"}
CHUNK_ROWS = 500_000


# ---------------------------------------------------------------- utilidades

def snake(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    out = re.sub(r"[^a-z0-9]+", "_", plain.lower()).strip("_") or "col"
    return f"c_{out}" if out[0].isdigit() else out


def unique_snake(names: list[str]) -> dict[str, str]:
    taken: set[str] = set()
    mapping: dict[str, str] = {}
    for n in names:
        base = snake(n)
        candidate, i = base, 2
        while candidate in taken:
            candidate, i = f"{base}_{i}", i + 1
        taken.add(candidate)
        mapping[n] = candidate
    return mapping


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, (bytes, bytearray)):
        return f"<{len(value)} bytes>"
    if hasattr(value, "item"):  # numpy scalar
        return json_safe(value.item())
    return str(value)


def records(df: Any) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    return [{k: json_safe(v) for k, v in row.items()} for row in df.to_dict("records")]


def loads_maybe(raw: Any) -> Any:
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return raw


def literal(expr: Any) -> str | None:
    """Valor de {"expr": {"Literal": {"Value": "'Texto'"}}}."""
    try:
        value = expr["expr"]["Literal"]["Value"]
    except (KeyError, TypeError):
        return None
    return value[1:-1].replace("''", "'") if value.startswith("'") and value.endswith("'") else value


# ---------------------------------------------------------------- modelo

def dbi_type(pandas_type: str, semantic: str) -> str:
    t = (pandas_type or "").lower()
    if semantic == "Date":
        return "date"
    if "int" in t:
        return "integer"
    if "float" in t or "decimal" in t or semantic == "Currency":
        return "decimal"
    if "bool" in t:
        return "boolean"
    if "datetime" in t:
        return "timestamp"
    return "text"


def extract_model(model: Any) -> dict[str, Any]:
    schema = records(model.schema)
    by_table: dict[str, list[dict[str, Any]]] = {}
    for col in schema:
        by_table.setdefault(col["TableName"], []).append(col)

    table_names = unique_snake(list(by_table))
    rows_by_table = {r.get("TableName"): r.get("RowCount") for r in records(model.statistics)}
    tables = []
    for name, cols in by_table.items():
        col_names = unique_snake([c["ColumnName"] for c in cols if not str(c["ColumnName"]).startswith("RowNumber-")])
        tables.append({
            "nome_pbi": name,
            "nome": table_names[name],
            "interna": bool(INTERNAL_TABLE.match(name)),
            "linhas": rows_by_table.get(name),
            "colunas": [
                {"nome_pbi": c["ColumnName"], "nome": col_names[c["ColumnName"]],
                 "tipo": dbi_type(c.get("PandasDataType"), c.get("SemanticType")),
                 "tipo_pbi": c.get("PandasDataType"), "cardinalidade": c.get("Cardinality")}
                for c in cols if c["ColumnName"] in col_names
            ],
        })

    return {
        "tabelas": tables,
        "relacionamentos": records(model.relationships),
        "medidas": records(model.dax_measures),
        "colunas_calculadas": records(model.dax_columns),
        "tabelas_calculadas": records(model.dax_tables),
        "power_query": records(model.power_query),
    }


def export_data(model: Any, tables: list[dict[str, Any]], out_dir: Path, max_rows: int | None) -> list[dict[str, Any]]:
    import pandas as pd
    import pyarrow as pa
    import pyarrow.parquet as pq

    arrow = {"integer": pa.int64(), "decimal": pa.float64(), "text": pa.string(), "date": pa.date32(),
             "timestamp": pa.timestamp("us"), "boolean": pa.bool_()}
    out_dir.mkdir(parents=True, exist_ok=True)
    report = []
    for t in tables:
        if t["interna"]:
            continue
        cols = t["colunas"]
        schema = pa.schema([(c["nome"], arrow[c["tipo"]]) for c in cols])
        rename = {c["nome_pbi"]: c["nome"] for c in cols}
        target = out_dir / f"{t['nome']}.parquet"
        written = 0
        try:
            with pq.ParquetWriter(target, schema, compression="zstd") as writer:
                for chunk in model.iter_table(t["nome_pbi"], chunk_size=CHUNK_ROWS):
                    df = chunk.rename(columns=rename)[[c["nome"] for c in cols]]
                    if max_rows is not None:
                        df = df.head(max_rows - written)
                    df = pd.DataFrame({c["nome"]: coerce(df[c["nome"]], c["tipo"]) for c in cols})
                    writer.write_table(pa.Table.from_pandas(df, schema=schema, preserve_index=False))
                    written += len(df)
                    if max_rows is not None and written >= max_rows:
                        break
            report.append({"tabela": t["nome"], "arquivo": str(target), "linhas": written})
        except Exception as err:  # noqa: BLE001 — uma tabela ruim não derruba as outras
            target.unlink(missing_ok=True)
            report.append({"tabela": t["nome"], "erro": f"{type(err).__name__}: {err}"})
    return report


def coerce(series: Any, kind: str) -> Any:
    import pandas as pd

    if kind == "text":
        return series.astype("string")
    if kind in ("date", "timestamp"):
        values = pd.to_datetime(series, errors="coerce")
        # O VertiPaq guarda frações de nanossegundo; o Parquet da DBI usa microssegundos.
        return values.dt.date if kind == "date" else values.dt.floor("us")
    if kind == "boolean":
        return series.astype("boolean")
    if kind == "integer":
        return pd.to_numeric(series, errors="coerce").astype("Int64")
    return pd.to_numeric(series, errors="coerce").astype("float64")


# ---------------------------------------------------------------- relatório

def field_ref(item: dict[str, Any], aliases: dict[str, str]) -> dict[str, Any]:
    """Descreve um item de consulta do visual (coluna, medida, agregação ou nível de hierarquia)."""
    def entity(node: dict[str, Any]) -> str | None:
        expr = node.get("Expression", {})
        src = expr.get("SourceRef") or expr.get("PropertyVariationSource", {}).get("Expression", {}).get("SourceRef", {})
        return src.get("Entity") or aliases.get(src.get("Source", ""))

    if "Measure" in item:
        return {"tipo": "medida", "tabela": entity(item["Measure"]), "nome": item["Measure"].get("Property")}
    if "Column" in item:
        return {"tipo": "coluna", "tabela": entity(item["Column"]), "nome": item["Column"].get("Property")}
    if "Aggregation" in item:
        agg = item["Aggregation"]
        inner = field_ref(agg.get("Expression", {}), aliases)
        code = agg.get("Function")
        return {**inner, "tipo": "agregacao", "funcao": AGG_FUNCTIONS.get(code, f"codigo_{code}")}
    if "HierarchyLevel" in item:
        level = item["HierarchyLevel"]
        hier = level.get("Expression", {}).get("Hierarchy", {})
        variation = hier.get("Expression", {}).get("PropertyVariationSource", {})
        return {"tipo": "nivel_hierarquia", "tabela": entity(hier),
                "nome": variation.get("Property") or hier.get("Hierarchy"),
                "hierarquia": hier.get("Hierarchy"), "nivel": level.get("Level")}
    return {"tipo": "desconhecido", "bruto": json.dumps(item, ensure_ascii=False)[:300]}


def text_body(objects: dict[str, Any]) -> str | None:
    paragraphs = (objects.get("general") or [{}])[0].get("properties", {}).get("paragraphs")
    if not paragraphs:
        return None
    lines = ["".join(run.get("value", "") for run in p.get("textRuns", [])) for p in paragraphs]
    return "\n".join(lines).strip() or None


def title_of(container_objects: dict[str, Any]) -> str | None:
    props = (container_objects.get("title") or [{}])[0].get("properties", {})
    return literal(props.get("text"))


def normalize_visual(name: str, visual: dict[str, Any], pos: dict[str, Any], page_width: float,
                     roles: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    width = float(pos.get("width") or 0)
    span = max(1, min(12, round(width / page_width * 12))) if page_width else 12
    return {
        "id": name,
        "tipo_pbi": visual.get("visualType"),
        "titulo": title_of(visual.get("vcObjects") or visual.get("visualContainerObjects") or {}),
        "posicao": {k: pos.get(k) for k in ("x", "y", "width", "height")},
        "span_sugerido": span,
        "papeis": roles,
        "texto": text_body(visual.get("objects") or {}),
    }


def legacy_pages(raw: bytes) -> list[dict[str, Any]]:
    layout = json.loads(raw.decode("utf-16-le").lstrip("﻿"))
    pages = []
    for sec in sorted(layout.get("sections", []), key=lambda s: s.get("ordinal", 0)):
        page_cfg = loads_maybe(sec.get("config")) or {}
        visuals = []
        for vc in sec.get("visualContainers", []):
            cfg = loads_maybe(vc.get("config")) or {}
            sv = cfg.get("singleVisual")
            if not sv:
                continue  # grupos de visuais não têm consulta
            proto = sv.get("prototypeQuery") or {}
            aliases = {f.get("Name"): f.get("Entity") for f in proto.get("From", [])}
            selects = {s.get("Name"): s for s in proto.get("Select", [])}
            roles = {
                role: [{"ref": p.get("queryRef"), **field_ref(selects.get(p.get("queryRef"), {}), aliases)}
                       for p in items]
                for role, items in (sv.get("projections") or {}).items()
            }
            pos = {k: vc.get(k) for k in ("x", "y", "width", "height")}
            visuals.append(normalize_visual(cfg.get("name", ""), sv, pos, float(sec.get("width") or 1280), roles))
        pages.append({"id": sec.get("name"), "titulo": sec.get("displayName"),
                      "oculta": page_cfg.get("visibility") == 1, "visuais": visuals})
    return pages


def pbir_pages(zf: zipfile.ZipFile) -> list[dict[str, Any]]:
    base = "Report/definition/pages/"
    names = zf.namelist()
    order = []
    if f"{base}pages.json" in names:
        order = json.loads(zf.read(f"{base}pages.json")).get("pageOrder", [])
    page_ids = sorted({n[len(base):].split("/")[0] for n in names if n.startswith(base) and n.endswith("/page.json")},
                      key=lambda p: order.index(p) if p in order else len(order))
    pages = []
    for pid in page_ids:
        page = json.loads(zf.read(f"{base}{pid}/page.json"))
        visuals = []
        prefix = f"{base}{pid}/visuals/"
        for vpath in sorted(n for n in names if n.startswith(prefix) and n.endswith("/visual.json")):
            doc = json.loads(zf.read(vpath))
            visual = doc.get("visual")
            if not visual:
                continue
            state = (visual.get("query") or {}).get("queryState") or {}
            roles = {role: [{"ref": p.get("queryRef"), **field_ref(p.get("field", {}), {})}
                            for p in spec.get("projections", [])]
                     for role, spec in state.items()}
            visuals.append(normalize_visual(doc.get("name", ""), visual, doc.get("position", {}),
                                            float(page.get("width") or 1280), roles))
        pages.append({"id": pid, "titulo": page.get("displayName"),
                      "oculta": page.get("visibility") == "HiddenInViewMode", "visuais": visuals})
    return pages


def extract_report(zf: zipfile.ZipFile) -> dict[str, Any]:
    names = zf.namelist()
    if "Report/Layout" in names:
        return {"formato": "legado", "paginas": legacy_pages(zf.read("Report/Layout"))}
    if any(n.startswith("Report/definition/pages/") for n in names):
        return {"formato": "pbir", "paginas": pbir_pages(zf)}
    return {"formato": "desconhecido", "paginas": [], "arquivos": names[:50]}


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pbix", type=Path)
    ap.add_argument("--saida", type=Path, required=True)
    ap.add_argument("--dados", action="store_true", help="exporta cada tabela em Parquet")
    ap.add_argument("--max-linhas", type=int, default=None, help="limita linhas por tabela (amostra)")
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")

    if not zipfile.is_zipfile(args.pbix):
        print(f"erro: {args.pbix} não é um .pbix válido (não é ZIP)", file=sys.stderr)
        return 2
    args.saida.mkdir(parents=True, exist_ok=True)
    avisos: list[str] = []

    with zipfile.ZipFile(args.pbix) as zf:
        report = extract_report(zf)
        has_model = "DataModel" in zf.namelist()

    result: dict[str, Any] = {"arquivo": args.pbix.name, "relatorio": report, "modelo": None, "dados": [], "avisos": avisos}
    if not has_model:
        avisos.append("Sem DataModel: relatório em Live Connection; só o layout foi extraído.")
    else:
        from pbixray import PBIXRay

        try:
            model = PBIXRay(str(args.pbix))
        except Exception as err:  # noqa: BLE001
            avisos.append(f"Falha ao ler o DataModel: {type(err).__name__}: {err}")
        else:
            result["modelo"] = extract_model(model)
            if args.dados:
                result["dados"] = export_data(model, result["modelo"]["tabelas"], args.saida / "dados", args.max_linhas)
            model.close()

    (args.saida / "extracao.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    m = result["modelo"] or {}
    pages = report["paginas"]
    print(f"relatório ({report['formato']}): {len(pages)} páginas, {sum(len(p['visuais']) for p in pages)} visuais")
    print(f"modelo: {len([t for t in m.get('tabelas', []) if not t['interna']])} tabelas, "
          f"{len(m.get('relacionamentos', []))} relacionamentos, {len(m.get('medidas', []))} medidas, "
          f"{len(m.get('colunas_calculadas', []))} colunas calculadas")
    for d in result["dados"]:
        print(f"dados: {d['tabela']}: {d.get('linhas', d.get('erro'))}")
    for a in avisos:
        print(f"aviso: {a}")
    print(f"saída: {args.saida / 'extracao.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
