# Implantar os dashboards fiscais numa organização

Passo a passo para levar os dashboards fiscais (EFD ICMS/IPI, EFD Contribuições, ECD e NF-e) e a Auditoria fiscal
a uma organização nova ou a um cliente novo. Como os arquivos viram tabelas está em
[arquivos-fiscais.md](arquivos-fiscais.md); a Auditoria, em [auditoria-fiscal.md](auditoria-fiscal.md).

Quem faz: o administrador da plataforma (passos 1, 3, 5 e 7) e a equipe da organização (passo 2). Os scripts rodam
em `web/`, com o `.env` de produção (`.env.vercel-production`), numa máquina com o código **igual ao de produção**.

---

## Visão geral

| # | Passo | Onde | Tempo típico |
|---|---|---|---|
| 1 | Organização e cliente criados | tela (administração) | minutos |
| 2 | Enviar os arquivos originais | tela (📁 Arquivos) | depende do volume |
| 3 | Organizar a pasta | tela ("Organizar pasta") | segundos |
| 4 | Ativar os moldes no cliente | tela ("Ativar para …") | segundos |
| 5 | Montar as tabelas e publicar | tela ("Montar tabelas") ou script | de segundos a ~25 min |
| 6 | Conferir os números | tela | 15 min |
| 7 | Auditoria fiscal | scripts | ~10 min + o tempo de extração |
| 8 | Atualização mensal | tela ou script | minutos |

## 1. Organização e cliente

- A organização existe e tem o seu espaço no bucket (`orgs/<org>/`). O cliente (empresa auditada) é criado na
  administração da organização: a pasta dele é `orgs/<org>/clientes/<cliente>/`.
- Confira os endereços no banco antes de rodar qualquer script: `organizations.slug` e `org_clients.slug`.
  Os scripts recebem esses slugs (`--org`, `--cliente`), nunca o nome.

## 2. Enviar os arquivos originais

Pelo **📁 Arquivos** do cliente: arquivos `.txt` do SPED (EFD ICMS/IPI, EFD Contribuições, ECD) e `.xml` de NF-e,
em qualquer quantidade e com qualquer nome. O explorador mostra se cada arquivo foi reconhecido (pelo registro
`0000`, ou pelo próprio XML) e de que empresa e período ele é.

Antes de enviar, combine com a organização:

- **Períodos**: todos os meses que a análise deve cobrir. A Auditoria só cruza meses que os dois arquivos têm.
- **Retificadoras**: mande a versão que vale. Se mandar as duas, a mais recente **substitui** a anterior do mesmo mês.
- **XML**: o mesmo XML às vezes vem duas vezes, como `NFe-<chave>.xml` e `procNFe<chave>.xml`. O dashboard NF-e
  soma as duas; a Auditoria conta cada item uma vez. Prefira mandar um só.
- **Volume**: anos de EFD Contribuições passam de alguns GB. Pela tela tudo bem enviar; montar, só pelo script (passo 5).

## 3. Organizar a pasta

"Organizar pasta" (no explorador) leva cada arquivo reconhecido para
`<espaço>/fiscal/<molde>/<CNPJ>/<aaaa-mm>/`, com prévia e confirmação. Arquivos não reconhecidos ficam onde estão.
"Montar tabelas" e o script também organizam o que estiver solto; organizar antes só deixa ver o resultado.

## 4. Ativar os moldes no cliente

Na lista de dashboards da organização, cada molde fiscal tem o botão **"Ativar para <cliente>"**. Ative os que o
cliente tem arquivos para: um dashboard por molde. Ativar não lê nada; o dashboard nasce vazio.

## 5. Montar as tabelas e publicar

**Pela tela** (gerenciador de dados do dashboard → Arquivos fiscais → **Montar tabelas**, depois **Publicar dados**):
serve quando os arquivos **a ler** somam menos de 250 MB, o que vale para um ou poucos meses, para a NF-e de um ano
e para a EFD ICMS/IPI de uma empresa pequena.

**Pelo script**, para históricos grandes (a primeira carga de anos de EFD Contribuições, uma ECD grande):

```bash
node --env-file=.env.vercel-production --conditions=react-server --import tsx scripts/fiscal/carregar-fiscal.ts \
  --molde efd-contribuicoes --org <org> --cliente <cliente>
```

Repita para cada molde (`efd-icms-ipi`, `efd-contribuicoes`, `ecd`, `nfe`). O script organiza, lê só o que é novo,
monta e publica; no fim mostra as tabelas com linhas e tamanho. Opções em [arquivos-fiscais.md](arquivos-fiscais.md#4-carga-pelo-script-volumes-grandes).

Na máquina que roda o script:

- **Memória**: use `node --max-old-space-size=6144` para a EFD Contribuições de muitos anos.
- **Disco**: cada arquivo é baixado para a pasta de trabalho e lido; reserve uns 20 GB livres. Leitura com
  milhões de linhas no DuckDB gasta disco temporário: se o disco encher, a carga para no meio (refaça; o que já
  foi lido é reaproveitado).
- **Tempo de referência**: 103 meses de EFD Contribuições (≈8 GB) levaram ~25 min na primeira carga; um mês
  novo, segundos.

## 6. Conferir os números

Abra cada dashboard e confira:

- **Nenhum visual com "Não foi possível calcular".**
- **Períodos**: o filtro de competência tem todos os meses enviados (a Visão geral da EFD Contribuições lê
  `paineis_todos_periodos`, com todos os períodos).
- **Dois ou três totais contra a fonte**, anotados: o valor de um mês da apuração (M200/M600) contra o recibo
  do SPED; a quantidade de notas de um mês contra o sistema da empresa; o total de um bloco contra o PVA.

## 7. Auditoria fiscal

Depois que os dashboards do passo 5 estão publicados, siga [auditoria-fiscal.md](auditoria-fiscal.md#implantar-num-espaço):
extrair, preparar, gerar o molde, carregar e conferir.

## 8. Atualização mensal

1. A organização envia os arquivos do mês (e retificadoras, se houver).
2. **Montar tabelas** e **Publicar dados** em cada dashboard fiscal (cabe na tela: só o mês novo é lido).
3. Auditoria: rode de novo a extração (só os arquivos novos são lidos), o preparo e a carga.

## Problemas conhecidos

| Sintoma | Causa | O que fazer |
|---|---|---|
| Dashboard quebra logo depois de atualizar um molde | o código em produção é anterior ao molde | deploy primeiro, molde depois ([regras](arquivos-fiscais.md#regras-que-já-custaram-caro)) |
| Servidor local (ex.: porta 3020) com erros | a pasta dele tem código antigo e lê o catálogo de produção | atualizar a pasta para `origin/dbi_app` junto com o deploy |
| "Montar tabelas" recusa pela tela | mais de 250 MB a ler | usar o script |
| Visão geral com um só mês | painel lendo `registros` (só o último mês) | painéis gerais devem ler `paineis_todos_periodos` |
| Carga parou com erro de disco | temporário do DuckDB encheu o disco | liberar espaço e rodar de novo |
| Valores da NF-e em dobro em algumas notas | XML enviado duas vezes com nomes diferentes | apagar uma das cópias e montar de novo |

## Lista de conferência

- [ ] Slugs da organização e do cliente conferidos no banco.
- [ ] Arquivos enviados e reconhecidos; retificadoras certas.
- [ ] Pasta organizada.
- [ ] Moldes ativados no cliente.
- [ ] Tabelas montadas e publicadas em cada dashboard.
- [ ] Nenhum visual com erro; todos os meses no filtro; dois ou três totais conferidos.
- [ ] Auditoria fiscal extraída, preparada e carregada; achados conferidos por amostra.
- [ ] Organização avisada de como enviar os próximos meses.
