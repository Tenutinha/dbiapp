"""
Glossário das auditorias: lê o catálogo (docs/auditorias-catalogo.md) e as regras ativas (preparar.py) e monta a tabela
"glossario" do dashboard "Auditoria fiscal", uma linha por auditoria, com a situação (Ativa ou Planejada).
Documentação: docs/auditoria-fiscal.md.

Uso (grava dados/glossario.parquet na pasta de trabalho; com --conferir, só mostra a contagem por tema):
  uv run -q --no-project --python 3.11 --with duckdb python -I web/scripts/fiscal/auditoria/glossario.py [--conferir]
"""
import os
import re
import sys
from pathlib import Path
from typing import NamedTuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
from preparar import REGRAS  # noqa: E402

CATALOGO = Path(__file__).resolve().parents[4] / "docs" / "auditorias-catalogo.md"
ATIVA = "Ativa"
PLANEJADA = "Planejada"

# Auditorias do catálogo que já rodam: CR17 fora da tela (por script); CZ11 na seção "Notas entre estabelecimentos do grupo"
# (intragrupo.py), que confere chave, sentido, mês, situação e VL_DOC, sem os valores de ICMS e ST; CD01, CD02 e CD04 na seção
# "Cadastro e NCM" (ncm.py).
ATIVAS_DO_CATALOGO = frozenset({"CR17", "CZ11", "CD01", "CD02", "CD04"})

# Tema do catálogo em que cada regra ativa do dashboard se encaixa.
TEMA_DA_REGRA = {
    "C": "Consistência da EFD Contribuições",
    "X": "Cruzamento entre obrigações",
    "O01": "PIS/COFINS pago a maior",
    "O02": "Créditos de PIS/COFINS não aproveitados",
    "O03": "Créditos de PIS/COFINS não aproveitados",
}
RESULTADO_DA_REGRA = {"C": "Erro", "X": "Erro", "O": "Oportunidade de recuperação"}


class Auditoria(NamedTuple):
    ordem: int
    codigo: str
    tema_ordem: int
    tema: str
    auditoria: str
    situacao: str
    confere: str
    importa: str
    dificuldade: str
    tributarista: str
    resultado: str


def texto_puro(md: str) -> str:
    """Tira a marcação do Markdown: links, negrito e crases."""
    sem_link = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", md)
    return re.sub(r"\*\*|`", "", sem_link).strip()


def maiuscula(texto: str) -> str:
    return texto[:1].upper() + texto[1:]


def campo(linhas: list[str], rotulo: str) -> str:
    """O texto do tópico "- **Rótulo:** …" de uma auditoria."""
    for linha in linhas:
        if linha.startswith(f"- **{rotulo}:**"):
            return texto_puro(linha.split(":**", 1)[1])
    return ""


def parte(linha: str, rotulo: str) -> str:
    """Um trecho da linha "Dificuldade · Tributarista · Resultado", sem o comentário entre parênteses."""
    achado = re.search(rf"\*\*{rotulo}:\*\*\s*([^·]+)", linha)
    return re.sub(r"\s*\(.*\)\s*$", "", texto_puro(achado.group(1))) if achado else ""


def ler_catalogo(markdown: str) -> list[Auditoria]:
    """Uma Auditoria por título "#### XX00 · Nome" do catálogo, na ordem do documento."""
    auditorias: list[Auditoria] = []
    tema = ""
    blocos = re.split(r"^(?=#{2,4} )", markdown, flags=re.M)
    for bloco in blocos:
        linhas = bloco.splitlines()
        titulo_tema = re.match(r"## \d+\. (.+?)(?: \([A-Z]{2}\))?$", linhas[0]) if linhas else None
        if titulo_tema:
            tema = titulo_tema.group(1)
            continue
        titulo = re.match(r"#### ([A-Z]{2}\d{2}) · (.+)$", linhas[0]) if linhas else None
        if not titulo:
            continue
        codigo = titulo.group(1)
        classificacao = next((linha for linha in linhas if linha.startswith("- **Dificuldade:**")), "")
        auditoria = Auditoria(
            ordem=len(auditorias) + 1, codigo=codigo, tema_ordem=0, tema=tema, auditoria=texto_puro(titulo.group(2)),
            situacao=ATIVA if codigo in ATIVAS_DO_CATALOGO else PLANEJADA,
            confere=maiuscula(campo(linhas, "Confere")), importa=maiuscula(campo(linhas, "Por que importa")),
            dificuldade=maiuscula(parte(classificacao, "Dificuldade")),
            tributarista=maiuscula(parte(classificacao, "Tributarista")) or "Não",
            resultado=maiuscula(parte(classificacao, "Resultado")),
        )
        vazios = [nome for nome in ("tema", "confere", "importa", "dificuldade", "resultado") if not getattr(auditoria, nome)]
        if vazios:
            raise ValueError(f"catálogo: {codigo} sem {', '.join(vazios)}")
        auditorias.append(auditoria)
    if not auditorias:
        raise ValueError("catálogo: nenhuma auditoria encontrada")
    return auditorias


def regras_ativas() -> list[Auditoria]:
    """As regras que o dashboard já roda (preparar.py), no formato do glossário."""
    ativas = []
    for codigo, _grupo, titulo, _gravidade, descricao, acao in REGRAS:
        letra = codigo[0]
        ativas.append(Auditoria(
            ordem=0, codigo=codigo, tema_ordem=0, tema=TEMA_DA_REGRA.get(codigo) or TEMA_DA_REGRA[letra], auditoria=titulo, situacao=ATIVA,
            confere=descricao, importa=acao, dificuldade="", tributarista="Sim" if letra == "O" else "Não",
            resultado=RESULTADO_DA_REGRA[letra],
        ))
    return ativas


def montar(markdown: str) -> list[Auditoria]:
    """O glossário inteiro: em cada tema, primeiro as regras ativas, depois as do catálogo."""
    catalogo = ler_catalogo(markdown)
    temas = list(dict.fromkeys(a.tema for a in catalogo))
    ativas = regras_ativas()
    sem_tema = sorted({a.tema for a in ativas} - set(temas))
    if sem_tema:
        raise ValueError(f"regra ativa em tema que não existe no catálogo: {', '.join(sem_tema)}")
    em_ordem = [a for tema in temas for a in [*(r for r in ativas if r.tema == tema), *(c for c in catalogo if c.tema == tema)]]
    return [a._replace(ordem=n, tema_ordem=temas.index(a.tema) + 1) for n, a in enumerate(em_ordem, 1)]


def gravar(auditorias: list[Auditoria], destino: Path) -> None:
    import duckdb

    con = duckdb.connect()
    con.execute("""CREATE TABLE glossario (ordem INTEGER, codigo VARCHAR, tema_ordem INTEGER, tema VARCHAR, auditoria VARCHAR, situacao VARCHAR,
                   confere VARCHAR, importa VARCHAR, dificuldade VARCHAR, tributarista VARCHAR, resultado VARCHAR)""")
    con.executemany("INSERT INTO glossario VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [tuple(a) for a in auditorias])
    con.execute(f"COPY (SELECT * FROM glossario ORDER BY ordem) TO '{destino.as_posix()}' (FORMAT parquet)")


def main() -> None:
    auditorias = montar(CATALOGO.read_text(encoding="utf-8"))
    if "--conferir" in sys.argv:
        for tema in dict.fromkeys(a.tema for a in auditorias):
            do_tema = [a for a in auditorias if a.tema == tema]
            print(f"{len(do_tema):4d} ({sum(a.situacao == ATIVA for a in do_tema)} ativas)  {tema}")
        print(f"{len(auditorias):4d} ({sum(a.situacao == ATIVA for a in auditorias)} ativas)  total")
        return
    dados = Path(os.environ.get("AUDITORIA_PASTA", Path.cwd())).resolve() / "dados"
    dados.mkdir(exist_ok=True)
    gravar(auditorias, dados / "glossario.parquet")
    print(f"glossario.parquet: {len(auditorias)} auditorias")


if __name__ == "__main__":
    main()
