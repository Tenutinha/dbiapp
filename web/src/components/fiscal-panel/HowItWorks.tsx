/** How the fiscal files become the dashboards' tables, in words (collapsed: open when someone wants it). */
export function HowItWorks() {
  return (
    <details className="card p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Como os arquivos são tratados</summary>
      <div className="mt-3 flex max-w-3xl flex-col gap-3 text-muted">
        <p>São duas etapas: primeiro um resultado para cada arquivo original, depois um arquivo único por tabela.</p>
        <div>
          <p className="font-semibold text-text">1. Ler: um resultado para cada arquivo original (as &ldquo;partes&rdquo;)</p>
          <p>
            Cada arquivo SPED (uma empresa, um mês) é lido uma única vez e vira uma pasta própria, com um Parquet pequeno para
            cada tabela do molde e um marcador <code>pronto.json</code> gravado por último. O nome da pasta vem do conteúdo do
            arquivo: um mês novo é lido sozinho; uma retificadora lê de novo só aquele mês; um arquivo que não pôde ser lido
            guarda o motivo até ser trocado. É o que o &ldquo;Ler&rdquo; e o clique em um quadradinho do mapa fazem.
          </p>
        </div>
        <div>
          <p className="font-semibold text-text">2. Montar: um arquivo único por tabela (o que o dashboard lê)</p>
          <p>
            &ldquo;Montar tabelas&rdquo; não relê nenhum arquivo: junta as partes e grava um Parquet por tabela no rascunho do
            dashboard, que só aparece para os usuários depois de publicado. As tabelas por bloco e de resumo juntam todos os
            meses; a tabela do arquivo inteiro (<code>registros</code>) fica só com o mês mais recente de cada empresa; os
            cadastros (participantes, itens) ficam com o código do mês mais recente. Ao lado vai a linhagem: de quais arquivos
            veio cada tabela.
          </p>
        </div>
        <p>
          Assim, cada arquivo é lido uma vez só, e o dashboard abre rápido com qualquer número de meses (lê um arquivo por
          tabela, não milhares de pedaços). Arquivos muito grandes (ECD de centenas de MB) são lidos pelo script, e o andamento
          aparece aqui do mesmo jeito. A NF-e é a exceção: não tem partes, os XML são lidos inteiros a cada montagem.
        </p>
      </div>
    </details>
  );
}
