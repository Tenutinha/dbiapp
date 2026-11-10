import { describe, expect, it } from "vitest";
import { destinoDe } from "./organizar-destino";

describe("destinoDe", () => {
  it.each([
    ["acervo/dados_eleicoes/SP/vw_f_votacao_secao_uf_sp_deputado_federal_2022_t1.parquet", "clientes/deputado-federal/brutos/votacao-secao/2022/SP_t1.parquet"],
    ["acervo/dados_eleicoes/BR/vw_f_votacao_secao_uf_br_presidente_2026_t2.parquet", "clientes/presidente/brutos/votacao-secao/2026/BR_t2.parquet"],
    ["acervo/dados_eleicoes/BR/vw_f_votacao_secao_uf_br.parquet", "clientes/presidente/brutos/votacao-secao/todos-os-anos_BR.parquet"],
    ["acervo/dados_eleicoes/AC/perfil_comparecimento_abstencao_2024_ac.parquet", "brutos/tse-tratado/comparecimento/2024/AC.parquet"],
    ["acervo/dados_eleicoes/AC/dim_perfil_2018.parquet", "brutos/tse-tratado/perfil-eleitorado/2018/AC.parquet"],
    ["acervo/dados_eleicoes/AC/dim_candidatos_ac.parquet", "brutos/tse-tratado/candidatos/AC.parquet"],
    ["acervo/dados_eleicoes/SP/dim_candidatos_br.parquet", "brutos/tse-tratado/candidatos/BR.parquet"],
    ["acervo/dados_eleicoes/dim_candidatos.parquet", "brutos/tse-tratado/candidatos/todas-as-ufs.parquet"],
    ["acervo/dados_eleicoes/dim_municipios.parquet", "brutos/cadastros/municipios.parquet"],
    ["acervo/dados_eleicoes/AC/_f_votacao_secao_2018_ac_governador_t1.parquet", "arquivo-morto/acervo/dados_eleicoes/AC/_f_votacao_secao_2018_ac_governador_t1.parquet"],
    ["acervo/dados_eleicoes/teste_conexao.txt", "arquivo-morto/acervo/dados_eleicoes/teste_conexao.txt"],
    ["acervo/tse/2022/perfil_eleitor_secao_2022_SP.csv", "brutos/tse/perfil-eleitor-secao/2022/SP.csv"],
    ["acervo/tse/2020/consulta_cand_2020_BRASIL.csv", "brutos/tse/consulta-cand/2020/BRASIL.csv"],
    ["acervo/tse/2024/bens_2024.parquet", "brutos/tse/bens/2024/BR.parquet"],
    ["acervo/fotos/2022/BR/FBR280001607829_div.jpg", "midia/fotos/2022/BR/FBR280001607829_div.jpg"],
    ["acervo/backup/dim_locais_2026-05-28.parquet", "arquivo-morto/backup/dim_locais_2026-05-28.parquet"],
    ["acervo/dados_emendas/emendas_convenios_2023_2026.parquet", "brutos/emendas/emendas_convenios_2023_2026.parquet"],
    ["acervo/dados_eleicoes/DF/vw_f_votacao_secao_uf_df_deputado_distrital_2022_t1.parquet", "clientes/deputado-estadual/brutos/votacao-secao/2022/DF_t1.parquet"],
    ["preparado/deputados/f_votacao.parquet", "arquivo-morto/preparado-antigo/deputados/f_votacao.parquet"],
  ])("%s → %s", (de, para) => {
    expect(destinoDe(de)).toBe(para);
  });

  it("never touches app folders, folder markers or what is already organized", () => {
    for (const rel of ["datasets/x/v1/f.parquet", "branding/logo.png", "clientes/a/b.csv", "acervo/tse/", "", "brutos/geo/a.json", "clientes/presidente/preparado/votos-validos/f_votacao.parquet"]) {
      expect(destinoDe(rel)).toBeNull();
    }
  });
});
