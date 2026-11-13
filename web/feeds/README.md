# Pacotes de origem

Cada pasta é um **pacote de origem**: o contrato das tabelas oficiais de um sistema e as receitas SQL (DuckDB) que as levam às tabelas dos moldes. O desenho completo está em `docs/ingestao-diaria.md`. Nada aqui é dado de cliente.

```
<pacote>/
  pacote.json                 oficiais (o que chega) · modelo (o que o tratamento entrega) · saidas (por molde)
  staging/<tabela>.sql        oficial → modelo: o Power Query traduzido (lê o_<oficial>)
  moldes/<molde>/<tabela>.sql modelo → tabela do molde, inclusive as colunas que eram DAX
```

## Regras das receitas

- Uma consulta por arquivo (SELECT ou WITH), sem `;` no meio.
- Staging lê `o_<tabela oficial>`. As receitas de molde leem as tabelas do modelo e as anteriores do mesmo molde (a ordem está em `saidas[].tabelas`).
- O "hoje" é `getvariable('data_referencia')`: a data do lote, e não a do servidor. Assim, reprocessar dá o mesmo resultado.
- Entregam exatamente as colunas do contrato do molde.
- Comentário curto em cada coluna derivada, dizendo a regra de negócio.

## Rodar e conferir (em `web/`)

```bash
# lote real (camada oficial)
node --import tsx scripts/feeds/montar.ts --pacote odeon-erp --data 2026-11-09 --entrada <pasta do lote> --saida <pasta>

# receitas dos moldes contra o publicado, a partir das tabelas extraídas do .pbix (camada modelo)
node --import tsx scripts/feeds/montar.ts --pacote odeon-erp --camada modelo --data 2026-11-09 --saida <pasta> \
  --entrada vnd_=<pasta vendas>/dados --entrada fin_=<pasta financeiro>/dados --entrada est_=<pasta estoque>/dados
node --import tsx scripts/feeds/conferir.ts --montado <pasta>/<molde> --referencia <publicado> --colunas <template.json>
```

## odeon-erp

ERP da Odeon Tecnologia, que exporta pelos seus clientes.

- **Modelo.** Os prefixos `vnd_`, `fin_` e `est_` são as tabelas como saem do Power Query de cada projeto Power BI (Vendas, Financeiro, Estoque).
- **Oficiais.** As colunas saíram da conversão de tipos do Power Query. São um rascunho, a confirmar com a primeira exportação da Odeon.
- **Staging.** Ainda não foi escrito: precisa de uma amostra real das tabelas oficiais.
- **Conferência (2026-11-13), camada modelo × publicado:** "Tudo igual" nos três moldes. Foram Vendas (8 tabelas, com `--data 2026-11-05`, a data do refresh do Power BI), Financeiro (11 tabelas, `--data 2026-11-09`) e Estoque (4 tabelas, `--data 2026-11-09`).
- **Atenção no staging:** colunas que dependem de "hoje" e que o Power Query calculava (`dias_ate_vencimento`, `analise_status`, `faixa_vencimento_ordem`, `pendentes` do Financeiro) estão hoje na camada do modelo. A tradução para o staging precisa calculá-las com `getvariable('data_referencia')`.
- **Correção (2026-11-13):** `estoque-movimentacao/movimento.venda_qtde` agora abate a devolução. O publicado de 09/11 somava: 771 linhas mudam e só essa coluna; o resto continua igual.
