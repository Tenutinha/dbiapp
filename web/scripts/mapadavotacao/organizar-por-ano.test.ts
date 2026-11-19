import { describe, expect, it } from "vitest";
import { destinoPorAno } from "./organizar-por-ano";

describe("destinoPorAno", () => {
  it.each([
    ["clientes/deputado-federal/brutos/votacao-secao/2022/SP_t1.parquet", "clientes/2022/brutos/votacao-secao/deputado-federal/SP_t1.parquet"],
    ["clientes/governador/brutos/votacao-secao/2026/AC_t2.parquet", "clientes/2026/brutos/votacao-secao/governador/AC_t2.parquet"],
    ["clientes/presidente/brutos/votacao-secao/2010/BR_t2.parquet", "clientes/2010/brutos/votacao-secao/presidente/BR_t2.parquet"],
    ["clientes/presidente/brutos/votacao-secao/2010/SP_t1.parquet", "arquivo-morto/presidente-por-uf/2010/SP_t1.parquet"],
    ["clientes/presidente/brutos/votacao-secao/todos-os-anos_BR.parquet", "brutos/tse-tratado/votacao-secao-presidente-todos-os-anos_BR.parquet"],
    ["clientes/deputado-estadual/brutos/votacao-secao/2022/DF_t1.parquet", "clientes/2022/brutos/votacao-secao/deputado-distrital/DF_t1.parquet"],
    ["clientes/deputado-estadual/brutos/votacao-secao/2022/RJ_t1.parquet", "clientes/2022/brutos/votacao-secao/deputado-estadual/RJ_t1.parquet"],
    ["clientes/vereador/brutos/votacao-secao/2024/BA_t1.parquet", "clientes/2024/brutos/votacao-secao/vereador/BA_t1.parquet"],
    ["brutos/tse-tratado/comparecimento/2018/MG.parquet", "clientes/2018/brutos/comparecimento/MG.parquet"],
    ["brutos/tse-tratado/perfil-eleitorado/2024/SP.parquet", "clientes/2024/brutos/perfil-eleitorado/SP.parquet"],
    ["brutos/tse/perfil-eleitor-secao/2022/SP.csv", "clientes/2022/brutos/tse/perfil-eleitor-secao/SP.csv"],
    ["brutos/tse/consulta-cand/2020/BRASIL.csv", "clientes/2020/brutos/tse/consulta-cand/BRASIL.csv"],
  ])("%s → %s", (de, para) => {
    expect(destinoPorAno(de)).toBe(para);
  });

  it("leaves in place what is not per year, the published data and the year clients themselves", () => {
    for (const rel of [
      "clientes/presidente/dashboards/eleicoes-presidente-9e6b6380/v3/f_votacao.abc.parquet",
      "clientes/2022/brutos/votacao-secao/governador/SP_t1.parquet",
      "brutos/tse-tratado/candidatos/SP.parquet",
      "brutos/cadastros/municipios.parquet",
      "brutos/tse/bens/2012/BR.parquet",
      "midia/fotos/2022/BR/x.jpg",
      "clientes/presidente/brutos/votacao-secao/2010/",
    ]) {
      expect(destinoPorAno(rel)).toBeNull();
    }
  });
});
