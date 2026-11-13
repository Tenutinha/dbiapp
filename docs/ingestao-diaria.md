# Ingestão diária das tabelas oficiais (desenho)

Status: proposta, 2026-11-13. Nada implementado ainda.

## Objetivo

Todo dia a **Odeon** exporta, para cada cliente dela, o Parquet das **tabelas oficiais** do ERP. Os arquivos passam pelo nosso tratamento e os dashboards do espaço dele (Vendas, Financeiro, Estoque…) amanhecem atualizados, sem ninguém da DBI subir arquivo à mão.

Hoje o caminho é manual:

1. Alguém extrai os dados (do .pbix ou do banco).
2. Um script em `dbi-importacoes` monta as tabelas do molde.
3. `carregar-dashboard.ts` ou o engate da tela sobe e publica.

O tratamento que o Power BI fazia (Power Query e colunas calculadas) está documentado no dashboard **Dados Phoenix**. Ele é a especificação do que este fluxo precisa reproduzir.

## Visão geral

```
ERP (servidor da Odeon) ──(exportação diária, Parquet por tabela, um lote por cliente)──▶ caixa de entrada do espaço
   orgs/<org>/clientes/<cliente>/entrada/<AAAA-MM-DD>/<tabela>.parquet
                                   │  lote fechado (manifesto)
                                   ▼
              1. conferência     cada arquivo contra o contrato de entrada (colunas, tipos, vazios)
              2. tratamento      SQL versionado: oficial → staging (o Power Query traduzido)
                                 → tabelas de cada molde (fatos, dimensões, fatos de movimento)
              3. publicação      para cada dashboard do espaço alimentado por este pacote:
                                 rascunho → ingestIntoDraft por tabela → publishDraft
                                   │
                                   ▼
              dashboards com a versão nova (troca atômica; a anterior fica até a nova validar)
```

Nada disso muda o motor de consulta nem o formato dos moldes. A publicação é a mesma de hoje (`web/src/lib/services/datasets.ts`): versão em rascunho, validação, troca atômica e limpeza da versão anterior.

## As peças

### 1. Pacote de origem (contrato de entrada)

É um arquivo versionado no repositório, sem dado de cliente: `web/feeds/<pacote>/pacote.json`. Ele descreve as tabelas oficiais de um sistema de origem, no caso o ERP da Odeon, que serve a todos os clientes dela.

- **Tabelas oficiais.** Nome, colunas, tipo, se pode vir vazia, a chave e o modo de carga (completa ou por janela de datas). Os três modelos leem hoje 21 tabelas `dbo.*`:
  - cadastros: `Clientes`, `Filiais`, `GrupoFiliais`, `Fornecedor`, `Funcionario`, `vw_item`, `PlanoPagamento`, `Cartao`, `Modalidades`, `Origens`, `StatusTitulos`;
  - movimento: `Vendas`, `Entradas`, `Estoque`, `Custos`, `TitulosReceber`, `TitulosPagar`;
  - metas: `Planejamento_Filial_Diario`, `Planejamento_Filial_Mensal`, `Planejamento_Filial_Linha_Mensal`, `Planejamento_Filial_Vendedor_Mensal`.
- **Tabelas de referência da DBI.** Não vêm do cliente: municípios IBGE, UF → região e a calendário. Ficam versionadas junto do pacote.
- **De onde saem os tipos.** Da etapa `Table.TransformColumnTypes` de cada consulta, que está no Dados Phoenix (seção Power Query).

### 2. Tratamento (receitas SQL)

Também fica versionado em `web/feeds/<pacote>/`, em arquivos `.sql` do DuckDB, um por tabela de saída:

- **`staging/`**: o Power Query traduzido, uma consulta por tabela oficial. Exemplos: troca de nulos por "Não cadastrado", maiúsculas, junção com municípios e UF → região, valor líquido corrigido. As 558 etapas de Power Query do Dados Phoenix são a lista do que traduzir. A maior parte é tipo, renomeação, troca de valor e junção.
- **`modelos/<molde>/`**: as tabelas que cada molde espera. Ficam aqui as colunas calculadas DAX que viraram colunas de dado e as fatos derivadas, como a fato de movimento do Estoque e as colunas `*_rateado`.
- **Testes.** Rodam com um lote pequeno e anonimizado de exemplo, criado à mão (nunca dado real). Cada receita tem um teste que confere colunas, chaves únicas e alguns totais.

Isto substitui os scripts soltos de `dbi-importacoes` por código revisado em PR. A carga manual inicial (`carregar-dashboard.ts --dados`) passa a usar as mesmas receitas.

### 3. Caixa de entrada e credencial de envio

Decidido (2026-11-13): **quem exporta é a Odeon**, por todos os clientes dela. O envio é de máquina para máquina e continua valendo a regra de que usuário de cliente não sobe dados. A credencial não é um usuário: é uma **chave de envio da organização**, que o admin da Odeon (ou o admin master) gera na administração.

- **Tabela `feed_keys`.**
  - Colunas: organização, pacote, clientes permitidos (todos ou uma lista), hash da chave (só o hash fica guardado), quem criou, criada em, revogada em e último uso.
  - A chave aparece uma vez, na criação.
  - Uma chave só escreve nas caixas de entrada dos espaços da sua organização. Ela não lê nada.
- **O cliente vai no lote.** Cada lote nomeia o cliente pelo endereço do espaço (`org_clients.slug`). A API recusa um cliente que não é da organização da chave, que não está na lista permitida ou que não tem dashboard alimentado pelo pacote.
- **Um lote por cliente.** Os lotes de clientes diferentes são independentes: a falha de um não segura os outros.
- **API.**

  | Chamada | O que faz |
  |---|---|
  | `POST /api/feed/lotes` | Recebe o cliente e a data, abre o lote e devolve, para cada tabela, uma URL assinada de envio direto ao GCS. O arquivo não passa pela Vercel, que tem limite de corpo de requisição. |
  | `POST /api/feed/lotes/<id>/fechar` | Recebe o manifesto (tabelas e linhas de cada uma) e dispara o processamento. |
  | `GET /api/feed/lotes/<id>` | Devolve o estado e o relatório do lote. |

- **Na prática, para o cliente.**
  - A Odeon agenda no servidor dela um script de exportação. Para cada cliente, ele roda a consulta SQL de cada tabela oficial, grava o Parquet e faz as chamadas acima.
  - Nós entregamos esse script pronto, em PowerShell e em Python, com a chave lida de variável de ambiente. A lista de clientes e a conexão com o banco ficam num arquivo de configuração dela.
  - Um cliente novo da Odeon entra só com uma linha nessa configuração e o dashboard ativado no espaço dele.
  - Para quem já tem o Parquet na mão, também há um envio pela tela da administração do espaço, só para a equipe da organização.
- **Proteções.**
  - Limite de tamanho por arquivo e por lote.
  - Um lote aberto por espaço por vez.
  - Limite de chamadas por chave.
  - Registro de cada uso.
  - Revogação imediata.

### 4. Processamento

- **Gatilho.** O fechamento do lote dispara o processamento. Um cron diário da Vercel (`vercel.json`) é a rede de segurança: processa lotes fechados e parados e avisa dos espaços que não mandaram nada no dia.
- **Onde roda.**
  - No começo, numa função da Vercel (`maxDuration` 300 s), com o mesmo DuckDB da ingestão de hoje. A SuperAuto tem dezenas de milhares de linhas, então cabe com folga.
  - Quando um cliente passar disso, o mesmo código roda como Cloud Run Job no projeto GCP `dbi-app-br`. O bucket já está lá, e o job é chamado pelo mesmo endpoint de fechamento.
- **Estado.** Fica na tabela `feed_batches`: `recebendo` → `fechado` → `processando` → `publicado` ou `recusado`. O relatório tem, por tabela, linhas, erros, avisos e órfãos, e quais dashboards foram publicados.
- **Tudo ou nada por espaço.**
  - Se uma tabela oficial falhar na conferência, nenhum dashboard do espaço publica.
  - Assim o Vendas não mostra um dia e o Estoque outro.
  - Os rascunhos daquele lote são descartados e a versão anterior continua no ar.
- **Idempotência.**
  - Reprocessar o mesmo lote dá o mesmo resultado.
  - Um lote novo do mesmo dia substitui o anterior.

### 5. Publicação nos dashboards

O molde ganha um campo opcional `feed: { pacote: "<pacote>", tabelas: { "<tabela do molde>": "<receita>" } }`.

Ao fechar um lote, o processamento procura os dashboards ativos do espaço cujo molde aponta para aquele pacote. Para cada um, ele:

1. cria o rascunho;
2. engata cada tabela pelo `ingestIntoDraft`, a mesma validação de contrato de hoje;
3. publica com `publishDraft`.

O autor da publicação fica como "envio automático". Hoje fica gravado o usuário. O ajuste é aceitar nulo e mostrar o rótulo.

### 6. Acompanhamento

- **Na administração da Odeon,** uma visão de todos os clientes no dia (quem mandou, quem falhou, quem falta) e, em cada espaço: o último lote, o estado, a data dos dados e o relatório, mais um botão "reprocessar".
- **Aviso por e-mail (Resend) para a equipe de dados da organização quando:**
  - um lote é recusado;
  - um espaço não manda nada até o horário combinado.
- **No dashboard,** a data dos dados, que hoje é a data de publicação, passa a ser a data do lote.

## Carga completa ou por período

| Tipo de tabela | Proposta |
|---|---|
| Cadastros (clientes, itens, filiais…) | Completa todo dia. São pequenas. |
| Movimento (vendas, entradas, títulos) | Fase 1: completa todo dia. É simples e se corrige sozinha. Fase 2, quando o volume pedir: janela dos últimos N dias, substituindo o mesmo período na tabela acumulada. |
| Foto (estoque, saldos) | A posição do dia. O acumulado mês a mês fica do nosso lado (`*_atual` e evolução mensal, como já faz a fato de movimento do Estoque). |

## Fases

1. **Pacote e receitas.**
   - Montar `pacote.json` e as receitas SQL para os três moldes da SuperAuto, a partir do Dados Phoenix.
   - Conferir que, com os mesmos dados de origem, saem os mesmos totais publicados hoje: faturamento R$ 4.935.910,50, vendas 10.011, clientes 1.137.
   - A carga manual passa a usar as receitas.
2. **Caixa de entrada.**
   - Migração `feed_keys` e `feed_batches`, a API de lotes com URLs assinadas e o processamento na Vercel.
   - A tela de lotes na administração.
   - O script de exportação de exemplo.
3. **Operação.** Cron de segurança, e-mails, "reprocessar" e a data do lote no dashboard.
4. **Escala, se precisar.** Carga por janela nas fatos e processamento em Cloud Run Job.

## Decisões em aberto

1. ~~**Quem exporta**~~: decidido, a Odeon exporta por todos os clientes. A chave é por organização e o cliente vai no lote.
2. **Formato do envio:** Parquet obrigatório, ou aceitamos CSV também? A ingestão já lê os dois.
3. **Horário:** até que hora o lote do dia precisa chegar para o aviso de "não mandou"?
4. **Tabelas de metas** (`Planejamento_*`): vêm do ERP ou de planilha mantida à parte?
5. **Histórico:** o cliente manda tudo desde 2018 todo dia, ou fazemos uma carga inicial completa e depois só os últimos meses?
