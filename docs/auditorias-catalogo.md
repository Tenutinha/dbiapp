# Catálogo de auditorias fiscais e contábeis

Tudo o que dá para auditar com os arquivos fiscais que o DBI já guarda de um cliente: **195 auditorias em 15 temas**,
cada uma com o que confere, por que importa para o dono da empresa, os registros e campos necessários, o que já temos
e o que falta, a dificuldade e o tipo de resultado.

É um catálogo, não um plano fechado: serve para escolher o que implementar e para mostrar ao dono da empresa auditada
o alcance do trabalho. As 18 regras já implementadas (C01 a C12, X01 a X03, O01 a O03) estão em
[auditoria-fiscal.md](auditoria-fiscal.md) e não se repetem aqui; o formato dos dados está em
[arquivos-fiscais.md](arquivos-fiscais.md).

Para ir direto ao ponto: [as 15 de maior valor](#18-as-15-de-maior-valor-para-o-dono) e a
[ordem de implementação](#19-ordem-de-implementação-proposta).

---

## Como ler

**Os dados de partida** (cliente de referência: rede de varejo com cerca de 120 estabelecimentos, lucro real):

| Fonte | Período | O que traz |
|---|---|---|
| EFD Contribuições | 2018 a 2026 | todos os blocos (0, A, C, D, F, I, M, P, 1); notas e itens (C100, C170) |
| EFD ICMS/IPI | 2019 a 2026 | um arquivo por estabelecimento e mês: C100, C170, C190, D100, E110, E200 (ST), G (CIAP), H (inventário), K, 1 |
| ECD | por ano | plano de contas e referencial (I050, I051), saldos (I155), lançamentos (I200, I250), balanço e DRE (J100, J150) |
| XML de NF-e | 2022 a 2026 | por item: CST, CFOP, NCM, CEST, alíquotas e valores de ICMS, ST, IPI, PIS e COFINS, indicador de NCM monofásico |

**Cada auditoria tem:**

- **Confere:** a regra, de forma objetiva.
- **Por que importa:** dinheiro a recuperar, risco de autuação ou qualidade da informação, com a base legal quando há.
- **Dados:** registro e campos, com os nomes dos layouts em `web/src/lib/fiscal/layouts/` e das colunas da tabela
  `nfe_itens`. **Temos** = o dado está nos arquivos do espaço (pode ainda precisar ser extraído: ver a
  [seção 17](#17-o-que-falta-de-dado)). **Falta** = dado externo ou campo que o leitor não guarda.
- **Dificuldade:** baixa (uma consulta sobre tabelas que já existem), média (item a item, ou cruzamento de fontes),
  alta (volume grande, tabela externa por UF ou critério a definir).
- **Tributarista:** "sim" quando o achado depende de **interpretação tributária** e só vira oportunidade ou risco
  depois de validado por uma pessoa habilitada. São 71 das 195.
- **Resultado:** erro (a escrituração está inconsistente), risco (pode virar autuação), oportunidade de recuperação
  (tributo pago a maior ou crédito não tomado) ou indicador (leitura do negócio).

**Base legal.** Só está citado o que foi conferido na pesquisa ou no texto da lei. Onde não houve confirmação está
escrito "a confirmar". As fontes estão na [seção 20](#20-fontes), com a ressalva de que decisões de tribunais foram
lidas em portais, não no acórdão.

**Cuidados que valem para todo o catálogo** (aprendidos com as 18 regras atuais):

- Na EFD Contribuições, notas sem efeito em PIS/COFINS (transferências, remessas) podem ficar fora do C100. "Nota fora
  da Contribuições" só é indício em entrada de compra.
- Os XML não trazem a situação da nota (cancelada, denegada) e podem vir duplicados (`NFe-<chave>.xml` e
  `procNFe<chave>.xml`). Toda regra com XML deduplica por chave e item e convive com falsos achados de notas canceladas
  até termos a situação (RK03).
- Na EFD ICMS/IPI, o C170 só existe onde o Guia Prático o exige (em regra, notas de terceiros). O ICMS por item das
  saídas vem do C170 da EFD Contribuições, que também traz CST do ICMS, CFOP e valor do ICMS.
- O bloco C completo tem dezenas de milhões de linhas: regra de item roda **arquivo a arquivo**, nunca juntando notas
  e itens de todos os arquivos.
- Regra com dezenas de milhares de achados costuma ser regra que não se aplica ao cliente, não erro em massa.
- Os valores em reais só existem depois de rodar. O catálogo não promete valor.

## Resumo por tema

| # | Tema | Prefixo | Auditorias | Resultado principal |
|---|---|---|---|---|
| 1 | Consistência da EFD Contribuições | EC | 21 | erro |
| 2 | Consistência da EFD ICMS/IPI | EI | 18 | erro |
| 3 | Cruzamento entre obrigações | CZ | 15 | erro e risco |
| 4 | Créditos de PIS/COFINS não aproveitados | CR | 17 | oportunidade de recuperação |
| 5 | PIS/COFINS pago a maior | PM | 15 | oportunidade de recuperação |
| 6 | ICMS próprio | IC | 17 | risco e oportunidade |
| 7 | ICMS-ST | ST | 10 | oportunidade e risco |
| 8 | IPI | IP | 5 | erro e risco |
| 9 | CIAP (ICMS do ativo imobilizado) | CP | 8 | oportunidade de recuperação |
| 10 | Inventário e estoque | ES | 11 | risco |
| 11 | Contábil e contábil × fiscal | CT | 19 | risco e erro |
| 12 | Cadastro (NCM, CEST, CFOP, CST) | CD | 10 | erro |
| 13 | Riscos de autuação e malha | RK | 12 | risco |
| 14 | Indicadores gerenciais para o dono | IG | 13 | indicador |
| 15 | Reforma tributária (transição) | RT | 4 | risco e indicador |
| | **Total** | | **195** | |

Por tipo de resultado (uma auditoria pode ter mais de um): 60 trazem oportunidade de recuperação, 73 apontam risco,
73 apontam erro de escrituração e 40 são indicadores.

Os prefixos têm duas letras para não se confundir com os códigos das regras já implementadas (C, X e O). Ao
implementar, cada regra recebe o código do grupo do dashboard, como descrito em
[auditoria-fiscal.md](auditoria-fiscal.md#acrescentar-uma-regra).

---

## 1. Consistência da EFD Contribuições (EC)

A escrituração contra ela mesma. Já implementadas: C01 a C12 (ver [auditoria-fiscal.md](auditoria-fiscal.md)). As
regras abaixo são novas.

#### EC01 · COFINS: CST tributado sem valor e CST sem tributação com valor
- **Confere:** o mesmo que as C09 e C10 já fazem para o PIS, agora para `VL_COFINS` × `CST_COFINS`.
- **Por que importa:** a COFINS vale 4,6 vezes o PIS; o erro que escapa hoje é o de maior valor. Débito a menor é risco de autuação; a maior é recuperação.
- **Dados:** EFD Contribuições C170: `CST_COFINS`, `VL_BC_COFINS`, `ALIQ_COFINS`, `VL_COFINS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EC02 · Alíquota incompatível com o regime
- **Confere:** no regime não cumulativo (`0110.COD_INC_TRIB` = 1), itens com CST 01 ou 50 e alíquota diferente de 1,65% (PIS) e 7,6% (COFINS); pares incoerentes (PIS 1,65% com COFINS 3%); alíquota de PIS igual à de COFINS.
- **Por que importa:** alíquota trocada gera débito ou crédito errado em toda nota do item. Base legal: Leis 10.637/2002 e 10.833/2003, art. 2º.
- **Dados:** 0110: `COD_INC_TRIB`; C170: `CST_PIS`, `ALIQ_PIS`, `CST_COFINS`, `ALIQ_COFINS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não (as exceções de alíquota diferenciada, CST 02, ficam fora) · **Resultado:** erro

#### EC03 · Base de cálculo maior que o valor do item, ou PIS e COFINS com bases diferentes
- **Confere:** `VL_BC_PIS` > `VL_ITEM` − `VL_DESC` (mais frete, seguro e despesas rateados), e `VL_BC_PIS` ≠ `VL_BC_COFINS` no mesmo item.
- **Por que importa:** base inflada na saída é tributo pago a maior; na entrada, crédito a maior (risco de glosa).
- **Dados:** C170: `VL_ITEM`, `VL_DESC`, `VL_BC_PIS`, `VL_BC_COFINS`; C100: `VL_FRT`, `VL_SEG`, `VL_OUT_DA`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EC04 · Apuração do débito (M210/M610) × soma dos documentos
- **Confere:** por código de contribuição, `VL_REC_BRT` e `VL_BC_CONT` do M210/M610 contra a soma das receitas dos documentos (C170 de saída, C175, C181/C185, C381/C385, C481/C485, C870, A170, F100) com o mesmo CST.
- **Por que importa:** é o cruzamento que a Receita faz por dentro do arquivo. Diferença para menos é débito não declarado; para mais, tributo pago sem documento que o sustente.
- **Dados:** M210: `COD_CONT`, `VL_REC_BRT`, `VL_BC_CONT`, `ALIQ_PIS`, `VL_CONT_APUR`; M610 idem; registros de receita dos blocos A, C, D e F. **Temos** (o bloco M já está publicado; a soma do bloco C vem do `bloco_c_resumo`).
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro

#### EC05 · Apuração do crédito (M105/M505) × soma dos documentos
- **Confere:** por natureza da base de crédito e CST, `VL_BC_PIS_TOT` do M105 contra a soma das bases dos documentos de entrada (C170, C191/C195, C395/C396, C501/C505, D101/D105, D501/D505, A170, F100, F120, F130, F150).
- **Por que importa:** crédito escriturado no documento que não chegou à apuração é dinheiro deixado na mesa; crédito na apuração sem documento é risco de glosa.
- **Dados:** M105: `NAT_BC_CRED`, `CST_PIS`, `VL_BC_PIS_TOT`, `VL_BC_PIS_CUM`, `VL_BC_PIS_NC`, `VL_BC_PIS`; M505 idem; documentos de entrada. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e oportunidade de recuperação

#### EC06 · Entrada com CST de crédito e CFOP que não gera crédito
- **Confere:** C170 de entrada com CST 50 a 56 cujo CFOP não está na tabela "CFOP – Operações Geradoras de Créditos" do SPED: o PVA não leva esse item à base do M105.
- **Por que importa:** ou o CFOP está errado e o crédito se perdeu (recuperação), ou o CST está errado. A diferença aparece na EC05; esta regra aponta o item.
- **Dados:** C170: `CFOP`, `CST_PIS`, `VL_BC_PIS`, `VL_PIS`. **Temos.** **Falta:** a tabela de CFOP geradores de crédito (pública, no portal do SPED).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro e oportunidade de recuperação

#### EC07 · Aritmética do crédito (M100/M500)
- **Confere:** `VL_CRED` = `VL_BC_PIS` × `ALIQ_PIS`; `VL_CRED_DISP` = `VL_CRED` + `VL_AJUS_ACRES` − `VL_AJUS_REDUC` − `VL_CRED_DIF`; `SLD_CRED` = `VL_CRED_DISP` − `VL_CRED_DESC`; soma dos M110/M510 = ajustes do M100/M500.
- **Por que importa:** erro de soma na apuração muda o valor a pagar do mês.
- **Dados:** M100, M110, M500, M510 (todos os campos de valor). **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EC08 · Aritmética da contribuição (M200/M600) e códigos de receita (M205/M605)
- **Confere:** `VL_TOT_CONT_NC_DEV` = `VL_TOT_CONT_NC_PER` − `VL_TOT_CRED_DESC` − `VL_TOT_CRED_DESC_ANT`; `VL_CONT_NC_REC` = devido − `VL_RET_NC` − `VL_OUT_DED_NC`; `VL_TOT_CONT_REC` = não cumulativo + cumulativo; soma do `VL_DEBITO` dos M205/M605 = `VL_TOT_CONT_REC`.
- **Por que importa:** é o número que vai para a DCTF e para o DARF.
- **Dados:** M200, M205, M600, M605. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EC09 · Continuidade do saldo de créditos entre os meses
- **Confere:** o `SLD_CRED` do M100/M500 de um mês aparece no 1100/1500 do mês seguinte (`PER_APU_CRED`, `SD_CRED_DISP_EFD`); o `SLD_CRED_FIM` do 1100/1500 se mantém de um arquivo para o outro; nenhum saldo some nem nasce sem origem.
- **Por que importa:** saldo de crédito que "some" numa virada de mês é dinheiro perdido; saldo que aparece sem origem é glosa certa.
- **Dados:** M100/M500: `COD_CRED`, `SLD_CRED`; 1100/1500: `PER_APU_CRED`, `COD_CRED`, `VL_TOT_CRED_APU`, `SD_CRED_DISP_EFD`, `VL_CRED_DESC_EFD`, `SLD_CRED_FIM`. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e oportunidade de recuperação

#### EC10 · Rateio dos créditos (0111) × receitas apuradas
- **Confere:** quando o método é o rateio proporcional (`0110.IND_APRO_CRED` = 2), as receitas do 0111 batem com as do M210, M400 e M800, e a divisão do M105 (`VL_BC_PIS_CUM` × `VL_BC_PIS_NC`) segue a proporção.
- **Por que importa:** o rateio decide quanto do crédito é aproveitado e a que tipo de receita ele se vincula (o que define se pode ser ressarcido).
- **Dados:** 0110: `IND_APRO_CRED`; 0111: `REC_BRU_NCUM_TRIB_MI`, `REC_BRU_NCUM_NT_MI`, `REC_BRU_NCUM_EXP`, `REC_BRU_CUM`, `REC_BRU_TOTAL`; M105, M210, M400. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro

#### EC11 · Receitas sem tributação (M400/M800) × documentos, com natureza da receita
- **Confere:** `VL_TOT_REC` do M400/M800 por CST (04, 05, 06, 07, 08, 09) contra a soma dos itens com esse CST; todo M410/M810 tem `NAT_REC` válido para o CST (Tabelas 4.3.10 a 4.3.17 do SPED).
- **Por que importa:** receita declarada como não tributada sem natureza que a justifique é o primeiro alvo de malha; a Receita compara a natureza com o NCM vendido.
- **Dados:** M400/M800: `CST_PIS`, `VL_TOT_REC`; M410/M810: `NAT_REC`, `VL_REC`; itens de saída. **Temos.** **Falta:** as Tabelas 4.3.10 a 4.3.17 (públicas).
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e risco

#### EC12 · Retenções na fonte: informadas, deduzidas e saldo
- **Confere:** soma do F600 (`VL_RET_PIS`, `VL_RET_COFINS`) × `VL_RET_NC` do M200/M600 × saldos do 1300/1700 (`VL_RET_APU`, `VL_RET_DED`, `SLD_RET`); retenção com saldo parado.
- **Por que importa:** retenção sofrida e não deduzida é tributo pago duas vezes; o saldo pode ser deduzido nos meses seguintes ou restituído. Base legal: Lei 10.833/2003, arts. 30 a 36 (a confirmar o alcance para o caso).
- **Dados:** F600: `IND_NAT_RET`, `DT_RET`, `VL_BC_RET`, `VL_RET_PIS`, `VL_RET_COFINS`, `CNPJ`; M200: `VL_RET_NC`; 1300/1700. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** oportunidade de recuperação

#### EC13 · Nota cancelada com valores, e nota regular sem itens
- **Confere:** C100 com `COD_SIT` 02, 03, 04 ou 05 e campos de valor preenchidos ou C170 filhos; C100 regular de entrada sem nenhum C170.
- **Por que importa:** nota cancelada com crédito é crédito indevido; nota sem itens não entra na apuração.
- **Dados:** C100: `COD_SIT`, `VL_DOC`, `VL_PIS`, `VL_COFINS`; C170. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EC14 · Documento fora do período da escrituração
- **Confere:** C100 de entrada com `DT_E_S` (ou `DT_DOC`) anterior ao mês do arquivo: crédito de outro período escriturado como do mês; saída com `DT_DOC` fora do mês.
- **Por que importa:** crédito extemporâneo tem forma própria de escrituração; lançado no mês errado, é ponto de glosa. Também mostra atraso do recebimento fiscal.
- **Dados:** 0000: `DT_INI`, `DT_FIN`; C100: `DT_DOC`, `DT_E_S`, `IND_OPER`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### EC15 · Cadastros internos: participante, item e estabelecimento
- **Confere:** `COD_PART` do C100 sem 0150; `COD_ITEM` do C170 sem 0200; C010 com CNPJ fora do 0140; CNPJ ou CPF do 0150 com dígito verificador inválido.
- **Por que importa:** qualidade da informação; cadastro quebrado impede os cruzamentos e gera advertência no PVA.
- **Dados:** 0140: `CNPJ`; 0150: `COD_PART`, `CNPJ`, `CPF`; 0200: `COD_ITEM`; C010; C100: `COD_PART`; C170: `COD_ITEM`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EC16 · Lacunas: estabelecimento e mês sem movimento
- **Confere:** estabelecimento do 0140 sem C010 num mês em que tem EFD ICMS/IPI com movimento; mês sem arquivo; queda brusca do número de notas de um estabelecimento.
- **Por que importa:** estabelecimento que ficou fora da centralizada é receita não declarada (risco) ou crédito não tomado (oportunidade).
- **Dados:** 0000, 0140, C010 (Contribuições); 0000 e C100 (ICMS/IPI). **Temos** (a tabela `cobertura` já tem o começo disso).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco e oportunidade

#### EC17 · Mapa de retificações
- **Confere:** arquivos com `TIPO_ESCRIT` = 1 e `NUM_REC_ANTERIOR`: quais meses foram retificados, quantas vezes e quanto mudou o valor a recolher.
- **Por que importa:** retificação depois de 5 anos não é aceita, e a que reduz débito pode abrir malha. O dono vê o histórico de retrabalho. Base legal: IN RFB 1.252/2012, art. 11 (a confirmar a redação atual).
- **Dados:** 0000: `TIPO_ESCRIT`, `NUM_REC_ANTERIOR`, `DT_INI`; M200/M600. **Temos** só a última versão de cada mês (a retificadora substitui a original no espaço). **Falta:** guardar as versões anteriores para medir a diferença.
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** indicador

#### EC18 · Conta contábil nos documentos
- **Confere:** `COD_CTA` vazio nos registros que o pedem, ou conta que não existe no 0500 nem no plano da ECD (I050).
- **Por que importa:** o Guia Prático da EFD Contribuições exige a conta contábil desde 11/2017 (a confirmar a data); a falta gera multa por informação omitida e impede o cruzamento com a ECD.
- **Dados:** 0500: `COD_CTA`, `COD_CTA_REF`; `COD_CTA` de C170, C175, F100, M400 e outros; ECD I050: `COD_CTA`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EC19 · Processos referenciados × operações com exigibilidade suspensa
- **Confere:** processos do 1010/1020 e dos C111/D111 contra os itens com CST 09 (suspensão) ou ajustes de redução do M220/M620 que citam processo; decisão informada (`DESC_DEC_JUD`, `DT_SENT_JUD`).
- **Por que importa:** mostra ao dono quanto tributo deixou de ser pago com base em ação judicial e se a ação ainda sustenta isso (risco se a decisão caiu).
- **Dados:** 1010: `NUM_PROC`, `IND_NAT_ACAO`, `DESC_DEC_JUD`, `DT_SENT_JUD`; 1020; M220/M620: `IND_AJ`, `VL_AJ`, `COD_AJ`, `NUM_DOC`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim (situação de cada processo) · **Resultado:** indicador e risco

#### EC20 · Ajustes manuais da apuração (M110, M220, M510, M620)
- **Confere:** todos os ajustes de acréscimo e redução, por código (`COD_AJ`), valor, descrição e mês; ajustes sem documento (`NUM_DOC`) ou sem detalhamento (M115/M225).
- **Por que importa:** ajuste manual é onde entram créditos extemporâneos, exclusões judiciais e correções. É o ponto mais visado numa fiscalização e o menos documentado.
- **Dados:** M110/M510 e M220/M620: `IND_AJ`, `VL_AJ`, `COD_AJ`, `NUM_DOC`, `DESCR_AJ`, `DT_REF`; M115: `DET_VALOR_AJ`, `CST_PIS`, `DET_BC_CRED`, `DET_ALIQ`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim (mérito de cada ajuste) · **Resultado:** indicador e risco

#### EC21 · Contribuição previdenciária sobre a receita bruta (bloco P)
- **Confere:** onde houver bloco P: `VL_BC_CONT` = `VL_REC_ATIV_ESTAB` − `VL_EXC`; `VL_CONT_APU` = base × `ALIQ_CONT`; receita do P100 × 0145 × receita do bloco M.
- **Por que importa:** o comércio varejista esteve na desoneração da folha até 2018 (a confirmar para o cliente); erro nesse período ainda pode ser cobrado ou restituído dentro de 5 anos.
- **Dados:** 0145: `VL_REC_TOT`, `VL_REC_ATIV`; P100: `VL_REC_TOT_EST`, `COD_ATIV_ECON`, `VL_REC_ATIV_ESTAB`, `VL_EXC`, `VL_BC_CONT`, `ALIQ_CONT`, `VL_CONT_APU`; P200. **Temos** (se o cliente escriturou).
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** erro

---

## 2. Consistência da EFD ICMS/IPI (EI)

Um arquivo por estabelecimento e mês. Regras de nota e de item rodam arquivo a arquivo.

#### EI01 · Analítico (C190) × itens (C170)
- **Confere:** por nota com C170, a soma de `VL_BC_ICMS`, `VL_ICMS`, `VL_BC_ICMS_ST`, `VL_ICMS_ST` e `VL_IPI` dos itens, por CST, CFOP e alíquota, contra o C190.
- **Por que importa:** o C190 é o que vai para a apuração; se não bate com os itens, o crédito ou o débito do mês está errado.
- **Dados:** EFD ICMS/IPI C170: `CST_ICMS`, `CFOP`, `ALIQ_ICMS`, `VL_ITEM`, `VL_DESC`, `VL_BC_ICMS`, `VL_ICMS`, `VL_BC_ICMS_ST`, `VL_ICMS_ST`, `VL_IPI`; C190: os mesmos totais e `VL_OPR`. **Temos** nos arquivos (C170 só existe onde o Guia Prático o exige: em regra, notas de terceiros).
- **Dificuldade:** média (volume) · **Tributarista:** não · **Resultado:** erro

#### EI02 · Nota (C100) × analítico (C190)
- **Confere:** `VL_DOC` do C100 = soma do `VL_OPR` dos C190; `VL_ICMS`, `VL_ICMS_ST` e `VL_IPI` do C100 = soma dos C190.
- **Por que importa:** validação básica que o PVA só adverte; divergência aqui costuma ser nota digitada à mão.
- **Dados:** C100: `VL_DOC`, `VL_BC_ICMS`, `VL_ICMS`, `VL_BC_ICMS_ST`, `VL_ICMS_ST`, `VL_IPI`; C190. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EI03 · ICMS diferente de base × alíquota
- **Confere:** no C190 e no C170, `VL_ICMS` ≠ `VL_BC_ICMS` × `ALIQ_ICMS` ÷ 100 (tolerância de centavos por item).
- **Por que importa:** crédito a maior é risco de glosa com multa; débito a maior é ICMS pago sem dever.
- **Dados:** C170 e C190: `VL_BC_ICMS`, `ALIQ_ICMS`, `VL_ICMS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EI04 · Débitos e créditos da apuração (E110) × documentos
- **Confere:** `VL_TOT_DEBITOS` = soma do `VL_ICMS` dos analíticos de saída (C190, C490, C590, C850, C890, D190, D590, CFOP 5, 6 e 7); `VL_TOT_CREDITOS` = soma dos de entrada (CFOP 1, 2 e 3), conforme a regra de cada campo no Guia Prático.
- **Por que importa:** é a conferência central da SEFAZ. Débito menor que os documentos é auto de infração; crédito menor é ICMS pago a mais.
- **Dados:** E110: `VL_TOT_DEBITOS`, `VL_TOT_CREDITOS`; analíticos dos blocos C e D. **Temos** (os analíticos já estão somados em `paineis_todos_periodos`).
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e risco

#### EI05 · Aritmética da apuração (E110) e obrigações a recolher (E116)
- **Confere:** `VL_SLD_APURADO` = débitos + ajustes de débito + estornos de crédito − créditos − ajustes de crédito − estornos de débito − saldo credor anterior; `VL_ICMS_RECOLHER` = saldo − `VL_TOT_DED`; soma do `VL_OR` dos E116 = `VL_ICMS_RECOLHER` + `DEB_ESP`.
- **Por que importa:** o valor da guia sai daqui.
- **Dados:** E110 (todos os campos); E116: `COD_OR`, `VL_OR`, `DT_VCTO`, `COD_REC`, `MES_REF`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EI06 · Continuidade dos saldos credores (ICMS, ST, DIFAL/FCP e IPI)
- **Confere:** por estabelecimento, `VL_SLD_CREDOR_TRANSPORTAR` do mês = `VL_SLD_CREDOR_ANT` do mês seguinte (E110); o mesmo para E210 (`VL_SLD_CRED_ST_TRANSPORTAR` × `VL_SLD_CRED_ANT_ST`), E310 e E520 (`VL_SC_IPI` × `VL_SD_ANT_IPI`).
- **Por que importa:** saldo credor que não é transportado é crédito perdido; saldo que cresce do nada é autuação. Com ~120 estabelecimentos, é comum acontecer em troca de sistema ou de contador.
- **Dados:** E110, E210, E310, E520 (campos de saldo). **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro e oportunidade de recuperação

#### EI07 · Ajustes da apuração (E111, C197) × totais do E110
- **Confere:** soma dos E111 pelo tipo do código (3º e 4º caracteres do `COD_AJ_APUR`) contra `VL_TOT_AJ_DEBITOS`, `VL_ESTORNOS_CRED`, `VL_TOT_AJ_CREDITOS`, `VL_ESTORNOS_DEB` e `VL_TOT_DED`; soma dos C197/D197 contra `VL_AJ_DEBITOS` e `VL_AJ_CREDITOS`.
- **Por que importa:** ajuste que não fecha com o total é valor lançado sem lastro.
- **Dados:** E111: `COD_AJ_APUR`, `DESCR_COMPL_AJ`, `VL_AJ_APUR`; C197: `COD_AJ`, `VL_ICMS`, `VL_OUTROS`; E110. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro

#### EI08 · CST do ICMS × valores
- **Confere:** CST 00 sem ICMS; CST 40, 41 ou 50 com ICMS; CST 60 com débito próprio; CST 10, 30 ou 70 sem base de ST (na emissão como substituto); CST 20 ou 70 sem `VL_RED_BC`; CST 90 em volume alto.
- **Por que importa:** CST errado é o erro mais comum de cadastro e muda o imposto do item em toda venda.
- **Dados:** C170 e C190: `CST_ICMS`, `VL_BC_ICMS`, `ALIQ_ICMS`, `VL_ICMS`, `VL_BC_ICMS_ST`, `VL_ICMS_ST`, `VL_RED_BC`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EI09 · CFOP × UF do participante
- **Confere:** CFOP 1 ou 5 com participante de outra UF; CFOP 2 ou 6 com participante da mesma UF; CFOP 3 ou 7 com participante do Brasil.
- **Por que importa:** troca de CFOP interno por interestadual muda a alíquota, o DIFAL e a partilha entre estados.
- **Dados:** 0000: `UF`; 0150: `COD_PART`, `COD_MUN` (os dois primeiros dígitos são a UF), `COD_PAIS`; C100: `COD_PART`; C170/C190: `CFOP`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EI10 · Chave inválida, nota duplicada e saltos de numeração
- **Confere:** as C11 e C12 aplicadas à EFD ICMS/IPI (chave com 44 dígitos e dígito verificador; mesma chave em mais de um C100 regular, em qualquer estabelecimento ou mês); na emissão própria, números que faltam na sequência de cada série.
- **Por que importa:** crédito em duplicidade é autuação com multa; número que falta é nota emitida e não escriturada, ou inutilização não informada.
- **Dados:** C100: `IND_EMIT`, `COD_MOD`, `COD_SIT`, `SER`, `NUM_DOC`, `CHV_NFE`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro e risco

#### EI11 · Situação do documento × valores
- **Confere:** `COD_SIT` 02, 03, 04 ou 05 (cancelada, denegada, inutilizada) com valores ou analítico; volume de extemporâneas (01, 07) e de complementares (06) por estabelecimento.
- **Por que importa:** crédito de nota cancelada é infração; muitas extemporâneas mostram atraso do fiscal.
- **Dados:** C100: `COD_SIT`, `VL_DOC`, `VL_ICMS`; C190. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro e indicador

#### EI12 · Lacunas: estabelecimento e mês sem arquivo
- **Confere:** mês que falta na sequência de cada estabelecimento; arquivo sem movimento (`IND_MOV` dos blocos) entre meses com movimento; arquivo com `COD_FIN` = 1 (retificador).
- **Por que importa:** EFD não entregue tem multa mensal por estabelecimento e pode suspender a inscrição estadual.
- **Dados:** 0000: `COD_FIN`, `DT_INI`, `DT_FIN`, `CNPJ`, `IE`, `IND_PERFIL`; C001/E001: `IND_MOV`. **Temos** (o painel de dados fiscais já tem o mapa por empresa e mês).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### EI13 · Item e unidade: cadastro e conversão
- **Confere:** `COD_ITEM` de C170, H010 ou K200 sem 0200; `UNID` do C170 diferente da `UNID_INV` do 0200 sem fator de conversão (0220); unidade sem 0190.
- **Por que importa:** sem conversão de unidade, o levantamento de estoque (ES04) dá diferença falsa: é assim que nasce uma autuação por omissão de saídas que não existiu.
- **Dados:** 0190: `UNID`; 0200: `COD_ITEM`, `UNID_INV`; 0220: `UNID_CONV`, `FAT_CONV`; C170: `COD_ITEM`, `UNID`, `QTD`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EI14 · Datas da nota
- **Confere:** entrada com `DT_E_S` anterior à `DT_DOC`; `DT_E_S` fora do período; dias entre emissão e escrituração por estabelecimento; entrada escriturada meses depois da emissão.
- **Por que importa:** crédito lançado com atraso sem a marca de extemporâneo é questionável; a demora média é um indicador do processo de recebimento.
- **Dados:** 0000: `DT_INI`, `DT_FIN`; C100: `DT_DOC`, `DT_E_S`, `IND_OPER`, `COD_SIT`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco e indicador

#### EI15 · Transporte, energia e comunicação: documento × analítico
- **Confere:** D100 × D190, C500 × C590 e D500 × D590 (mesmas regras das EI02 e EI03); chave do CT-e válida; CT-e duplicado.
- **Por que importa:** frete e energia são os maiores créditos fora das mercadorias.
- **Dados:** D100: `CHV_CTE`, `VL_DOC`, `VL_SERV`, `VL_BC_ICMS`, `VL_ICMS`; D190; C500: `VL_DOC`, `VL_FORN`, `VL_BC_ICMS`, `VL_ICMS`; C590; D500; D590. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EI16 · Venda a consumidor: NFC-e, SAT e ECF
- **Confere:** C100 modelo 65 × C190; C800 × C850 (SAT); C405 (`VL_BRT`) × C420 × C490 (ECF); saltos em `NUM_DOC` (NFC-e), `NUM_CFE` e `CRZ`/`NUM_COO_FIN`.
- **Por que importa:** é onde está quase toda a receita do varejo; cupom que falta na sequência é venda fora da apuração.
- **Dados:** C100 (modelo 65), C190, C400, C405, C420, C490, C800, C850, C860, C890. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e risco

#### EI17 · Apuração da ST (E210) e do DIFAL/FCP (E310): aritmética e obrigações
- **Confere:** E210: saldo devedor = `VL_RETENÇAO_ST` + outros débitos + ajustes − saldo anterior − devoluções − ressarcimentos − outros créditos; `VL_ICMS_RECOL_ST` = saldo − deduções; soma dos E250 = valor a recolher. E310 e E316 do mesmo modo.
- **Por que importa:** guias de ST e de DIFAL saem daqui, por UF de destino.
- **Dados:** E200: `UF`; E210 (todos os campos); E220; E250; E300; E310; E316. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### EI18 · Bloco 1: obrigatoriedade × conteúdo
- **Confere:** indicadores do 1010 marcados "S" sem os registros correspondentes (e o inverso): cartões (`IND_CART`), combustíveis (`IND_COMB`), créditos fiscais (`IND_CCRF`), ressarcimento de ST (`IND_REST_RESSARC_COMPL_ICMS`).
- **Por que importa:** informação obrigatória omitida tem multa própria em vários estados.
- **Dados:** 1010 (todos os indicadores); 1200, 1300, 1600. **Temos.** O layout do leitor tem o 1600; o 1601, que o substituiu, **falta** (a confirmar se os arquivos recentes o trazem).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

---

## 3. Cruzamento entre obrigações (CZ)

Já implementadas: X01, X02 e X03. Lembrar: saída fora da EFD Contribuições não é achado; os XML não trazem a situação
da nota e podem vir duplicados (`NFe-<chave>.xml` e `procNFe<chave>.xml`): toda regra com XML deduplica por chave e item.

#### CZ01 · Nota emitida pela empresa (XML) fora da EFD ICMS/IPI
- **Confere:** chave de XML com emitente da empresa que não aparece em nenhum C100 do estabelecimento emitente.
- **Por que importa:** é a malha mais comum das SEFAZ (documento autorizado e não escriturado = omissão de saída), com cobrança do ICMS e multa sobre o valor da operação.
- **Dados:** XML (`nfe_itens`): `chnfe`, `emit_cnpj`, `ide_mod`, `emissao_data`, `prod_vprod`, `imposto_icms_vicms`; EFD ICMS/IPI C100: `CHV_NFE`, `COD_SIT`. **Temos**, de 2022 em diante. **Falta:** a situação da nota (uma cancelada aparece aqui como falso achado).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### CZ02 · Nota recebida (XML de terceiro) fora da EFD ICMS/IPI
- **Confere:** chave de XML com destinatário da empresa, CFOP de venda ou de transferência, que não está em nenhum C100 de entrada do estabelecimento destinatário.
- **Por que importa:** entrada não escriturada é presunção de omissão de receita na maioria dos regulamentos estaduais; e é crédito de ICMS que pode não ter sido tomado.
- **Dados:** XML: `chnfe`, `emit_cnpj`, `dest_cnpj`, `prod_cfop`, `emissao_data`, `imposto_icms_vicms`; EFD ICMS/IPI C100: `CHV_NFE`, `IND_OPER`. **Temos.** **Falta:** situação e manifestação do destinatário.
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco e oportunidade

#### CZ03 · Nota escriturada sem XML
- **Confere:** C100 regular modelo 55, nos meses e estabelecimentos com XML, cuja chave não tem XML na pasta.
- **Por que importa:** o XML tem de ser guardado por 5 anos e é a prova do crédito; nota escriturada sem XML pode ser cancelada, de fornecedor inidôneo ou só um arquivo que não foi baixado.
- **Dados:** EFD ICMS/IPI e Contribuições C100: `CHV_NFE`, `COD_MOD`, `COD_SIT`, `IND_EMIT`; XML: `chnfe`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### CZ04 · Valores da nota: XML × EFD ICMS/IPI
- **Confere:** por chave, soma dos itens do XML (`prod_vprod`, `imposto_icms_vbc`, `imposto_icms_vicms`, `imposto_icmsst_vbcst`, `imposto_icmsst_vicmsst`, `imposto_ipi_vipi`) contra `VL_MERC`, `VL_BC_ICMS`, `VL_ICMS`, `VL_BC_ICMS_ST`, `VL_ICMS_ST` e `VL_IPI` do C100.
- **Por que importa:** crédito maior que o destacado no documento é glosa certa; menor, é crédito deixado.
- **Dados:** os campos acima. **Temos.** **Falta:** o total da nota (`vNF`), frete, seguro e outras despesas do XML, que o leitor não guarda: sem eles não dá para conferir o `VL_DOC`.
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro e oportunidade

#### CZ05 · Item a item: XML do fornecedor × C170 de entrada
- **Confere:** por chave e número do item: quantidade, valor, ICMS, ST e IPI; o CFOP de entrada é o par do CFOP do fornecedor (5102 → 1102, 6401 → 2403…); NCM do XML × NCM do item no 0200.
- **Por que importa:** mostra onde o recebimento "reclassifica" a mercadoria: é a origem dos erros de crédito e de estoque.
- **Dados:** XML: `prod_item`, `prod_cprod`, `prod_ncm`, `prod_cfop`, `prod_qcom`, `prod_vprod`, impostos; EFD ICMS/IPI C170: `NUM_ITEM`, `COD_ITEM`, `QTD`, `VL_ITEM`, `CFOP`, `CST_ICMS`, `VL_ICMS`; 0200: `COD_NCM`. **Temos.**
- **Dificuldade:** média (volume; a ordem dos itens pode mudar na escrituração) · **Tributarista:** não · **Resultado:** erro

#### CZ06 · Mesma nota nas duas EFD: tributos e situação
- **Confere:** além do `VL_DOC` (X02): `VL_PIS`, `VL_COFINS`, `VL_MERC`, `VL_ICMS`, `COD_SIT`, `IND_OPER` e mês de escrituração da mesma chave nos dois arquivos.
- **Por que importa:** as duas escriturações saem do mesmo sistema e deveriam ser idênticas; quando não são, uma está errada, e o fisco federal e o estadual trocam esses dados.
- **Dados:** C100 das duas EFD: `CHV_NFE`, `COD_SIT`, `IND_OPER`, `VL_DOC`, `VL_MERC`, `VL_ICMS`, `VL_PIS`, `VL_COFINS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CZ07 · Item a item entre as duas EFD
- **Confere:** para a mesma chave e item: `CST_PIS`, `CST_COFINS`, `CFOP`, `VL_ITEM`, `VL_BC_PIS` e `VL_PIS` do C170 da EFD ICMS/IPI contra o C170 da EFD Contribuições.
- **Por que importa:** a EFD ICMS/IPI também leva os campos de PIS/COFINS do item; a divergência mostra retrabalho manual numa das duas.
- **Dados:** C170 das duas EFD (campos acima). **Temos.**
- **Dificuldade:** média (volume) · **Tributarista:** não · **Resultado:** erro

#### CZ08 · Cadastro de itens entre as duas EFD
- **Confere:** mesmo `COD_ITEM` com `COD_NCM`, `DESCR_ITEM`, `UNID_INV` ou `TIPO_ITEM` diferentes no 0200 da EFD ICMS/IPI e no da EFD Contribuições, ou entre estabelecimentos.
- **Por que importa:** NCM diferente para o mesmo produto muda monofásico, ST e alíquota: é a raiz de vários achados de valor.
- **Dados:** 0200 das duas EFD: `COD_ITEM`, `DESCR_ITEM`, `COD_BARRA`, `UNID_INV`, `TIPO_ITEM`, `COD_NCM`. **Temos** (dimensão `itens` de cada dashboard).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CZ09 · PIS e COFINS do XML × item escriturado (emissão própria)
- **Confere:** estende a X03 à COFINS e ao item: CST, base, alíquota e valor de PIS e COFINS de cada item do XML emitido contra o C170 da EFD Contribuições.
- **Por que importa:** o que foi destacado no documento e o que foi levado à apuração têm de ser a mesma coisa; a diferença é débito a maior ou a menor.
- **Dados:** XML: `imposto_pis_cst`, `imposto_pis_vbc`, `imposto_pis_ppis`, `imposto_pis_vpis`, `imposto_cofins_cst`, `imposto_cofins_vbc`, `imposto_cofins_pcofins`, `imposto_cofins_vcofins`; C170 da Contribuições. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro

#### CZ10 · Nota escriturada em estabelecimento diferente do XML
- **Confere:** chave cujo destinatário (ou emitente) no XML é um CNPJ da empresa e o C100 está no arquivo de outro estabelecimento.
- **Por que importa:** crédito de ICMS tomado pelo estabelecimento errado é indevido nele e perdido no certo; acontece muito em rede com compra centralizada.
- **Dados:** XML: `chnfe`, `emit_cnpj`, `dest_cnpj`; EFD ICMS/IPI 0000: `CNPJ`; C100: `CHV_NFE`; Contribuições C010: `CNPJ`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro e risco

#### CZ11 · Transferências entre estabelecimentos: saída de um × entrada do outro
- **Confere:** toda nota de transferência (CFOP 5152, 5409, 6152, 6409 e pares de entrada) emitida por um estabelecimento está escriturada na entrada do outro, no mesmo mês, com os mesmos valores de mercadoria, ICMS e ST.
- **Por que importa:** numa rede, a transferência é a maior operação em número de notas. Débito numa ponta sem crédito na outra é ICMS pago em dobro; crédito sem débito é autuação.
- **Dados:** EFD ICMS/IPI C100 de todos os estabelecimentos: `CHV_NFE`, `IND_OPER`, `IND_EMIT`, `VL_DOC`, `VL_ICMS`, `VL_ICMS_ST`; C190: `CFOP`. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e oportunidade de recuperação

#### CZ12 · Frete: CT-e nas duas EFD
- **Confere:** D100 da EFD ICMS/IPI × D100 da EFD Contribuições pela `CHV_CTE`: CT-e com crédito de ICMS e sem análise de PIS/COFINS, e o inverso.
- **Por que importa:** frete com crédito de ICMS e sem crédito de PIS/COFINS é o caso típico de crédito esquecido (ver CR04 e CR05).
- **Dados:** D100 das duas EFD: `CHV_CTE`, `IND_OPER`, `IND_FRT`, `VL_DOC`, `VL_SERV`, `VL_ICMS`; D101/D105: `IND_NAT_FRT`, `CST_PIS`, `VL_BC_PIS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro e oportunidade

#### CZ13 · Energia e comunicação nas duas EFD
- **Confere:** contas de energia (C500) e de comunicação (D500) da EFD ICMS/IPI de cada estabelecimento × C500/C501/C505 e D500/D501/D505 da EFD Contribuições.
- **Por que importa:** conta de energia que está na EFD ICMS/IPI e não está na Contribuições é crédito de PIS/COFINS não tomado (ver CR02).
- **Dados:** C500 das duas EFD: `COD_PART`, `NUM_DOC`, `DT_DOC`, `VL_DOC`, `VL_ICMS`; C501/C505: `CST_PIS`, `NAT_BC_CRED`, `VL_BC_PIS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** oportunidade de recuperação

#### CZ14 · Qualidade dos XML: duplicados, faltantes e fora do padrão
- **Confere:** a mesma chave em mais de um arquivo; meses e estabelecimentos sem XML; XML sem protocolo de autorização; numeração de emissão própria com buracos.
- **Por que importa:** diz ao dono se o acervo de XML está completo: sem isso, nenhum cruzamento com XML é conclusivo e a empresa não consegue se defender numa fiscalização.
- **Dados:** XML: `chnfe`, `nome_arquivo_txt`, `emit_cnpj`, `ide_nnf`, `emissao_data`. **Temos.** **Falta:** o protocolo (`protNFe`) e a série, que o leitor não guarda.
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** indicador

#### CZ15 · Receita das três fontes
- **Confere:** por mês: vendas da EFD ICMS/IPI (C190 e analíticos com CFOP de venda, todos os estabelecimentos) × receita bruta da EFD Contribuições (`VL_REC_BRT` dos M210 + M400) × receita bruta contábil (ECD, contas da referencial 3.01.01.01.01).
- **Por que importa:** é o cruzamento que a Receita faz entre EFD, ECD e ECF. Para o dono, é a prova de que o faturamento é o mesmo em toda declaração.
- **Dados:** EFD ICMS/IPI: analíticos (`CFOP`, `VL_OPR`); Contribuições: M210, M400, M610, M800, 0111; ECD: I155 (`VL_DEB`, `VL_CRED`), I355, I051 (`COD_CTA_REF`). **Temos.**
- **Dificuldade:** média (lista de CFOP de receita e mapeamento das contas) · **Tributarista:** não · **Resultado:** risco

---

## 4. Créditos de PIS/COFINS não aproveitados (CR)

Já implementadas: O02 e O03 (a CR17 leva a O02 até o arquivo corrigido). Todo crédito abaixo é **interpretação tributária** até o tributarista validar o direito no
caso concreto. O prazo para aproveitar é de 5 anos (Lei 10.833/2003, art. 3º, § 4º, permite usar o crédito nos meses
seguintes). A Receita exige a retificação da EFD Contribuições e da DCTF do mês de origem (SC Cosit 355/2017); o
catálogo trata a retificadora como o caminho seguro.

No comércio, a Receita não admite crédito de "insumo" (Lei 10.833, art. 3º, II): só valem os créditos com inciso
próprio (SC Cosit 110/2023). Por isso as regras miram energia, aluguéis, edificações, frete de venda, armazenagem e
devoluções, além da mercadoria para revenda.

#### CR01 · Compra para revenda sem crédito, com fornecedor que tributou
- **Confere:** C170 de entrada com CFOP de compra para revenda (1102, 2102, 1403, 2403 e semelhantes) e CST sem crédito (70 a 75, 98, 99), cujo item no XML do fornecedor saiu com CST 01 ou 02 e PIS/COFINS destacados; o produto não é monofásico nem de alíquota zero.
- **Por que importa:** dinheiro a recuperar: 9,25% do valor da compra. Base legal: Leis 10.637/2002 e 10.833/2003, art. 3º, I.
- **Dados:** Contribuições C170: `CFOP`, `CST_PIS`, `CST_COFINS`, `VL_ITEM`, `VL_BC_PIS`; XML: `imposto_pis_cst`, `imposto_pis_vpis`, `imposto_cofins_cst`, `prod_ncm`, `ncm_monofasico`. **Temos** (XML de 2022 em diante).
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CR02 · Energia elétrica sem crédito
- **Confere:** contas de energia de cada estabelecimento (C500 da EFD ICMS/IPI) sem C500/C501/C505 na EFD Contribuições, ou com CST sem crédito; despesa de energia na ECD maior que a base de crédito (`NAT_BC_CRED` 04) do M105.
- **Por que importa:** energia consumida nos estabelecimentos dá crédito também no comércio. Numa rede com refrigeração é uma das maiores despesas. Base legal: Lei 10.833/2003, art. 3º, III; Lei 10.637/2002, art. 3º, IX.
- **Dados:** EFD ICMS/IPI C500: `COD_PART`, `NUM_DOC`, `DT_DOC`, `VL_DOC`, `VL_FORN`; Contribuições C500, C501, C505: `CST_PIS`, `VL_ITEM`, `NAT_BC_CRED`, `VL_BC_PIS`; M105; ECD I155 das contas de energia. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim (ICMS na base do crédito depois de 05/2023, ver CR12) · **Resultado:** oportunidade de recuperação

#### CR03 · Aluguéis de prédios, máquinas e equipamentos pagos a pessoa jurídica
- **Confere:** despesa de aluguel na ECD (contas de aluguel e de locação, pelo nome ou pela referencial) contra a base de crédito do F100 com `NAT_BC_CRED` 05 (prédios) e 06 (máquinas e equipamentos); locadores do I250 (`COD_PART`) que são pessoa jurídica.
- **Por que importa:** quase toda loja é alugada. Aluguel pago a pessoa jurídica dá crédito; a pessoa física, não. Base legal: Lei 10.833/2003, art. 3º, IV.
- **Dados:** ECD I050: `COD_CTA`, `CTA`; I155: `VL_DEB`, `VL_CRED`; I250: `COD_CTA`, `VL_DC`, `HIST`, `COD_PART`; 0150: `CNPJ`, `CPF`; Contribuições F100: `NAT_BC_CRED`, `COD_PART`, `VL_OPER`, `CST_PIS`, `VL_BC_PIS`; M105. **Temos.** **Falta:** dizer quais contas são de aluguel (mapeamento por cliente) e, se o I250 não trouxer o participante, a lista de locadores.
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CR04 · Frete na venda e armazenagem
- **Confere:** CT-e com a empresa como tomadora em operação de venda (D100 com `IND_FRT` do remetente, `IND_NAT_FRT` de venda) e notas de armazenagem, sem crédito no D101/D105 ou no F100 (`NAT_BC_CRED` 07); despesa de fretes sobre vendas na ECD × base do M105.
- **Por que importa:** frete de entrega ao cliente e armazenagem, pagos pelo vendedor, dão crédito. Cresce com o comércio eletrônico. Base legal: Lei 10.833/2003, art. 3º, IX.
- **Dados:** D100 (as duas EFD): `CHV_CTE`, `IND_OPER`, `IND_FRT`, `VL_SERV`; D101/D105: `IND_NAT_FRT`, `CST_PIS`, `NAT_BC_CRED`, `VL_BC_PIS`; F100; ECD I155. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CR05 · Frete na compra de mercadoria para revenda
- **Confere:** CT-e de compra pago pela empresa (D100 de entrada, frete por conta do destinatário) sem crédito, quando a mercadoria transportada dá crédito; e o inverso: crédito de frete sobre compra de monofásico ou alíquota zero.
- **Por que importa:** o frete pago pelo comprador integra o custo de aquisição e segue o crédito da mercadoria. Base: SC Cosit 54/2013, citada em fonte secundária (a confirmar no texto oficial).
- **Dados:** D100: `CHV_CTE`, `IND_FRT`, `VL_SERV`, `COD_PART`; D101/D105; para ligar o CT-e às notas transportadas **falta** o XML do CT-e (as chaves das NF-e ficam nele).
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** oportunidade de recuperação e risco

#### CR06 · Edificações e benfeitorias em lojas
- **Confere:** adições das contas de edificações, benfeitorias em imóveis de terceiros e instalações na ECD contra os créditos do F120 (depreciação) e do F130 (aquisição), `NAT_BC_CRED` 11.
- **Por que importa:** reforma e construção de loja, em imóvel próprio ou alugado, dão crédito pela depreciação ou amortização. Base legal: Lei 10.833/2003, art. 3º, VII. Máquinas e equipamentos (inciso VI) só dão crédito se usados em produção, locação ou serviços: no comércio puro, não.
- **Dados:** ECD I050, I155 (contas do imobilizado), I250; Contribuições F120: `NAT_BC_CRED`, `IDENT_BEM_IMOB`, `IND_UTIL_BEM_IMOB`, `VL_OPER_DEP`, `VL_BC_PIS`; F130: `MES_OPER_AQUIS`, `VL_OPER_AQUIS`, `VL_BC_CRED`, `IND_NR_PARC`. **Temos.** **Falta:** o controle patrimonial (bem a bem) para o cálculo exato.
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CR07 · Produção própria: padaria, açougue, rotisseria
- **Confere:** compras de insumos, embalagens e energia dos setores de produção própria (itens com `TIPO_ITEM` 01 matéria-prima, 02 embalagem; CFOP 1101, 2101) sem crédito; máquinas desses setores sem F120/F130.
- **Por que importa:** na parte da empresa que fabrica, o conceito de insumo vale (STJ, Temas 779 e 780, REsp 1.221.170; Parecer Normativo Cosit 5/2018). A extensão ao supermercado é **tese**: precisa de laudo e de rateio por setor.
- **Dados:** 0200: `TIPO_ITEM`; C170: `CFOP`, `CST_PIS`, `VL_ITEM`; F120/F130; EFD ICMS/IPI bloco K, se houver (K230, K235). **Temos** os documentos; **falta** o rateio por setor.
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CR08 · Devolução de venda sem crédito
- **Confere:** entradas com CFOP de devolução de venda (1202, 2202, 1411, 2411) e CST sem crédito, quando a venda original foi tributada.
- **Por que importa:** a devolução de venda tributada devolve o PIS/COFINS pago, como crédito. Base legal: Lei 10.833/2003, art. 3º, VIII.
- **Dados:** Contribuições C170: `CFOP`, `CST_PIS`, `VL_ITEM`, `VL_BC_PIS`, `COD_ITEM`; a venda original pelo item (CST de saída do mesmo `COD_ITEM`). **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CR09 · Base do crédito menor que o custo de aquisição
- **Confere:** entradas com CST 50 em que `VL_BC_PIS` < `VL_ITEM` − `VL_DESC` (mais frete e seguro da nota), ou alíquota de crédito menor que 1,65% e 7,6%. Até 04/2023 o ICMS fazia parte da base do crédito.
- **Por que importa:** crédito calculado sobre base reduzida sem motivo é dinheiro perdido em toda compra do item.
- **Dados:** C170: `VL_ITEM`, `VL_DESC`, `VL_ICMS`, `VL_IPI`, `VL_BC_PIS`, `ALIQ_PIS`, `VL_BC_COFINS`, `ALIQ_COFINS`; C100: `VL_FRT`, `VL_SEG`, `DT_E_S`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim (composição da base em cada período) · **Resultado:** oportunidade de recuperação

#### CR10 · Compra de fornecedor do Simples Nacional sem crédito
- **Confere:** entradas para revenda de fornecedores optantes do Simples com CST sem crédito.
- **Por que importa:** a compra de optante do Simples dá crédito integral (Ato Declaratório Interpretativo RFB 15/2007, a confirmar). É comum o sistema zerar o crédito porque a nota vem sem destaque.
- **Dados:** C100: `COD_PART`; 0150: `CNPJ`; C170: `CFOP`, `CST_PIS`, `VL_ITEM`. **Falta:** saber quem é do Simples (base pública de CNPJ da Receita, ou o CRT do emitente no XML, que o leitor não guarda).
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CR11 · Saldo de créditos parado e créditos que podem ser ressarcidos
- **Confere:** `SLD_CRED` do M100/M500 e do 1100/1500 por tipo de crédito (`COD_CRED`) e período de origem; créditos vinculados a receita não tributada no mercado interno (códigos 2xx) e à exportação (3xx) sem pedido de compensação ou ressarcimento (`VL_CRED_PER_EFD`, `VL_CRED_DCOMP_EFD` zerados); créditos a menos de 12 meses de completar 5 anos.
- **Por que importa:** supermercado vende muito com alíquota zero e mantém o crédito das compras (Lei 11.033/2004, art. 17). Esse saldo pode virar dinheiro por compensação ou ressarcimento, e caduca em 5 anos.
- **Dados:** M100/M500: `COD_CRED`, `VL_CRED_DISP`, `VL_CRED_DESC`, `SLD_CRED`; 1100/1500: `PER_APU_CRED`, `ORIG_CRED`, `COD_CRED`, `VL_TOT_CRED_APU`, `VL_CRED_PER_EFD`, `VL_CRED_DCOMP_EFD`, `SLD_CRED_FIM`. **Temos.** **Falta:** os PER/DCOMP já transmitidos.
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** oportunidade de recuperação e indicador

#### CR12 · Crédito sobre o que não dá crédito (risco de glosa)
- **Confere:** entradas com CST 50 a 56 e crédito em: (a) produto monofásico, de alíquota zero ou com substituição (Lei 10.833, art. 3º, § 2º, II; STJ, Tema 1093); (b) CFOP de uso e consumo, ativo, transferência, bonificação recebida ou remessa (1556, 1551, 1152, 1910, 19xx); (c) ICMS dentro da base do crédito a partir de 05/2023 (Lei 14.592/2023; STJ, Tema 1364, julgado em 14/10/2026 segundo fonte secundária); (d) ICMS-ST dentro da base (STJ, Tema 1231); (e) frete entre estabelecimentos (Súmula CARF 217).
- **Por que importa:** crédito indevido é cobrado com multa de 75% e juros. Saber antes permite retificar sem multa.
- **Dados:** Contribuições C170: `CFOP`, `CST_PIS`, `VL_ITEM`, `VL_ICMS`, `VL_ICMS_ST`, `VL_BC_PIS`, `VL_PIS`; 0200: `COD_NCM`; D101/D105: `IND_NAT_FRT`. **Temos.** **Falta:** as tabelas de NCM monofásico e de alíquota zero (Tabelas 4.3.10 e 4.3.13 do SPED, públicas).
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco

#### CR13 · Devolução de compra sem estorno do crédito
- **Confere:** saídas com CFOP de devolução de compra (5202, 6202, 5411, 6411) de itens cuja entrada teve crédito, sem redução correspondente (ajuste no M110/M510 ou item com base negativa no mês).
- **Por que importa:** crédito mantido sobre mercadoria devolvida é indevido.
- **Dados:** C170 de saída: `CFOP`, `COD_ITEM`, `VL_ITEM`, `CST_PIS`; M110/M510: `IND_AJ`, `VL_AJ`, `COD_AJ`. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

#### CR14 · Créditos extemporâneos já lançados
- **Confere:** créditos de outros períodos lançados em 1101/1501 ou em ajustes de acréscimo (M110/M510); a mesma chave de nota no 1101 e num C100 de outro mês (duplicidade).
- **Por que importa:** a Receita exige retificadora do mês de origem; extemporâneo lançado direto é alvo de glosa (posição mantida pela CSRF em parte dos casos). O dono vê o que já foi "recuperado" antes e por quem.
- **Dados:** 1101/1501: `CHV_NFE`, `DT_OPER`, `VL_OPER`, `CFOP`, `NAT_BC_CRED`, `CST_PIS`, `VL_BC_PIS`, `VL_PIS`, `PER_ESCRIT`; 1100: `VL_CRED_EXT_APU`; M110. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** risco e indicador

#### CR15 · Importação sem crédito
- **Confere:** entradas com CFOP 3xxx sem crédito de PIS/COFINS-Importação (CST 50 a 56 com `IND_ORIG_CRED` de importação).
- **Por que importa:** o PIS/COFINS pago no desembaraço é crédito. Base legal: Lei 10.865/2004, art. 15.
- **Dados:** C170: `CFOP`, `CST_PIS`, `VL_BC_PIS`, `VL_PIS`; C120 (complemento de importação). **Temos**, se a empresa importar.
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CR16 · Simulação do método de apropriação dos créditos
- **Confere:** recalcula os créditos pelos dois métodos (apropriação direta e rateio proporcional pela receita) e compara com o adotado (`0110.IND_APRO_CRED`).
- **Por que importa:** o método é escolha anual do contribuinte e muda o volume de crédito ressarcível. É planejamento, não recuperação do passado.
- **Dados:** 0110, 0111, M105/M505, documentos de entrada e de saída por CST. **Temos.**
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** indicador

#### CR17 · Inclusão de insumos: levar para a EFD Contribuições as entradas que só estão na EFD ICMS/IPI
- **Confere:** as chaves de entrada da EFD ICMS/IPI que não estão em nenhum C100 da EFD Contribuições (a detecção é a O02, já implementada) e, para cada uma, monta os registros que faltam no arquivo da Contribuições da mesma competência: a nota e os itens **exatamente como estão na EFD ICMS/IPI**, mais os cadastros de que eles dependem.
- **Por que importa:** é a passagem do achado ao dinheiro: o arquivo corrigido, pronto para validar no PVA e transmitir como retificadora, com o crédito das entradas que ficaram de fora. É análise que a consultoria já faz (antes em QlikView); no DBI ela sai dos mesmos arquivos, sem remontar o modelo. Base legal do crédito: Leis 10.637/2002 e 10.833/2003, art. 3º; a retificadora do mês de origem é o caminho que a Receita aceita (SC Cosit 355/2017).
- **Dados:** EFD ICMS/IPI: C100 (todos os campos), C170 (todos), 0150, 0200, 0190, 0400, 0450; EFD Contribuições do mesmo mês: 0140, 0150, 0200, 0190, 0400, 0450, C010, C100: `CHV_NFE`. **Temos.** Para gravar o arquivo é preciso o original inteiro da Contribuições (está no bucket).
- **Dificuldade:** média (a regra é simples; o cuidado está em gerar um arquivo que o PVA aceite) · **Tributarista:** sim (quais entradas dão crédito e com que CST) · **Resultado:** oportunidade de recuperação

**Como o arquivo corrigido é montado** (conferido nos layouts do repositório):

| Registro | Na EFD ICMS/IPI | Na EFD Contribuições | O que fazer |
|---|---|---|---|
| C100 | 28 campos | os mesmos 28, na mesma ordem | copiar como está, sob o C010 do estabelecimento |
| C170 | 37 campos | 36: os mesmos, sem o último (`VL_ABAT_NT`) | copiar sem o último campo |
| 0150 (participante) | 12 campos | os mesmos 12 | incluir sob o 0140 do estabelecimento, se o `COD_PART` não existir ali |
| 0200 (item) | 12 campos | 11: os mesmos, sem o último (`CEST`) | incluir sob o 0140, sem o `CEST`, se o `COD_ITEM` não existir ali |
| 0190 (unidade), 0400 (natureza), 0450 (informação complementar) | 2 campos | os mesmos 2 | incluir se a `UNID`, o `COD_NAT` ou o `COD_INF` usados na nota não existirem |

Cuidados:

- **Cadastro por estabelecimento e por competência.** Na Contribuições, o 0150 e o 0200 são filhos do 0140: o
  participante e o item têm de existir **no 0140 do estabelecimento da nota, no arquivo daquele mês**. Estar em outro
  estabelecimento ou em outro mês não serve; sem isso o PVA recusa o arquivo. O mesmo vale, no nível do arquivo, para
  0190, 0400 e 0450.
- **Código já usado com outro conteúdo.** Se o `COD_PART` ou o `COD_ITEM` já existe no 0140 com CNPJ, descrição ou
  NCM diferentes dos da EFD ICMS/IPI, não incluir de novo: listar o conflito para decisão.
- **Estabelecimento sem C010 ou sem 0140 no mês.** É preciso criar o C010 (e o 0140), não só as notas.
- **Notas sem C170 na EFD ICMS/IPI** (em regra, as de emissão própria) não têm itens para copiar: ficam numa lista à
  parte.
- **Não duplicar.** A chave não pode existir em nenhum outro mês da Contribuições (regra C12), e só entram notas
  regulares (modelo 55, situação 00, 01, 06, 07 ou 08).
- **Totais e apuração.** Recontar os registros de encerramento (0990, C990, 9900, 9990, 9999), marcar o arquivo como
  retificador (`0000.TIPO_ESCRIT` = 1, com o `NUM_REC_ANTERIOR`) e refazer o bloco M no PVA: a inclusão muda o M105, o
  M100 e o M200 (a função de gerar a apuração no PVA é a confirmar).
- **Ponto a decidir com o tributarista:** "exatamente como está no ICMS" copia também o `CST_PIS`, o `CST_COFINS`, as
  bases e as alíquotas do C170 da EFD ICMS/IPI. Se lá eles estiverem vazios ou com CST sem crédito, a nota entra na
  Contribuições e não gera crédito. A regra tem de dizer se mantém o que veio ou se aplica o CST de crédito por CFOP.
- A EFD ICMS/IPI começa em 2019 e a Contribuições em 2018: a análise vale para os meses e estabelecimentos que têm os
  dois arquivos.

---

## 5. PIS/COFINS pago a maior (PM)

Já implementada: O01 (monofásico com PIS no XML de saída). Aqui o valor está nos cupons e nas NFC-e, que são quase toda
a receita do varejo e não passam pelo XML de NF-e.

#### PM01 · Monofásico tributado na venda ao consumidor
- **Confere:** itens de saída na EFD Contribuições (C170, C175, C181/C185, C381/C385, C481/C485, C870) com CST 01 e débito, cujo NCM é monofásico: higiene, perfumaria e farmacêuticos (Lei 10.147/2000), autopeças e pneus (Lei 10.485/2002), combustíveis (Lei 9.718/1998).
- **Por que importa:** na revenda de monofásico a alíquota é zero (CST 04). É a recuperação clássica do varejo: 9,25% sobre a venda desses itens, por 5 anos.
- **Dados:** Contribuições C170: `COD_ITEM`, `CFOP`, `CST_PIS`, `VL_BC_PIS`, `ALIQ_PIS`, `VL_PIS` e os de COFINS; C181, C381, C481, C870: `CST_PIS`, `COD_ITEM`, `VL_ITEM`, `VL_PIS`; 0200: `COD_NCM`. **Temos** (a `bloco_c_resumo_itens` já soma os C170 por item). **Falta:** a tabela de NCM monofásico por vigência (Tabela 4.3.10 do SPED; os XML já trazem `ncm_monofasico` para os NCM que passaram por nota).
- **Dificuldade:** baixa · **Tributarista:** sim (NCM com exceção e produtos com "ex") · **Resultado:** oportunidade de recuperação

#### PM02 · Bebidas frias tributadas na venda a consumidor final
- **Confere:** vendas a consumidor final de águas, refrigerantes, cervejas, energéticos e isotônicos com CST 01 e débito.
- **Por que importa:** o varejista tem alíquota zero na venda a consumidor final (Lei 13.097/2015, art. 28); a venda como atacadista é tributada. Em atacarejo é preciso separar as duas.
- **Dados:** itens de saída (como na PM01); 0200: `COD_NCM`; 0208: `COD_TAB`, `COD_GRU`, `MARCA_COM`; C100: `COD_MOD` (65 = consumidor), `COD_PART`. **Temos.** **Falta:** lista de NCM da Lei 13.097 e a regra para separar atacado e varejo (a confirmar no texto da lei).
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### PM03 · Alíquota zero tributada (cesta básica e outros)
- **Confere:** itens de saída com CST 01 e débito cujo NCM está nas listas de alíquota zero: Lei 10.925/2004, art. 1º (com a Lei 12.839/2013: carnes, café, açúcar, óleo, manteiga, margarina, sabonete, creme dental, papel higiênico e outros), Lei 10.865/2004, art. 28 (rol a confirmar).
- **Por que importa:** em supermercado esses itens são grande parte da venda. Vale até 31/12/2026: a LC 214/2025 revoga o art. 1º da Lei 10.925 em 2027.
- **Dados:** itens de saída (como na PM01); 0200: `COD_NCM`, `DESCR_ITEM`. **Temos.** **Falta:** a tabela de NCM de alíquota zero (Tabela 4.3.13 do SPED).
- **Dificuldade:** média (muitos NCM dependem da descrição do produto) · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### PM04 · Mesmo produto com tratamentos diferentes
- **Confere:** o mesmo `COD_ITEM` (ou o mesmo NCM e código de barras) com CST 01 em alguns meses, estabelecimentos ou tipos de documento e CST 04 ou 06 em outros.
- **Por que importa:** acha o erro de parametrização sem depender de tabela externa: um dos dois tratamentos está errado, e o valor do errado é pago a maior ou é risco.
- **Dados:** itens de saída: `COD_ITEM`, `CST_PIS`, `CST_COFINS`, `ALIQ_PIS`, `VL_ITEM`, competência, estabelecimento; 0200: `COD_NCM`, `COD_BARRA`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim (decidir qual é o certo) · **Resultado:** oportunidade de recuperação e risco

#### PM05 · ICMS na base do PIS/COFINS (Tema 69)
- **Confere:** nas saídas tributadas, `VL_BC_PIS` contra `VL_ITEM` − `VL_DESC` − `VL_ICMS`: mede, mês a mês desde 03/2017, o ICMS destacado que ficou na base.
- **Por que importa:** o ICMS destacado não integra a base (STF, Tema 69, RE 574.706; modulação a partir de 15/03/2017; Parecer SEI 7698/2021/ME; IN RFB 2.121/2022, art. 26, XII). A Receita aplica de ofício. Se a empresa ainda não excluiu, ou excluiu só de uma data em diante, o resto é recuperável dentro de 5 anos.
- **Dados:** Contribuições C170: `VL_ITEM`, `VL_DESC`, `CST_ICMS`, `VL_ICMS`, `CST_PIS`, `VL_BC_PIS`, `VL_BC_COFINS`. Nas vendas por cupom (C175, C381, C481, C870) a Contribuições não traz o ICMS: vem da EFD ICMS/IPI (C190, C490, C850 do mesmo estabelecimento e mês). **Temos.** **Falta:** saber se há ação judicial e desde quando a empresa exclui (em parte, nos registros 1010 e M220/M620).
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### PM06 · ICMS-ST na base do PIS/COFINS do substituído (Tema 1125)
- **Confere:** nas revendas de mercadoria com ST já retida (CST do ICMS 60, CFOP 5405), o ICMS-ST pago na compra e embutido no preço que ficou na base do PIS/COFINS.
- **Por que importa:** o ICMS-ST não compõe a base do substituído (STJ, Tema 1125, REsp 1.896.678 e 1.958.265; modulação a partir de 15/03/2017 depois dos embargos de 20/06/2024). Supermercado revende muita mercadoria com ST.
- **Dados:** saída: Contribuições C170: `COD_ITEM`, `CST_ICMS`, `CFOP`, `QTD`, `VL_ITEM`, `VL_BC_PIS`; entrada do mesmo item: EFD ICMS/IPI C170: `QTD`, `VL_ICMS_ST`, ou XML: `imposto_icmsst_vicmsst`, `imposto_icms_vicmsstret`, `prod_qcom`. **Temos** os dois lados. **Falta:** o critério de ST unitária por item (última entrada ou média), a definir com o tributarista.
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### PM07 · ICMS-DIFAL na base (Tema 1372)
- **Confere:** vendas interestaduais a consumidor final não contribuinte (CFOP 6108 e semelhantes) em que o DIFAL recolhido ao estado de destino ficou na base do PIS/COFINS.
- **Por que importa:** o DIFAL também sai da base (STJ, Tema 1372, julgado em 20/08/2026 segundo fonte secundária; modulação a confirmar). Só vale para quem vende para outros estados, como no comércio eletrônico.
- **Dados:** EFD ICMS/IPI C101: `VL_FCP_UF_DEST`, `VL_ICMS_UF_DEST`, `VL_ICMS_UF_REM`; E310: `VL_TOT_DEBITOS_DIFAL`; Contribuições C170 da mesma chave: `VL_BC_PIS`. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### PM08 · Desconto incondicional dentro da base
- **Confere:** itens de saída com `VL_DESC` > 0 e `VL_BC_PIS` = `VL_ITEM` (o desconto não foi abatido).
- **Por que importa:** desconto incondicional dado na nota não é receita. Base legal: Lei 10.833/2003, art. 1º, § 3º, V, "a".
- **Dados:** C170, C175, C181: `VL_ITEM`, `VL_DESC`, `VL_BC_PIS`, `VL_BC_COFINS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** oportunidade de recuperação

#### PM09 · Operação que não é receita, tributada
- **Confere:** saídas com CST 01 e débito em CFOP que não é venda: transferência (5152, 6152, 5409), remessas e retornos (59xx, 69xx), devolução de compra (5202, 6202), bonificação e brinde (5910), venda de ativo imobilizado (5551, 6551).
- **Por que importa:** essas saídas não geram receita tributável (a venda de imobilizado está fora por força da Lei 10.833/2003, art. 1º, § 3º, II). Débito nelas é pago a maior.
- **Dados:** Contribuições C170: `CFOP`, `CST_PIS`, `VL_ITEM`, `VL_PIS`, `VL_COFINS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim (bonificação e brinde) · **Resultado:** oportunidade de recuperação

#### PM10 · Venda cancelada ou devolvida que continuou tributada
- **Confere:** C100 cancelado em mês posterior ao da emissão com débito mantido no mês original; cupom cancelado dentro do `VL_BRT` do C405 sem exclusão; devoluções de venda (ver CR08).
- **Por que importa:** venda cancelada não é receita (Lei 10.833/2003, art. 1º, § 3º, V, "a").
- **Dados:** C100: `COD_SIT`, `CHV_NFE`, `DT_DOC`; C380: `VL_DOC_CANC`; C405: `VL_BRT`; EFD ICMS/IPI C100 da mesma chave (situação). **Temos.** **Falta:** os eventos de cancelamento da SEFAZ para as notas canceladas depois.
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** oportunidade de recuperação

#### PM11 · Substituição tributária de PIS/COFINS tributada de novo
- **Confere:** revenda de cigarros e de outros produtos com PIS/COFINS retidos pelo fabricante (CST 05) saindo com CST 01 e débito.
- **Por que importa:** a contribuição já foi paga na origem; a revenda não é tributada (base legal dos cigarros: Lei 9.532/1997, art. 53, e LC 70/1991, art. 3º, a confirmar).
- **Dados:** itens de saída (como na PM01); 0200: `COD_NCM`. **Temos.** **Falta:** Tabela 4.3.12 do SPED.
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### PM12 · Receitas financeiras e outras receitas com alíquota errada
- **Confere:** receitas financeiras no F100 com alíquota diferente de 0,65% e 4% (Decreto 8.426/2015), ou tributadas a 1,65% e 7,6%; receitas da ECD (financeiras, aluguéis, recuperação de despesas) sem F100 correspondente.
- **Por que importa:** alíquota cheia sobre receita financeira é pago a maior; receita financeira fora do F100 é débito não declarado.
- **Dados:** F100: `IND_OPER`, `VL_OPER`, `CST_PIS`, `ALIQ_PIS`, `ALIQ_COFINS`, `COD_CTA`, `DESC_DOC_OPER`; ECD I155 das contas com referencial de receita financeira. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação e risco

#### PM13 · Bonificações e verbas de fornecedor tributadas como receita
- **Confere:** receitas de bonificação, rebate e verba comercial no F100 com CST 01, e as contas correspondentes na ECD; bonificações em mercadoria recebidas (CFOP 1910, 2910).
- **Por que importa:** a Receita tributa (SC Cosit 202/2021). O STJ está dividido (REsp 1.836.082, a favor; REsp 2.090.134, contra) e afetou o Tema 1412, **ainda sem julgamento**. É contingência a acompanhar, não crédito certo.
- **Dados:** F100: `VL_OPER`, `CST_PIS`, `COD_CTA`, `DESC_DOC_OPER`, `COD_PART`; ECD I155 e I250 das contas de bonificação; C170 de entrada com CFOP 1910 ou 2910. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** indicador (tese pendente)

#### PM14 · ISS e crédito presumido de ICMS na base
- **Confere:** receita de serviços (bloco A, saídas) com o ISS dentro da base; créditos presumidos de ICMS (E111 com código de crédito presumido) contabilizados como receita e tributados.
- **Por que importa:** o STF decidiu a favor do contribuinte nos Temas 118 (ISS, 21/10/2026) e 843 (crédito presumido de ICMS, 07/10/2026), **com modulação pendente**, segundo as fontes consultadas. Para o varejo, o ISS só pesa se houver receita de serviços.
- **Dados:** A100: `VL_DOC`, `VL_BC_PIS`, `VL_ISS`; EFD ICMS/IPI E111: `COD_AJ_APUR`, `VL_AJ_APUR`; ECD I155. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação (aguardar modulação)

#### PM15 · Exportação e Zona Franca tributadas
- **Confere:** saídas com CFOP 7xxx ou para a Zona Franca de Manaus (6109, 6110) com CST 01 e débito.
- **Por que importa:** exportação não paga PIS/COFINS (Lei 10.833/2003, art. 6º); venda à ZFM tem alíquota zero (Lei 10.996/2004, art. 2º, a confirmar).
- **Dados:** C170: `CFOP`, `CST_PIS`, `VL_PIS`; 0150: `COD_MUN`, `SUFRAMA`. **Temos**, se houver essas operações.
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

---

## 6. ICMS próprio (IC)

O ICMS muda de estado para estado: alíquotas, benefícios, códigos de ajuste e prazos. As regras abaixo dizem o que
conferir; a tabela de cada UF é dado externo. Onde não há tabela, a regra compara a empresa com ela mesma (o mesmo
produto tratado de dois jeitos).

#### IC01 · Crédito de ICMS destacado e não aproveitado
- **Confere:** entradas para revenda ou industrialização com ICMS destacado no XML do fornecedor (`imposto_icms_vicms` > 0) e `VL_ICMS` zerado ou menor no C170/C190 da EFD ICMS/IPI.
- **Por que importa:** dinheiro a recuperar: o crédito pode ser lançado em até 5 anos da emissão do documento (LC 87/1996, art. 23, parágrafo único).
- **Dados:** XML: `chnfe`, `prod_item`, `prod_cfop`, `imposto_icms_cst`, `imposto_icms_vbc`, `imposto_icms_picms`, `imposto_icms_vicms`; EFD ICMS/IPI C100: `CHV_NFE`; C170: `NUM_ITEM`, `CFOP`, `CST_ICMS`, `VL_BC_ICMS`, `VL_ICMS`; C190. **Temos** (XML de 2022 em diante).
- **Dificuldade:** média · **Tributarista:** sim (direito ao crédito do item) · **Resultado:** oportunidade de recuperação

#### IC02 · Crédito de ICMS maior que o destacado
- **Confere:** `VL_ICMS` do C100/C190 de entrada maior que o ICMS do XML da mesma chave.
- **Por que importa:** é malha publicada em vários estados (Goiás, Malha 13; Paraná; Rio Grande do Sul). Em São Paulo o crédito indevido tem multa de até 100% do valor (RICMS-SP, art. 527, II).
- **Dados:** os mesmos da IC01. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### IC03 · Crédito em entrada que não dá crédito
- **Confere:** `VL_ICMS` creditado em: uso e consumo (CFOP 1556, 2556, 1407, 2407; `TIPO_ITEM` 07), que só dará crédito a partir de 2033; mercadoria com ST já retida (CST 60); ativo imobilizado creditado de uma vez, fora do CIAP (CFOP 1551, 2551); energia elétrica e comunicação em estabelecimento comercial.
- **Por que importa:** LC 87/1996, art. 20 e art. 33, I e II (com a LC 171/2019). Energia em comércio é malha em Goiás (Malha 38); o STJ negou o crédito a supermercado com padaria e congelamento (Tema 242, REsp 1.117.139).
- **Dados:** C170: `CFOP`, `CST_ICMS`, `VL_ICMS`, `COD_ITEM`; 0200: `TIPO_ITEM`; C190; C500/C590: `VL_ICMS`, `CFOP`; D500/D590; E111. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim (exceções por UF) · **Resultado:** risco

#### IC04 · Alíquota interestadual errada
- **Confere:** nas operações entre estados, alíquota diferente de 4% (mercadoria importada, origem 1, 2, 3 ou 8), 7% ou 12% conforme a UF de origem e a de destino.
- **Por que importa:** crédito a maior na entrada é glosa; alíquota maior na saída é ICMS pago sem dever. Base legal: Resolução do Senado 22/1989 e 13/2012.
- **Dados:** XML: a UF do emitente está nos dois primeiros dígitos da `chnfe`; `imposto_icms_orig`, `imposto_icms_picms`, `prod_cfop`; EFD: 0000 `UF`, 0150 `COD_MUN`, C170/C190 `ALIQ_ICMS`, `CFOP`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro e risco

#### IC05 · Alíquota interna: o mesmo produto com alíquotas diferentes
- **Confere:** o mesmo item (ou NCM) vendido no mesmo estado com alíquotas ou CST diferentes entre estabelecimentos, meses ou documentos; alíquota que não mudou quando a alíquota modal do estado mudou.
- **Por que importa:** acha erro de cadastro sem tabela externa. Alíquota desatualizada é malha em Goiás (Malha 118, modal de 17% para 19%).
- **Dados:** Contribuições C170 (traz o ICMS por item nas saídas): `COD_ITEM`, `CST_ICMS`, `CFOP`, `ALIQ_ICMS`, `VL_BC_ICMS`, `VL_ICMS`; EFD ICMS/IPI C190, C490, C850: `CST_ICMS`, `CFOP`, `ALIQ_ICMS`; 0200: `COD_NCM`, `ALIQ_ICMS`. **Temos.** **Falta** (para dizer qual é a certa): tabela de alíquotas internas por UF e NCM.
- **Dificuldade:** baixa sem a tabela, alta com ela · **Tributarista:** sim · **Resultado:** erro e risco

#### IC06 · Venda sem destaque de ICMS por benefício ou ST aplicados sem base
- **Confere:** saídas com CST 40, 41, 60 ou com redução de base (20) de itens cuja entrada foi tributada normalmente (CST 00) e sem ST; itens que saíram da ST no estado e continuam como CST 60.
- **Por que importa:** é o programa de autorregularização de supermercados e padarias no Rio Grande do Sul (R$ 41,3 milhões numa fase) e de produtos excluídos da ST em São Paulo.
- **Dados:** entrada: EFD ICMS/IPI C170: `COD_ITEM`, `CST_ICMS`, `VL_ICMS`, `VL_ICMS_ST`; saída: Contribuições C170: `COD_ITEM`, `CST_ICMS`, `CFOP`, `VL_ICMS`; C190/C490/C850. **Temos.** **Falta:** a lista de benefícios e de produtos em ST de cada UF.
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco

#### IC07 · DIFAL de uso, consumo e ativo
- **Confere:** entradas interestaduais de uso e consumo e de ativo (CFOP 2551, 2556, 2406, 2407) contra o DIFAL lançado (C197 ou E111, pelo código de ajuste da UF): DIFAL não lançado, ou calculado sobre base errada.
- **Por que importa:** falta de DIFAL é malha (Goiás, Malhas 110 e 136, cálculo item a item). DIFAL de ativo que não foi para o CIAP é crédito perdido (ver CP05).
- **Dados:** C170: `CFOP`, `VL_ITEM`, `ALIQ_ICMS`, `VL_ICMS`; XML: `imposto_icms_picms`; C197: `COD_AJ`, `VL_BC_ICMS`, `ALIQ_ICMS`, `VL_ICMS`, `VL_OUTROS`; E111: `COD_AJ_APUR`, `VL_AJ_APUR`. **Temos.** **Falta:** alíquota interna e regra de base (simples ou dupla) de cada UF.
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco e oportunidade

#### IC08 · DIFAL nas vendas a consumidor final de outro estado
- **Confere:** vendas interestaduais a não contribuinte (CFOP 6107, 6108) com o DIFAL do C101 e do E310 e as guias do E316; DIFAL destacado e não recolhido.
- **Por que importa:** EC 87/2015, LC 190/2022 e Convênio ICMS 236/2021. É malha em Goiás (Malha 132).
- **Dados:** C101: `VL_FCP_UF_DEST`, `VL_ICMS_UF_DEST`, `VL_ICMS_UF_REM`; E300: `UF`; E310: `VL_TOT_DEBITOS_DIFAL`, `VL_RECOL_DIFAL`, `VL_TOT_DEB_FCP`; E316. **Temos.** **Falta:** as guias pagas (GNRE).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### IC09 · Saldo credor parado em uns estabelecimentos e imposto pago em outros
- **Confere:** por UF e mês, estabelecimentos com `VL_SLD_CREDOR_TRANSPORTAR` crescente e, no mesmo estado, estabelecimentos com `VL_ICMS_RECOLHER`; saldo credor parado há mais de 12 meses.
- **Por que importa:** os saldos de estabelecimentos do mesmo titular no estado podem ser compensados entre si (LC 87/1996, art. 25). Numa rede, isso é caixa: crédito parado numa loja paga o imposto de outra. A forma (apuração centralizada, transferência de saldo) depende de cada UF.
- **Dados:** 0000: `CNPJ`, `UF`, `IE`; E110: `VL_ICMS_RECOLHER`, `VL_SLD_CREDOR_TRANSPORTAR`; E116; 1200/1210 (controle de créditos). **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim (regra da UF) · **Resultado:** oportunidade (caixa) e indicador

#### IC10 · Transferências entre estabelecimentos depois da ADC 49
- **Confere:** como cada transferência (CFOP 5152, 6152, 5409, 6409) foi tratada desde 2024: com destaque (equiparada a operação tributada) ou com transferência de crédito; consistência entre os estabelecimentos; base de cálculo na transferência interestadual.
- **Por que importa:** não há fato gerador na transferência entre estabelecimentos do mesmo titular, o crédito é mantido e pode ser transferido (ADC 49; LC 204/2023, que alterou o art. 12 da LC 87/1996; Convênio ICMS 109/2024). Tratamento misto gera crédito preso num estado e débito em outro.
- **Dados:** C100: `CHV_NFE`, `VL_ICMS`; C170/C190: `CFOP`, `CST_ICMS`, `VL_BC_ICMS`, `ALIQ_ICMS`, `VL_ICMS`; E111. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco e oportunidade

#### IC11 · Estorno de crédito: perdas, quebras e saídas sem tributação
- **Confere:** baixas de estoque (CFOP 5927), perdas apuradas no levantamento de estoque (ES04) e saídas isentas ou não tributadas de mercadoria comprada com crédito, contra os estornos lançados (E111, `VL_ESTORNOS_CRED`).
- **Por que importa:** o crédito tem de ser estornado quando a mercadoria perece, some ou sai sem tributação (LC 87/1996, art. 21). Supermercado tem perda alta; estorno não feito é auto de infração. Na Bahia, perda dentro do percentual tolerado gera estorno proporcional (Portaria SEFAZ 445/1998).
- **Dados:** C170/C190: `CFOP`, `CST_ICMS`, `VL_OPR`; E110: `VL_ESTORNOS_CRED`; E111: `COD_AJ_APUR`, `VL_AJ_APUR`. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco

#### IC12 · Ajustes da apuração: códigos e valores fora do padrão
- **Confere:** todos os E111 e C197 por código, valor e mês; códigos genéricos ("outros créditos") de valor alto; ajuste sem descrição ou sem documento (E113); código fora da tabela da UF ou fora de vigência.
- **Por que importa:** ajuste manual é o primeiro lugar que o auditor olha. O Paraná pôs em malha o ajuste de crédito de CIAP (PR020021). Para o dono, é a lista do que foi abatido do imposto "por fora" das notas.
- **Dados:** E111: `COD_AJ_APUR`, `DESCR_COMPL_AJ`, `VL_AJ_APUR`; E113: `COD_PART`, `NUM_DOC`, `VL_AJ_ITEM`; C197: `COD_AJ`, `DESCR_COMPL_AJ`, `VL_ICMS`; C195. **Temos.** **Falta:** Tabela 5.1.1 de cada UF (pública).
- **Dificuldade:** baixa · **Tributarista:** sim (mérito do ajuste) · **Resultado:** risco e indicador

#### IC13 · Devoluções: mesmo imposto da operação original
- **Confere:** devolução de compra (CFOP 5202, 6202, 5411, 6411) com ICMS e ST iguais aos da entrada original; devolução de venda (1202, 2202, 1411) com crédito igual ao débito da venda; documento referenciado (C113).
- **Por que importa:** devolução com imposto diferente da origem deixa crédito indevido ou débito a maior.
- **Dados:** C170: `CFOP`, `COD_ITEM`, `QTD`, `VL_ICMS`, `VL_ICMS_ST`; C113: `NUM_DOC`, `DT_DOC`, `COD_PART`. **Temos.** **Falta:** a chave da nota referenciada (o C113 traz só número e série; o XML tem `refNFe`, que o leitor não guarda).
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro

#### IC14 · Crédito de fornecedor do Simples Nacional
- **Confere:** crédito de ICMS em compra de optante do Simples maior que o permitido (o percentual informado na nota), ou crédito não tomado quando informado.
- **Por que importa:** LC 123/2006, art. 23, §§ 1º e 2º; há autuações em Minas Gerais por crédito acima do permitido.
- **Dados:** C100: `COD_PART`, `VL_ICMS`; C170: `VL_ICMS`; XML: `infadic_cpl` (onde vem o valor do crédito), `imposto_icms_cst` (CSOSN 101, 201). **Temos.** **Falta:** o CRT do emitente e os campos `pCredSN` e `vCredICMSSN`, que o leitor não guarda.
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco e oportunidade

#### IC15 · Saídas sem débito: bonificação, brinde, doação e outras
- **Confere:** saídas com CFOP 5910, 5911, 5949, 6949 e semelhantes sem ICMS, por valor e destinatário; uso recorrente do 5949.
- **Por que importa:** bonificação e brinde são tributados em regra; "outras saídas" em volume é sinal de operação mal classificada.
- **Dados:** C170/C190: `CFOP`, `CST_ICMS`, `VL_OPR`, `VL_ICMS`; C100: `COD_PART`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** risco

#### IC16 · Benefícios fiscais e crédito presumido
- **Confere:** créditos presumidos e outros benefícios lançados por ajuste (E111, pelo tipo do código), valor por mês e por estabelecimento; estorno exigido pelo benefício; registro contábil (ECD) como subvenção.
- **Por que importa:** benefício usado sem cumprir a condição é cobrado de volta com multa. O valor também pesa no IRPJ/CSLL e no PIS/COFINS (STF, Tema 843; STJ, Tema 1182; Lei 14.789/2023, com disputa aberta de 2024 em diante).
- **Dados:** E111: `COD_AJ_APUR`, `VL_AJ_APUR`; E115: `COD_INF_ADIC`, `VL_INF_ADIC`; ECD I155 e I250. **Temos.** **Falta:** o ato concessivo de cada benefício.
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco e indicador

#### IC17 · Combustíveis: movimentação diária
- **Confere:** onde houver posto: 1300 por item e dia (`ESTQ_ABERT` + `VOL_ENTR` − `VOL_SAIDAS` = `ESTQ_ESCR`), perdas e ganhos (`VAL_AJ_PERDA`, `VAL_AJ_GANHO`) acima do tolerado, e ICMS monofásico das notas (`imposto_icms_qbcmonoret`, `imposto_icms_vicmsmonoret`).
- **Por que importa:** ganho de volume acima do limite é tratado como entrada sem nota. O limite (0,6%) é o da regulamentação da ANP, a confirmar.
- **Dados:** 1300 (todos os campos); 0206: `COD_COMB`; XML: `prod_cprodanp`, `imposto_icms_qbcmonoret`, `imposto_icms_vicmsmonoret`, `imposto_icms_adremicmsret`. **Temos**, se houver posto.
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

---

## 7. ICMS-ST (ST)

#### ST01 · Ressarcimento: venda ao consumidor abaixo da base presumida
- **Confere:** por item com ST retida na compra, a base de ST por unidade (`imposto_icmsst_vbcst` ÷ quantidade, ou `imposto_icms_vbcstret`) contra o preço de venda ao consumidor final. Venda abaixo da base presumida = ST paga a maior.
- **Por que importa:** é devida a restituição da diferença (STF, Tema 201, RE 593.849; vale para operações a partir de 19/10/2016). Em supermercado, com promoções, a diferença é frequente. Atenção: os estados cobram o complemento quando a venda supera a base, e cada UF tem rito e arquivo próprios para o pedido.
- **Dados:** compra: XML: `prod_cprod`, `prod_cean`, `prod_qcom`, `imposto_icmsst_vbcst`, `imposto_icmsst_vicmsst`, `imposto_icms_vbcstret`, `imposto_icms_vicmsstret`; EFD ICMS/IPI C170: `COD_ITEM`, `QTD`, `VL_BC_ICMS_ST`, `VL_ICMS_ST`. Venda: Contribuições C170: `COD_ITEM`, `QTD`, `VL_ITEM`, `CST_ICMS`. **Temos** a compra. A venda por item depende de os cupons e NFC-e estarem por item (C170) na Contribuições ou de termos o XML de NFC-e; a EFD ICMS/IPI tem o C176 e o layout do leitor **não tem** os registros de ressarcimento mais novos (C180 a C186, a confirmar).
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### ST02 · Produto com ST tributado de novo na saída
- **Confere:** itens cuja entrada veio com ST retida (CST 10, 30, 60, 70 ou `VL_ICMS_ST` > 0) e que saem com CST 00 e débito de ICMS próprio (CFOP 5102 em vez de 5405).
- **Por que importa:** ICMS pago duas vezes sobre a mesma mercadoria: na ST da compra e no débito da venda. Recuperável em 5 anos.
- **Dados:** entrada: EFD ICMS/IPI C170: `COD_ITEM`, `CST_ICMS`, `CFOP`, `VL_ICMS_ST`; XML: `imposto_icms_cst`, `imposto_icmsst_vicmsst`. Saída: Contribuições C170: `COD_ITEM`, `CST_ICMS`, `CFOP`, `VL_ICMS`. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### ST03 · Produto sem ST na entrada saindo como substituído
- **Confere:** o inverso da ST02: entrada tributada normalmente (CST 00, sem ST) e saída com CST 60 e CFOP 5405, sem débito.
- **Por que importa:** venda sem imposto nenhum. É o achado dos programas do Rio Grande do Sul e de São Paulo para supermercados.
- **Dados:** os mesmos da ST02. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco

#### ST04 · ST não retida pelo fornecedor de outro estado
- **Confere:** o mesmo NCM/CEST comprado com ST de uns fornecedores e sem ST de outros; compras interestaduais de item sujeito a ST sem retenção e sem antecipação lançada pelo destinatário (E111, C197, E210).
- **Por que importa:** quando o remetente não retém, o destinatário responde pelo imposto na entrada. Esquecido, vira autuação com multa.
- **Dados:** XML: `prod_ncm`, `prod_cest`, `imposto_icms_cst`, `imposto_icmsst_vicmsst`, `emit_cnpj`; EFD C170; C197; E210: `VL_OUT_DEB_ST`. **Temos.** **Falta:** a lista de produtos em ST de cada UF.
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco

#### ST05 · ST retida a maior ou a menor pelo fornecedor
- **Confere:** recalcula a ST de cada item comprado (base = valor + IPI + frete + despesas, com a margem de valor agregado; ST = base × alíquota interna − ICMS próprio) e compara com o destacado.
- **Por que importa:** ST a maior é custo indevido, cobrado do fornecedor ou ressarcido; a menor, o destinatário responde solidariamente em vários estados.
- **Dados:** XML: `prod_vprod`, `imposto_ipi_vipi`, `imposto_icms_vicms`, `imposto_icms_pmvast`, `imposto_icmsst_vbcst`, `imposto_icmsst_picmsst`, `imposto_icmsst_vicmsst`, `imposto_icmsst_modbcst`. **Temos.** **Falta:** margens (MVA) e alíquotas por UF, e frete e despesas do XML.
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** oportunidade e risco

#### ST06 · CFOP × CST da substituição tributária
- **Confere:** CFOP de substituído (5405, 6404, 1403, 2403) com CST diferente de 60 ou 10; CFOP de venda normal (5102) com CST 60; CST 10 ou 70 em estabelecimento que não é substituto.
- **Por que importa:** CFOP e CST que não combinam são o sinal mais barato de cadastro errado; e são validação de várias SEFAZ.
- **Dados:** C170 e C190 (as duas EFD): `CFOP`, `CST_ICMS`, `VL_ICMS`, `VL_ICMS_ST`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### ST07 · CEST ausente, inválido ou incompatível com o NCM
- **Confere:** item com ST e sem CEST; CEST fora da tabela; CEST que não corresponde ao NCM.
- **Por que importa:** o CEST identifica a mercadoria sujeita a ST (Convênio ICMS 142/2018) e é exigido na NF-e; erro gera rejeição e ST indevida ou omitida.
- **Dados:** EFD ICMS/IPI 0200: `COD_NCM`, `CEST`; XML: `prod_ncm`, `prod_cest`. **Temos.** **Falta:** a tabela de CEST do Convênio (pública).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### ST08 · Apuração da ST (E210) × documentos
- **Confere:** `VL_RETENÇAO_ST` = soma do `VL_ICMS_ST` dos analíticos de saída para a UF; `VL_DEVOL_ST` e `VL_RESSARC_ST` contra as notas de devolução e de ressarcimento; ST destacada na nota e registrada a menor.
- **Por que importa:** ST registrada a menor na saída é malha em Goiás (Malha 138).
- **Dados:** E200: `UF`; E210: `VL_RETENÇAO_ST`, `VL_DEVOL_ST`, `VL_RESSARC_ST`, `VL_ICMS_RECOL_ST`; C190: `CFOP`, `VL_BC_ICMS_ST`, `VL_ICMS_ST`; XML da emissão própria. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e risco

#### ST09 · Ressarcimento por saída interestadual e por perda
- **Confere:** mercadoria comprada com ST retida que saiu para outro estado (venda ou transferência, CFOP 6404, 6409, 6152) ou que se perdeu, sem ressarcimento lançado (C176, `VL_RESSARC_ST` do E210, ajuste).
- **Por que importa:** o fato gerador presumido não aconteceu no estado: a ST retida deve ser devolvida (Constituição, art. 150, § 7º; LC 87/1996, art. 10). Em rede com lojas em mais de um estado é valor relevante.
- **Dados:** saídas: C170/C190: `CFOP`, `CST_ICMS`, `COD_ITEM`, `QTD`; C176: `QUANT_ULT_E`, `VL_UNIT_BC_ST`, `VL_UNIT_RES`, `CHAVE_NFE_ULT_E`, `COD_MOT_RES`; E210; entradas com ST do mesmo item. **Temos.**
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### ST10 · Mudança de regime: estoque de produtos que entraram ou saíram da ST
- **Confere:** inventários com motivo de mudança de tributação (`MOT_INV` 02 a 05) e o ICMS do estoque (H020); crédito ou débito correspondente na apuração.
- **Por que importa:** quando um produto sai da ST, a ST paga sobre o estoque vira crédito; quando entra, há imposto a recolher sobre o estoque. É valor de uma vez só, fácil de esquecer.
- **Dados:** H005: `DT_INV`, `VL_INV`, `MOT_INV`; H010; H020: `CST_ICMS`, `BC_ICMS`, `VL_ICMS`; E111. **Temos.** **Falta:** o calendário das mudanças de ST em cada UF.
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade e risco

---

## 8. IPI (IP)

O comércio varejista não é contribuinte do IPI, salvo estabelecimento equiparado a industrial (importador, por
exemplo). Para a rede, o IPI é sobretudo custo de compra.

#### IP01 · Crédito de IPI em estabelecimento não contribuinte
- **Confere:** `VL_IPI` das entradas levado a crédito (E510, `VL_CRED_IPI` do E520) em estabelecimento que não é industrial nem equiparado (0000 `IND_ATIV`, 0002).
- **Por que importa:** crédito sem direito; a Receita cruza o saldo de IPI da EFD com a DCTF (Malha Fiscal Digital, parâmetro 30.001).
- **Dados:** 0000: `IND_ATIV`; 0002: `CLAS_ESTAB_IND`; C170: `CST_IPI`, `VL_BC_IPI`, `ALIQ_IPI`, `VL_IPI`; E510; E520. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### IP02 · Apuração do IPI (equiparados)
- **Confere:** E520: `VL_SD_IPI` ou `VL_SC_IPI` = saldo anterior + débitos + outros débitos − créditos − outros créditos; E510 × soma dos C170 por CFOP e CST; ajustes do E530.
- **Por que importa:** onde há apuração de IPI, é o número que vai para a DCTF.
- **Dados:** E500, E510: `CFOP`, `CST_IPI`, `VL_BC_IPI`, `VL_IPI`; E520; E530. **Temos**, se houver.
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### IP03 · IPI da compra no custo e nas bases
- **Confere:** IPI destacado no XML × `VL_IPI` escriturado; IPI não recuperável tratado como custo; IPI dentro da base do ICMS-ST e da base do crédito de PIS/COFINS.
- **Por que importa:** IPI esquecido no custo distorce a margem e o estoque. A inclusão do IPI não recuperável na base do crédito de PIS/COFINS mudou com a IN RFB 2.121/2022 (a confirmar o artigo e a vigência).
- **Dados:** XML: `imposto_ipi_cstc`, `imposto_ipi_vbc`, `imposto_ipi_pipi`, `imposto_ipi_vipi`; C170: `VL_IPI`, `VL_BC_PIS`. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** erro e risco

#### IP04 · Alíquota de IPI × TIPI
- **Confere:** alíquota de IPI cobrada pelo fornecedor em cada NCM contra a TIPI; o mesmo NCM com alíquotas diferentes entre fornecedores.
- **Por que importa:** IPI cobrado a maior é custo; e alíquota diferente para o mesmo NCM costuma revelar NCM errado na nota do fornecedor.
- **Dados:** XML: `prod_ncm`, `imposto_ipi_pipi`, `imposto_ipi_cenq`, `emit_cnpj`. **Temos.** **Falta:** a TIPI vigente em cada data (pública).
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro (do fornecedor)

#### IP05 · CST e enquadramento do IPI
- **Confere:** `CST_IPI` de entrada (00 a 49) em saída e de saída (50 a 99) em entrada; CST tributado sem valor; isento ou suspenso com valor; `COD_ENQ` incompatível com o CST.
- **Por que importa:** qualidade da escrituração; evita advertência do PVA e questionamento em fiscalização.
- **Dados:** C170: `CST_IPI`, `COD_ENQ`, `VL_BC_IPI`, `ALIQ_IPI`, `VL_IPI`; C100: `IND_OPER`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

---

## 9. CIAP: crédito de ICMS do ativo imobilizado (CP)

O crédito do ICMS na compra de ativo é tomado em 48 parcelas mensais, na proporção das saídas tributadas sobre o total
(LC 87/1996, art. 20, § 5º). O que sobra depois do 48º mês é cancelado.

#### CP01 · Ativo comprado com ICMS e fora do CIAP
- **Confere:** entradas de ativo imobilizado (CFOP 1551, 2551, 1406, 2406) com ICMS destacado cuja nota não aparece em nenhum G130 (`CHV_NFE_CTE`) nem em G125 de imobilização.
- **Por que importa:** dinheiro a recuperar: o ICMS de equipamentos de refrigeração, gôndolas, empilhadeiras, veículos e informática. A apropriação pode começar depois, dentro do prazo.
- **Dados:** C100: `CHV_NFE`; C170: `CFOP`, `COD_ITEM`, `VL_ITEM`, `VL_ICMS`; XML: `imposto_icms_vicms`; G125: `COD_IND_BEM`, `DT_MOV`, `TIPO_MOV`, `VL_IMOB_ICMS_OP`; G130: `CHV_NFE_CTE`, `NUM_DOC`; G140. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim (bem ligado à atividade; vedações da UF) · **Resultado:** oportunidade de recuperação

#### CP02 · Estabelecimentos sem bloco G
- **Confere:** estabelecimentos com compras de ativo (CP01) e bloco G sem movimento; ou bloco G só em alguns estabelecimentos da rede.
- **Por que importa:** mostra de uma vez onde o CIAP não é feito. Com ~120 estabelecimentos, é comum existir só na matriz.
- **Dados:** G001: `IND_MOV`; G110; C170 com CFOP de ativo. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** oportunidade e indicador

#### CP03 · Coeficiente de aproveitamento subestimado
- **Confere:** recalcula `IND_PER_SAI` = `VL_TRIB_EXP` ÷ `VL_TOTAL` com as saídas do mês (C190, C490, C850 por CST e CFOP) e compara com o G110; saídas que deveriam estar no numerador (exportação e, conforme a UF, saídas com ST) ou fora do denominador (transferências, remessas, devoluções).
- **Por que importa:** o coeficiente multiplica toda parcela do mês. Em supermercado ele é baixo por causa das saídas isentas e com ST; cada ponto percentual recuperado vale para todos os bens.
- **Dados:** G110: `SOM_PARC`, `VL_TRIB_EXP`, `VL_TOTAL`, `IND_PER_SAI`, `ICMS_APROP`; analíticos de saída: `CST_ICMS`, `CFOP`, `VL_OPR`. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim (o que entra no numerador varia por UF) · **Resultado:** oportunidade de recuperação

#### CP04 · Parcelas: cálculo, sequência e fim
- **Confere:** `VL_PARC_PASS` = ICMS do bem ÷ 48; `NUM_PARC` em sequência e até 48; parcela pulada; parcela depois da baixa do bem (`TIPO_MOV` de alienação, perecimento ou transferência); `ICMS_APROP` = `SOM_PARC` × `IND_PER_SAI`.
- **Por que importa:** parcela pulada é crédito perdido; parcela depois da venda do bem é crédito indevido.
- **Dados:** G125: `COD_IND_BEM`, `DT_MOV`, `TIPO_MOV`, `VL_IMOB_ICMS_OP`, `VL_IMOB_ICMS_ST`, `VL_IMOB_ICMS_FRT`, `VL_IMOB_ICMS_DIF`, `NUM_PARC`, `VL_PARC_PASS`; G110; G126. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e oportunidade

#### CP05 · ST, frete e DIFAL do ativo dentro do CIAP
- **Confere:** bens com ICMS-ST na compra, CT-e de frete com ICMS ou DIFAL pago na entrada interestadual, e `VL_IMOB_ICMS_ST`, `VL_IMOB_ICMS_FRT` ou `VL_IMOB_ICMS_DIF` zerados.
- **Por que importa:** os quatro valores compõem o crédito do bem; o DIFAL do ativo é o mais esquecido e costuma ser o maior nas compras de outro estado.
- **Dados:** G125 (campos acima); C170: `VL_ICMS_ST`; D100: `VL_ICMS`; C197/E111 de DIFAL. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CP06 · Crédito do CIAP × apuração
- **Confere:** `ICMS_APROP` + `SOM_ICMS_OC` do G110 contra o ajuste de crédito de CIAP no E111 do mesmo mês.
- **Por que importa:** crédito calculado no bloco G e não levado ao E110 não reduz o imposto; ajuste maior que o G110 é malha (Paraná, ajuste PR020021).
- **Dados:** G110: `ICMS_APROP`, `SOM_ICMS_OC`; E111: `COD_AJ_APUR`, `VL_AJ_APUR`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro, risco e oportunidade

#### CP07 · Cadastro dos bens
- **Confere:** 0300 sem conta contábil (`COD_CTA`), sem 0305 (função, vida útil, centro de custo); bem que é uso e consumo ou obra civil no CIAP; componente (`IDENT_MERC` 2) sem bem principal (`COD_PRNC`).
- **Por que importa:** bem alheio à atividade ou incorporado a imóvel não dá crédito (LC 87/1996, art. 20, § 1º); cadastro pobre é o argumento da glosa.
- **Dados:** 0300: `COD_IND_BEM`, `IDENT_MERC`, `DESCR_ITEM`, `COD_PRNC`, `COD_CTA`, `NR_PARC`; 0305: `COD_CCUS`, `FUNC`, `VIDA_UTIL`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** risco

#### CP08 · CIAP × imobilizado contábil × crédito de PIS/COFINS
- **Confere:** por ano, adições do imobilizado na ECD × imobilizações do G125 × bens do F120/F130 da EFD Contribuições.
- **Por que importa:** as três visões do mesmo bem. Bem que está na contabilidade e não está no CIAP nem no F130 aponta dois créditos não tomados de uma vez (CP01 e CR06).
- **Dados:** ECD I155 e I250 das contas do imobilizado; G125; 0300; F120; F130. **Temos.** **Falta:** o controle patrimonial para ligar bem a bem.
- **Dificuldade:** alta · **Tributarista:** não · **Resultado:** oportunidade e indicador

---

## 10. Inventário e estoque (ES)

#### ES01 · Inventário: totais e contas
- **Confere:** `VL_INV` do H005 = soma do `VL_ITEM` dos H010; em cada H010, `QTD` × `VL_UNIT` = `VL_ITEM`; item sem 0200; unidade diferente da `UNID_INV`.
- **Por que importa:** o inventário é a base do levantamento de estoque do fisco e do custo no IRPJ. Em São Paulo, inventário incompleto tem multa de 1% do estoque (RICMS-SP, art. 527).
- **Dados:** H005: `DT_INV`, `VL_INV`, `MOT_INV`; H010: `COD_ITEM`, `UNID`, `QTD`, `VL_UNIT`, `VL_ITEM`, `IND_PROP`, `COD_PART`, `COD_CTA`, `VL_ITEM_IR`. **Temos** (`bloco_h_inventario`).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### ES02 · Inventário anual ausente
- **Confere:** estabelecimento sem H005 com `MOT_INV` 01 na data do balanço, no arquivo do prazo (em regra o de fevereiro; a data varia por UF).
- **Por que importa:** inventário não entregue tem multa e autoriza o fisco a arbitrar o estoque.
- **Dados:** 0000: `CNPJ`, `DT_INI`; H005. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### ES03 · Itens do inventário com quantidade ou valor estranho
- **Confere:** quantidade negativa ou zerada com valor; valor unitário zero; valor unitário muito diferente do custo médio das últimas entradas do item; o mesmo item com valor unitário muito diferente entre lojas.
- **Por que importa:** estoque supervalorizado ou subavaliado muda o lucro tributável e esconde perda ou desvio.
- **Dados:** H010: `COD_ITEM`, `QTD`, `VL_UNIT`, `VL_ITEM`; entradas: C170 `COD_ITEM`, `QTD`, `VL_ITEM`. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e indicador

#### ES04 · Levantamento quantitativo de estoque
- **Confere:** por estabelecimento e item, no ano: estoque inicial (H010 do inventário anterior) + entradas (C170 de entrada, `QTD`) − saídas (itens de saída) = estoque final (H010). Sobra de saídas = entrada sem nota; falta de saídas = venda sem nota (ou perda não baixada).
- **Por que importa:** é a auditoria clássica das SEFAZ e também da Receita (Lei 9.430/1996, art. 41, com o § 3º estendendo ao comércio): a diferença é presumida omissão de receita, com imposto e multa (em São Paulo, 80% no levantamento fiscal, art. 527, I, "a"). Fazer antes do fisco permite corrigir cadastro, unidade e baixa de perdas.
- **Dados:** H010 de dois inventários seguidos; EFD ICMS/IPI C170 (entradas): `COD_ITEM`, `QTD`, `UNID`, `CFOP`; saídas por item: EFD Contribuições C170 (`COD_ITEM`, `QTD`, `CFOP`), EFD ICMS/IPI C425/C470 (ECF); 0220: `FAT_CONV`; 0205 (troca de código). **Temos** entradas e inventário. A saída por item depende de os cupons e NFC-e estarem por item na Contribuições ou de termos o XML de NFC-e (**a verificar nos arquivos**).
- **Dificuldade:** alta · **Tributarista:** não · **Resultado:** risco

#### ES05 · Estoque do inventário × estoque contábil
- **Confere:** soma do `VL_INV` de todos os estabelecimentos na data do balanço × saldo das contas de estoque na ECD (I155 de dezembro; J100).
- **Por que importa:** a Receita compara o estoque declarado nas duas escriturações; a diferença altera o custo das mercadorias vendidas e o lucro.
- **Dados:** H005: `DT_INV`, `VL_INV`; H010: `COD_CTA`, `VL_ITEM_IR`; ECD I155: `COD_CTA`, `VL_SLD_FIN`, `IND_DC_FIN`; I050/I051; J100. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### ES06 · Bloco K (se entregue) × inventário
- **Confere:** K200 em 31/12 × H010 da mesma data, por item; continuidade mensal do K200; movimentações internas (K220) e produção própria (K230, K235).
- **Por que importa:** duas declarações do mesmo estoque que não batem. Em Mato Grosso houve notificação em massa por K200 omitido.
- **Dados:** K100; K200: `DT_EST`, `COD_ITEM`, `QTD`, `IND_EST`; K220; K230; K235; H010. **Temos**, se o cliente entrega o bloco K (**a verificar**).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### ES07 · Remessas sem retorno
- **Confere:** remessas para conserto, demonstração, consignação, industrialização e depósito (CFOP 59xx, 69xx) sem a nota de retorno correspondente dentro do prazo; estoque de terceiros e em poder de terceiros no inventário (`IND_PROP` 1 e 2).
- **Por que importa:** remessa que não volta no prazo passa a ser tributada como venda; e mostra mercadoria da empresa parada com terceiros.
- **Dados:** C170: `CFOP`, `COD_ITEM`, `QTD`; C100: `COD_PART`, `DT_DOC`; H010: `IND_PROP`, `COD_PART`. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim (prazos por operação e UF) · **Resultado:** risco

#### ES08 · Item vendido sem nunca ter sido comprado
- **Confere:** `COD_ITEM` com saídas e sem entradas, transferência recebida, produção nem estoque inicial; item comprado que nunca sai nem aparece no inventário.
- **Por que importa:** sinal de código trocado entre compra e venda, o que falseia estoque, margem e tributação por item (um monofásico vendido com código de item tributado).
- **Dados:** itens de entrada e de saída por `COD_ITEM`; H010; 0205. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro

#### ES09 · Venda abaixo do custo
- **Confere:** por item e mês, preço médio de venda menor que o custo médio de entrada (líquido de impostos recuperáveis), por loja.
- **Por que importa:** para o fisco é indício de subfaturamento, que autoriza arbitramento; para o dono é margem negativa: promoção, erro de preço ou perda.
- **Dados:** entradas: C170 `COD_ITEM`, `QTD`, `VL_ITEM`, `VL_ICMS`, `VL_IPI`; saídas por item: `QTD`, `VL_ITEM`, `VL_DESC`. **Temos** (com a ressalva da ES04 para a venda por item).
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco e indicador

#### ES10 · Custo das mercadorias: fiscal × contábil
- **Confere:** estoque inicial + compras líquidas (entradas com CFOP de compra, menos impostos recuperáveis e devoluções) − estoque final, contra o custo das mercadorias vendidas na ECD (referencial 3.01.01.03).
- **Por que importa:** o custo é a maior dedução do lucro real. Diferença grande pede explicação antes que a Receita pergunte.
- **Dados:** H005; analíticos de entrada: `CFOP`, `VL_OPR`, `VL_ICMS`; ECD I155 e I355 das contas de custo. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco e indicador

#### ES11 · Itens parados e giro do estoque
- **Confere:** itens do inventário sem venda nos últimos 6 ou 12 meses; dias de cobertura por item, categoria e loja; valor parado.
- **Por que importa:** capital de giro preso. Não é fiscal, mas é o tipo de número que o dono usa na semana seguinte.
- **Dados:** H010; saídas por item e mês. **Temos** (inventário só uma vez por ano: o giro mensal é estimado pelas entradas e saídas).
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** indicador

---

## 11. Contábil (ECD) e contábil × fiscal (CT)

A ECD é uma por empresa e ano. As regras que comparam com as EFD precisam dizer quais contas são de receita, de
tributos, de estoque, de aluguel e assim por diante: o plano referencial (I051) resolve boa parte; o resto é
mapeamento por cliente.

#### CT01 · Integridade da escrituração
- **Confere:** em cada lançamento (I200), `VL_LCTO` = soma dos débitos = soma dos créditos dos I250; em cada conta e mês, `VL_SLD_FIN` = `VL_SLD_INI` + `VL_DEB` − `VL_CRED` (com o sinal de `IND_DC`); saldo final de um mês = inicial do seguinte; saldo de dezembro = inicial de janeiro da ECD seguinte; soma dos I250 do mês = `VL_DEB` e `VL_CRED` do I155.
- **Por que importa:** é a prova de que o livro fecha. Erro aqui invalida a ECD como prova a favor da empresa.
- **Dados:** I150: `DT_INI`, `DT_FIN`; I155 (todos os campos); I200: `NUM_LCTO`, `DT_LCTO`, `VL_LCTO`, `IND_LCTO`; I250: `COD_CTA`, `VL_DC`, `IND_DC`; I157. **Temos.**
- **Dificuldade:** média (volume de I250) · **Tributarista:** não · **Resultado:** erro

#### CT02 · Demonstrações × saldos
- **Confere:** linhas do balanço (J100) e da DRE (J150) contra a soma das contas pelo código de aglutinação (I052) nos saldos do I155 e do I355; ativo = passivo + patrimônio líquido; lucro do J150 = variação do patrimônio explicada.
- **Por que importa:** as demonstrações assinadas têm de sair dos saldos. O dashboard da ECD já confere o lucro da DRE contra o J150; esta regra estende ao balanço.
- **Dados:** I052: `COD_AGL`; I155; I355: `COD_CTA`, `VL_CTA`, `IND_DC`; J100: `COD_AGL`, `VL_CTA_INI`, `VL_CTA_FIN`, `IND_DC_CTA_FIN`, `IND_GRP_BAL`; J150. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro

#### CT03 · Plano referencial: contas sem mapeamento ou mapeadas errado
- **Confere:** conta analítica sem I051; conta de natureza de ativo (`COD_NAT` 01) ligada a referencial de passivo ou de resultado, e semelhantes; contas com saldo relevante na referencial "outras".
- **Por que importa:** a ECF recupera os saldos pela referencial: mapeamento errado leva receita, custo e despesa para a linha errada do lucro real.
- **Dados:** I050: `COD_NAT`, `IND_CTA`, `NIVEL`, `COD_CTA`, `COD_CTA_SUP`, `CTA`; I051: `COD_CTA_REF`; I155. **Temos** (dimensão `plano_contas`).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CT04 · Contas com saldo invertido
- **Confere:** caixa e bancos com saldo credor; clientes e estoques credores; fornecedores, salários e tributos a recolher com saldo devedor; no fim de cada mês.
- **Por que importa:** saldo credor de caixa é presunção legal de omissão de receita (RIR/2018, art. 293). Os demais mostram lançamento em conta errada ou baixa em duplicidade.
- **Dados:** I050: `COD_NAT`, `CTA`; I051; I155: `VL_SLD_FIN`, `IND_DC_FIN`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### CT05 · Saldo credor de caixa dia a dia
- **Confere:** reconstrói o saldo diário da conta caixa pelos lançamentos (I250 com a data do I200) e aponta os dias em que fica negativo.
- **Por que importa:** o saldo mensal pode esconder dias de caixa "estourado". É o teste que o auditor fiscal faz. Base legal: RIR/2018, art. 293.
- **Dados:** I200: `DT_LCTO`; I250: `COD_CTA`, `VL_DC`, `IND_DC`; I155: `VL_SLD_INI`. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

#### CT06 · Passivo sem movimento (passivo fictício)
- **Confere:** contas de fornecedores, empréstimos e outras obrigações com saldo parado por 12 meses ou mais; obrigação mantida depois de paga (por participante, quando o I250 traz o `COD_PART`).
- **Por que importa:** obrigação já paga ou sem exigibilidade comprovada mantida no passivo é presunção de omissão de receita (Lei 9.430/1996, art. 40).
- **Dados:** I155; I250: `COD_CTA`, `VL_DC`, `IND_DC`, `COD_PART`, `HIST`; 0150. **Temos.** **Falta:** a posição por fornecedor, se a contabilidade não lança por participante.
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

#### CT07 · Suprimentos de caixa e operações com sócios
- **Confere:** entradas em caixa ou bancos com contrapartida em contas de sócios, mútuos, adiantamentos para aumento de capital e empréstimos; participantes com código de relacionamento (0180).
- **Por que importa:** dinheiro entregue por sócio sem prova de origem e de entrega é presunção de omissão de receita (RIR/2018, artigo a confirmar entre 294 e 298); mútuo com parte relacionada tem IOF.
- **Dados:** I200; I250: `COD_CTA`, `VL_DC`, `IND_DC`, `HIST`, `COD_PART`; 0150; 0180: `COD_REL`, `DT_INI_REL`. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco

#### CT08 · Receita contábil × receita fiscal
- **Confere:** a perna contábil da CZ15, aberta por conta e mês, com as diferenças explicáveis: devoluções, vendas canceladas, vendas para entrega futura, receita de serviços, bonificações.
- **Por que importa:** é o cruzamento da Malha Fiscal Digital da Receita (parâmetro 10.001: receita da ECF contra NF-e, EFD ICMS/IPI e EFD Contribuições).
- **Dados:** ECD I155, I355, I051 (referencial 3.01.01.01.01 e deduções); Contribuições M210, M610, M400, M800; EFD ICMS/IPI analíticos de saída. **Temos.** **Falta:** a ECF, que não está entre os arquivos.
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

#### CT09 · PIS/COFINS: contabilidade × apuração
- **Confere:** despesa de PIS e COFINS sobre vendas na ECD × `VL_TOT_CONT_NC_PER` do M200/M600; passivo de PIS e COFINS a recolher × `VL_TOT_CONT_REC`; ativo de créditos a recuperar × `SLD_CRED` do M100/M500 e do 1100/1500.
- **Por que importa:** saldo de imposto a recuperar na contabilidade que não existe na EFD é ativo que não vale; o inverso é crédito que a contabilidade não conhece.
- **Dados:** ECD I155 das contas de PIS/COFINS (pelo nome ou pela referencial); M100, M200, M500, M600; 1100, 1500. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e risco

#### CT10 · ICMS: contabilidade × apuração
- **Confere:** ICMS a recolher na ECD × soma do `VL_ICMS_RECOLHER` (E110), do `VL_ICMS_RECOL_ST` (E210) e do DIFAL (E310) de todos os estabelecimentos; ICMS a recuperar × soma dos saldos credores; CIAP a recuperar × parcelas a apropriar do bloco G.
- **Por que importa:** a mesma lógica da CT09. Numa rede, a contabilidade é uma só e a apuração é por loja: a soma raramente é conferida.
- **Dados:** ECD I155; E110; E210; E310; G110; G125. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro e risco

#### CT11 · Compras: fiscal × contábil
- **Confere:** entradas com CFOP de compra por mês (analíticos da EFD ICMS/IPI) × créditos em fornecedores e débitos em estoques e custos na ECD.
- **Por que importa:** compra na contabilidade sem nota aponta entrada não escriturada (CZ02); nota sem contabilização aponta passivo omitido.
- **Dados:** analíticos de entrada: `CFOP`, `VL_OPR`; ECD I155 e I250 de fornecedores e estoques. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

#### CT12 · Despesas com direito a crédito × créditos tomados
- **Confere:** por natureza (energia, aluguéis, fretes sobre vendas, armazenagem, depreciação de edificações e benfeitorias): despesa do ano na ECD × base de crédito no M105/M505 com a `NAT_BC_CRED` correspondente.
- **Por que importa:** é o mapa que mostra, em uma tela, quanto de crédito de PIS/COFINS ficou sem tomar em cada natureza. É a porta de entrada das CR02 a CR06.
- **Dados:** ECD I050, I051, I155; M105/M505: `NAT_BC_CRED`, `VL_BC_PIS_TOT`. **Temos.** **Falta:** o mapeamento das contas de despesa para cada natureza de crédito.
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade de recuperação

#### CT13 · Outras receitas sem tributação
- **Confere:** receitas da ECD fora da venda de mercadorias (financeiras, aluguéis recebidos, recuperação de despesas, bonificações, venda de sucata, indenizações) × F100 e bloco M.
- **Por que importa:** no regime não cumulativo todas as receitas são tributadas, salvo exclusão expressa (Lei 10.833/2003, art. 1º). Receita "não operacional" esquecida é o achado mais comum de fiscalização de PIS/COFINS.
- **Dados:** ECD I155 e I355 das contas de receita por referencial; F100: `VL_OPER`, `CST_PIS`, `COD_CTA`; M210; M400. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco

#### CT14 · Lançamentos atípicos
- **Confere:** lançamentos de valor redondo e alto; em fim de semana ou feriado; com histórico de "ajuste", "acerto", "estorno" ou "diversos"; em contas de resultado nos últimos dias do exercício; lançamentos extemporâneos (`DT_LCTO_EXT`); distribuição do primeiro dígito (Lei de Benford) por conta.
- **Por que importa:** qualidade da contabilidade e proteção contra erro e fraude interna. É o que uma auditoria independente faz por amostragem; aqui é sobre todos os lançamentos.
- **Dados:** I200: `NUM_LCTO`, `DT_LCTO`, `VL_LCTO`, `IND_LCTO`, `DT_LCTO_EXT`; I250: `COD_CTA`, `VL_DC`, `IND_DC`, `HIST`, `COD_HIST_PAD`; I075. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** indicador

#### CT15 · Despesas sensíveis para o lucro real
- **Confere:** saldos de multas, brindes, doações, provisões, despesas de sócios e outras contas de dedutibilidade restrita (pela referencial e pelo nome).
- **Por que importa:** são as adições obrigatórias ao lucro real. Sem a ECF não dá para conferir se foram adicionadas; a regra entrega a lista e o valor para o contador conferir. Base legal: RIR/2018 (artigos a confirmar por despesa).
- **Dados:** ECD I050, I051, I155, I355. **Temos.** **Falta:** a ECF (e-Lalur).
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** risco e indicador

#### CT16 · Imobilizado e depreciação
- **Confere:** contas do imobilizado sem depreciação no ano; taxa efetiva (depreciação ÷ custo) fora da faixa esperada por grupo; adições e baixas por ano.
- **Por que importa:** depreciação não lançada é despesa dedutível perdida no ano; taxa acima da fiscal pede ajuste no lucro real (IN RFB 1.700/2017, Anexo III, a confirmar).
- **Dados:** ECD I050, I155 das contas de imobilizado e de depreciação acumulada; I250. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade e risco

#### CT17 · Juros sobre capital próprio não aproveitados
- **Confere:** patrimônio líquido de cada ano (J100) e lucros do período × juros sobre capital próprio lançados; estima o limite dedutível.
- **Por que importa:** os juros pagos aos sócios são despesa dedutível do IRPJ e da CSLL, dentro de limites (Lei 9.249/1995, art. 9º, com as mudanças da Lei 14.789/2023). É planejamento para os próximos exercícios, não recuperação do passado.
- **Dados:** J100: `COD_AGL`, `DESCR_COD_AGL`, `VL_CTA_FIN`, `IND_GRP_BAL`; I155 das contas do patrimônio líquido e de despesa de JCP; J150. **Temos.** **Falta:** a TJLP do período (pública).
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** oportunidade (planejamento)

#### CT18 · Troca de plano de contas e de sistema
- **Confere:** anos com `IND_MUDANC_PC` marcado e I157: saldos transferidos conta a conta; contas que somem sem transferência.
- **Por que importa:** é na troca de plano ou de sistema que saldos de créditos tributários e de obrigações se perdem.
- **Dados:** 0000: `IND_MUDANC_PC`, `COD_PLAN_REF`; I157: `COD_CTA`, `VL_SLD_INI`, `IND_DC_INI`; I155 do ano anterior. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CT19 · Dados cadastrais e formais da ECD
- **Confere:** signatários (J930) com contador e responsável legal; termos de abertura e encerramento (I030, J900) coerentes; ECD substituta (`IND_FIN_ESC`, `COD_HASH_SUB`); livros auxiliares (I012).
- **Por que importa:** vício formal tira a força de prova do livro; a multa por informação inexata na escrituração digital é a do art. 12 da Lei 8.218/1991.
- **Dados:** 0000; I010; I012; I030; J900; J930: `IDENT_NOM`, `IDENT_QUALIF`, `IND_CRC`, `IND_RESP_LEGAL`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

---

## 12. Cadastro: NCM, CEST, CFOP e CST (CD)

O cadastro de produtos é a causa de quase todo achado de valor. Estas regras olham o cadastro em si.

#### CD01 · NCM inválido, vencido ou genérico
- **Confere:** `COD_NCM` que não tem 8 dígitos, que não existe na tabela vigente na data do documento, ou genérico (00000000, capítulo 99); item de mercadoria sem NCM.
- **Por que importa:** NCM inexistente rejeita a NF-e e impede saber o tratamento do produto. A NCM mudou em 2022 (a confirmar a resolução): cadastros antigos ficam com códigos extintos.
- **Dados:** 0200 das duas EFD: `COD_ITEM`, `DESCR_ITEM`, `COD_NCM`, `TIPO_ITEM`; XML: `prod_ncm`, `ncm_vigencia`. **Temos.** **Falta:** a tabela NCM com vigências (pública, Siscomex).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CD02 · NCM do cadastro × NCM do fornecedor
- **Confere:** para cada item comprado, o NCM do 0200 contra o NCM do mesmo item no XML do fornecedor (pela chave e número do item, ou pelo código de barras).
- **Por que importa:** o fabricante é quem classifica o produto. Divergência com ele é o melhor indício de NCM errado no cadastro, e o NCM decide monofásico, alíquota zero e ST.
- **Dados:** XML: `chnfe`, `prod_item`, `prod_cean`, `prod_xprod`, `prod_ncm`; EFD ICMS/IPI C170: `NUM_ITEM`, `COD_ITEM`; 0200: `COD_BARRA`, `COD_NCM`. **Temos.**
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** erro

#### CD03 · Descrição × NCM
- **Confere:** produtos cuja descrição indica uma classe (cerveja, xampu, pneu, arroz, carne) e cujo NCM é de outra; busca por palavras-chave e por semelhança com itens bem classificados.
- **Por que importa:** pega o erro que as outras regras não veem: o NCM existe e é válido, só não é o do produto. É onde se escondem monofásicos e alíquota zero tributados.
- **Dados:** 0200: `DESCR_ITEM`, `COD_NCM`, `COD_BARRA`; XML: `prod_xprod`, `prod_ncm`. **Temos.** **Falta:** um dicionário de termos por capítulo da NCM, ou um classificador.
- **Dificuldade:** alta · **Tributarista:** sim (a classificação final) · **Resultado:** erro e oportunidade

#### CD04 · CST de PIS/COFINS × NCM
- **Confere:** o CST e a alíquota usados em cada item contra o que as tabelas do SPED indicam para o NCM: monofásico (4.3.10), substituição (4.3.12), alíquota zero (4.3.13), isenção (4.3.14), suspensão (4.3.15).
- **Por que importa:** é a matriz tributária sugerida, item a item. Dela saem as PM01, PM03 e CR12; como regra de cadastro, serve para corrigir daqui para a frente.
- **Dados:** 0200: `COD_NCM`; itens: `CST_PIS`, `CST_COFINS`, `ALIQ_PIS`, `ALIQ_COFINS`; XML: `ncm_monofasico`, `ncm_aliq_pis`, `ncm_aliq_cofins`. **Temos.** **Falta:** as tabelas 4.3.10 a 4.3.15.
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** erro e oportunidade

#### CD05 · Combinações inválidas de CFOP, CST do ICMS e CST de PIS/COFINS
- **Confere:** matriz das combinações usadas, com as incoerentes: CFOP de venda com CST de PIS de operação sem receita (49); CFOP de devolução com CST de venda; CFOP inexistente ou fora de vigência; CST do ICMS com origem inválida.
- **Por que importa:** poucas combinações erradas respondem por milhares de itens. Corrigir a regra do sistema corrige todos.
- **Dados:** C170 (as duas EFD): `CFOP`, `CST_ICMS`, `CST_PIS`, `CST_COFINS`, `CST_IPI`. **Temos.** **Falta:** a tabela de CFOP com vigências (pública).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CD06 · Origem da mercadoria
- **Confere:** o primeiro dígito do CST do ICMS (origem) nas saídas contra a origem informada pelo fornecedor; origem importada (1, 2, 3, 8) com alíquota interestadual diferente de 4%; origem nacional com 4%.
- **Por que importa:** a origem define a alíquota interestadual de 4% (Resolução do Senado 13/2012).
- **Dados:** XML: `imposto_icms_orig`, `imposto_icms_picms`; C170: `CST_ICMS` (3 dígitos), `ALIQ_ICMS`, `CFOP`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CD07 · Tipo do item × uso
- **Confere:** `TIPO_ITEM` 00 (mercadoria para revenda) comprado com CFOP de uso e consumo ou de ativo, e o inverso; `TIPO_ITEM` 07 (uso e consumo) ou 08 (ativo) com crédito ou com venda.
- **Por que importa:** o tipo do item define o que pode ter crédito e o que entra no inventário.
- **Dados:** 0200: `COD_ITEM`, `TIPO_ITEM`; C170: `CFOP`, `VL_ICMS`, `CST_PIS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CD08 · Itens duplicados e código reaproveitado
- **Confere:** o mesmo código de barras em mais de um `COD_ITEM`; código de barras com dígito verificador inválido; descrições iguais com códigos diferentes; 0205 com descrição anterior de outro produto (código reaproveitado).
- **Por que importa:** o Guia Prático proíbe reaproveitar o código de um item para outro produto (a confirmar a seção); duplicidade quebra o levantamento de estoque e a margem por item.
- **Dados:** 0200: `COD_ITEM`, `DESCR_ITEM`, `COD_BARRA`, `COD_ANT_ITEM`; 0205: `DESCR_ANT_ITEM`, `DT_INI`, `DT_FIM`, `COD_ANT_ITEM`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CD09 · Cadastro de participantes
- **Confere:** CNPJ ou CPF com dígito inválido; contribuinte sem inscrição estadual; o mesmo CNPJ com vários `COD_PART`; município inexistente.
- **Por que importa:** qualidade da informação; participante mal cadastrado impede cruzar a nota com o XML e com a contabilidade.
- **Dados:** 0150 (as três escriturações): `COD_PART`, `NOME`, `CNPJ`, `CPF`, `IE`, `COD_MUN`. **Temos** (a dimensão `participantes` tem 1,9 milhão de linhas na Contribuições).
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro

#### CD10 · Situação cadastral de fornecedores
- **Confere:** fornecedores com CNPJ baixado, inapto ou suspenso na data da nota; inscrição estadual cancelada ou nula; fornecedor aberto há poucos meses com volume alto.
- **Por que importa:** crédito de nota de emitente com inscrição nula é glosado, e a anulação retroage (Goiás, Malha 137). É o risco de "nota fria".
- **Dados:** 0150: `CNPJ`, `IE`; C100: `COD_PART`, `DT_DOC`, `VL_ICMS`; XML: `emit_cnpj`, `emit_ie`. **Falta:** a base pública de CNPJ da Receita (situação e data) e a consulta de inscrição estadual (Sintegra/CCC).
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

---

## 13. Riscos de autuação e malha (RK)

Os cruzamentos que a Receita e as SEFAZ publicam. Vários já estão nos temas anteriores (a tabela no fim desta seção
liga cada malha à regra do catálogo); aqui ficam os que faltavam.

#### RK01 · PIS/COFINS da EFD × débitos declarados (DCTF)
- **Confere:** valores e códigos de receita dos M205 e M605 contra os débitos de PIS/COFINS da DCTF do mês.
- **Por que importa:** é o parâmetro 20.001 da Malha Fiscal Digital da Receita: divergência gera aviso no e-CAC e, sem regularização, auto com multa mínima de 75% (Lei 9.430/1996, art. 44, I). Na rodada de 2025 foram cerca de 3,1 mil empresas.
- **Dados:** M205/M605: `NUM_CAMPO`, `COD_REC`, `VL_DEBITO`. **Temos** o lado da EFD. **Falta:** a DCTF (ou DCTFWeb) e os pagamentos (DARF) e compensações (PER/DCOMP).
- **Dificuldade:** baixa, depois de ter a DCTF · **Tributarista:** não · **Resultado:** risco

#### RK02 · Cartões e PIX × vendas declaradas
- **Confere:** por mês e por raiz de CNPJ, o total recebido por cartão e PIX contra a soma dos documentos fiscais emitidos (NF-e, NFC-e, cupons).
- **Por que importa:** é o cruzamento de varejo mais documentado: Goiás (Malha 114, consolidada pelo CNPJ base), Pernambuco (indicador i05) e Rio Grande do Sul. As instituições de pagamento informam tudo às SEFAZ pela DIMP (Convênio ICMS 134/2016, com o PIX incluído depois).
- **Dados:** EFD ICMS/IPI 1600: `COD_PART`, `TOT_CREDITO`, `TOT_DEBITO`; vendas: C100 modelo 65, C190, C490, C850. **Temos** as vendas. **Falta:** os extratos das adquirentes (ou a DIMP), e o registro 1601, que substituiu o 1600 e o leitor ainda não tem.
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

#### RK03 · Situação real da nota na SEFAZ × escrituração
- **Confere:** nota cancelada ou denegada na SEFAZ e escriturada como regular (com crédito ou sem débito); nota autorizada escriturada como cancelada (`COD_SIT` 02).
- **Por que importa:** são duas malhas de Goiás (101: crédito de entrada cancelada; 105: autorizada escriturada como cancelada). Também limpa os falsos achados das O03, CZ01 e CZ02.
- **Dados:** C100: `CHV_NFE`, `COD_SIT`, `VL_ICMS`. **Falta:** a situação e os eventos de cada chave (cancelamento, carta de correção, manifestação), por consulta à SEFAZ ou pelos XML de evento.
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

#### RK04 · Notas emitidas contra a empresa e não reconhecidas
- **Confere:** XML com destinatário da empresa, sem escrituração em nenhum estabelecimento, sem devolução e sem recusa; concentração por emitente.
- **Por que importa:** nota recebida e fora de toda EFD é presunção de omissão de saída em Pernambuco (indicador i04). Também revela uso indevido do CNPJ por terceiros; a defesa é a manifestação de "operação não realizada" ou "desconhecimento".
- **Dados:** XML: `chnfe`, `emit_cnpj`, `emit_nome`, `dest_cnpj`, `prod_cfop`, `prod_vprod`; C100 de todos os estabelecimentos. **Temos.** **Falta:** a manifestação do destinatário.
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** risco

#### RK05 · Exposição a multas por erro de escrituração
- **Confere:** para cada regra de erro do catálogo, o valor das operações atingidas e a multa teórica: 3% do valor das transações com informação inexata (MP 2.158-35/2001, art. 57, III) ou 5% da operação, limitada a 1% da receita bruta (Lei 8.218/1991, art. 12, II), com as reduções por correção espontânea.
- **Por que importa:** transforma "erros de cadastro" em reais. Há disputa sobre qual das duas multas vale para as EFD: o número é um teto para priorizar, não uma previsão.
- **Dados:** a tabela `achados` (valor da operação por regra) e a receita bruta do período (0111, M210). **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** indicador

#### RK06 · Relógio dos 5 anos
- **Confere:** por mês de origem, quanto de cada oportunidade de recuperação e de cada saldo de crédito deixa de poder ser pedido nos próximos 3, 6 e 12 meses; e quanto de cada risco deixa de poder ser cobrado.
- **Por que importa:** todo mês um mês antigo caduca. É o argumento mais forte para o dono decidir agora. Base: CTN, arts. 150, § 4º, 168 e 173 (a contagem de cada caso é do tributarista).
- **Dados:** a tabela `achados` com `competencia`, e os saldos da CR11 e da IC09. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** indicador

#### RK07 · Cancelamentos, devoluções e descontos fora do padrão
- **Confere:** por loja e mês: percentual de documentos cancelados, de devoluções de venda e de descontos sobre a venda; lojas e dias fora da faixa da rede.
- **Por que importa:** cancelamento em excesso é como se esconde venda (e desvio de caixa). Em São Paulo, a falta de cancelamento regular de documento eletrônico tem multa de 10% (RICMS-SP, art. 527, IV, "z1"). Não achamos este indicador publicado por nenhum fisco: é sinal de auditoria interna.
- **Dados:** C100: `COD_SIT`, `COD_MOD`, `VL_DOC`, `VL_DESC`; C405/C420 (ECF); C800 (SAT): `COD_SIT`; C380: `VL_DOC_CANC`; devoluções pelo CFOP. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** indicador e risco

#### RK08 · Nota fiscal emitida junto com cupom
- **Confere:** NF-e com CFOP 5929 ou 6929 (emitida para venda já registrada em cupom ou NFC-e): escriturada sem débito e sem duplicar a receita; volume por loja.
- **Por que importa:** escriturada errado, paga o imposto duas vezes ou esconde venda; há autuações sobre esse CFOP (Rondônia).
- **Dados:** C170/C190: `CFOP`, `VL_OPR`, `VL_ICMS`; Contribuições C170: `CFOP`, `CST_PIS`, `VL_PIS`. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** erro e risco

#### RK09 · Venda de atacado em documento de consumidor
- **Confere:** NFC-e e cupons de valor alto, com muitos itens iguais ou com CNPJ no destinatário; o mesmo CPF com compras repetidas de valor alto.
- **Por que importa:** venda a contribuinte por documento de consumidor tira a ST e o crédito do comprador e, em atacarejo, muda o tratamento de PIS/COFINS das bebidas (PM02). Os limites de valor da NFC-e variam por UF (a confirmar).
- **Dados:** C100 modelo 65: `VL_DOC`, `COD_PART`; C800: `CNPJ_CPF`, `VL_CFE`. **Temos** o total por documento. **Falta:** o XML de NFC-e para ver os itens e o destinatário.
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

#### RK10 · Transferência interestadual: valor da operação
- **Confere:** nas transferências entre estados, o valor unitário do item contra o da entrada mais recente no estabelecimento remetente.
- **Por que importa:** a base na transferência interestadual é o valor da entrada mais recente (LC 87/1996, art. 13, § 4º, I). Depois da ADC 49 a regra mudou de papel (ver IC10), mas o estado de destino ainda glosa crédito transferido a maior.
- **Dados:** C170: `COD_ITEM`, `QTD`, `VL_ITEM`, `CFOP`, `VL_BC_ICMS`. **Temos.**
- **Dificuldade:** média · **Tributarista:** sim · **Resultado:** risco

#### RK11 · IRPJ e CSLL: o que os arquivos não deixam conferir
- **Confere:** estimativas mensais, adições e exclusões, prejuízo fiscal e a receita da ECF contra as EFD (parâmetros 10.001 e 10.003 da Malha Fiscal Digital).
- **Por que importa:** na rodada de 2026 a Receita avisou mais de 29 mil empresas por insuficiência de IRPJ/CSLL. Está no catálogo para deixar claro o que ainda não cobrimos.
- **Dados:** **Falta:** a ECF (e a DCTF e os PER/DCOMP). Com a ECD dá para ter só os indicadores da CT15 e da IG08.
- **Dificuldade:** média, depois de ter a ECF · **Tributarista:** sim · **Resultado:** risco

#### RK12 · Índice de conformidade por estabelecimento
- **Confere:** nota de cada loja, a partir dos achados de erro e de risco por milhão de reais faturado, com peso pela gravidade; evolução mês a mês.
- **Por que importa:** dá ao dono um ranking das lojas e mostra se o trabalho de correção está funcionando. Vários estados classificam o contribuinte por conformidade (São Paulo, "Nos Conformes", LC estadual 1.320/2018).
- **Dados:** a tabela `achados`; vendas por estabelecimento. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** não · **Resultado:** indicador

### Malhas publicadas e a regra do catálogo que as antecipa

| Malha ou programa | O que cruza | Regra |
|---|---|---|
| Receita, Malha Fiscal Digital 20.001 | M205/M605 × DCTF | RK01 (EC08 confere o lado da EFD) |
| Receita, Malha Fiscal Digital 10.001 | receita da ECF × NF-e × EFD | CZ15, CT08, RK11 |
| Receita, Malha Fiscal Digital 30.001 | saldo de IPI × DCTF | IP01, IP02 |
| Goiás 12; Pernambuco i03 | NF-e e NFC-e de saída fora da EFD | CZ01 |
| Pernambuco i04; Goiás 16 | NF-e recebida fora da EFD; nota escriturada que não existe | CZ02, CZ03, RK04 |
| Goiás 14 e 138 | ICMS e ICMS-ST da saída registrados a menor | CZ04, ST08 |
| Goiás 13; Paraná; Rio Grande do Sul | crédito maior que o destacado | IC02 |
| Goiás 10 e 116; Rio Grande do Sul | nota de entrada creditada mais de uma vez | EI10 |
| Goiás 15 | nota escriturada por estabelecimento que não é o destinatário | CZ10 |
| Goiás 101 e 105 | nota cancelada com crédito; autorizada escriturada como cancelada | RK03 |
| Goiás 137 | crédito de emitente com inscrição nula | CD10 |
| Goiás 134 | saldo credor transportado a maior | EI06 |
| Goiás 38 e 47 | crédito de energia e de comunicação no comércio | IC03 |
| Goiás 110, 136 e 132 | DIFAL de uso, consumo e ativo; DIFAL ao consumidor | IC07, IC08 |
| Goiás 118 | alíquota interna desatualizada | IC05 |
| Goiás 114; Pernambuco i05; Rio Grande do Sul | cartões e PIX × documentos emitidos | RK02 |
| Paraná | ajuste de crédito de CIAP | CP06, IC12 |
| Rio Grande do Sul; São Paulo | supermercados: venda sem destaque; produtos excluídos da ST | IC06, ST03 |
| Mato Grosso; Bahia (Portaria 445/1998); Lei 9.430, art. 41 | levantamento quantitativo de estoque | ES04, ES06 |
| Lei 9.430, art. 40; RIR/2018, art. 293 | passivo fictício; saldo credor de caixa | CT04, CT05, CT06 |

Não achamos malha publicada para: manifestação do destinatário, crédito de nota denegada, E110 × guias de informação
(GIA, DAPI), CFOP × CST e NCM × CEST. Isso não quer dizer que os fiscos não cruzem; só que não há critério público.

---

## 14. Indicadores gerenciais para o dono (IG)

Não são achados: são leituras do negócio que os mesmos arquivos permitem. Nenhuma depende de tributarista.

#### IG01 · Carga tributária efetiva
- **Confere:** ICMS, ICMS-ST, PIS, COFINS e IPI pagos sobre a receita, por mês, loja, categoria e produto.
- **Por que importa:** mostra quanto do preço é imposto e onde a carga foge da média da rede.
- **Dados:** E110, E210, E310; M200, M600; analíticos de saída; ECD (IRPJ e CSLL, referencial 3.02). **Temos.**
- **Dificuldade:** baixa · **Resultado:** indicador

#### IG02 · Faturamento por regime tributário
- **Confere:** participação, na venda, de produtos tributados, monofásicos, de alíquota zero, com ST e isentos, por loja e por mês.
- **Por que importa:** explica a carga (IG01) e mede o tamanho de cada oportunidade antes de auditar item a item.
- **Dados:** itens de saída por `CST_PIS` e `CST_ICMS`; `bloco_c_resumo`. **Temos.**
- **Dificuldade:** baixa · **Resultado:** indicador

#### IG03 · Margem bruta por item, categoria e loja
- **Confere:** preço médio de venda menos custo médio de entrada (líquido de créditos), com a evolução no tempo.
- **Por que importa:** é o número que o dono mais usa; aqui vem dos documentos fiscais, sem depender do sistema de gestão.
- **Dados:** entradas e saídas por `COD_ITEM` (`QTD`, `VL_ITEM`, impostos); 0200. **Temos** (com a ressalva da venda por item da ES04).
- **Dificuldade:** média · **Resultado:** indicador

#### IG04 · Preço de compra: o mesmo produto, fornecedores e lojas diferentes
- **Confere:** por produto (código de barras), o preço unitário pago por loja, por fornecedor e por mês; variação entre a compra mais cara e a mais barata.
- **Por que importa:** dinheiro direto na negociação de compras: o mesmo item comprado mais caro numa loja.
- **Dados:** XML: `prod_cean`, `prod_xprod`, `prod_qcom`, `prod_vuncom`, `prod_vprod`, `emit_cnpj`, `dest_cnpj`, `emissao_data`. **Temos.**
- **Dificuldade:** baixa · **Resultado:** indicador

#### IG05 · Fornecedores: volume, concentração e origem
- **Confere:** ranking de fornecedores por valor, dependência dos 10 maiores, compras dentro e fora do estado e o imposto embutido em cada origem.
- **Por que importa:** risco de dependência e custo tributário da origem (ST, alíquota interestadual, DIFAL).
- **Dados:** C100 de entrada: `COD_PART`, `VL_DOC`, `VL_ICMS`, `VL_ICMS_ST`; 0150; XML. **Temos.**
- **Dificuldade:** baixa · **Resultado:** indicador

#### IG06 · Curva ABC e sazonalidade de produtos
- **Confere:** itens que fazem 80% da venda, por loja; itens em queda e em alta; sazonalidade por categoria.
- **Por que importa:** mix e compra. Os arquivos fiscais têm anos de histórico por item.
- **Dados:** `bloco_c_resumo_itens` (C170 somados por item); 0200. **Temos.**
- **Dificuldade:** baixa · **Resultado:** indicador

#### IG07 · Vendas por loja: documentos, valor médio e horário
- **Confere:** número de documentos de venda, valor médio por documento, vendas por dia da semana e por hora, por loja.
- **Por que importa:** produtividade de loja e de escala de pessoal.
- **Dados:** C100 modelo 65: `DT_DOC`, `VL_DOC`; C405, C800; XML: `emissao_hora` (só NF-e). **Temos** por dia. **Falta:** a hora dos cupons (XML de NFC-e).
- **Dificuldade:** baixa · **Resultado:** indicador

#### IG08 · Resultado por loja e despesas sobre a receita
- **Confere:** DRE por centro de custo, se a contabilidade usa a loja como centro (`COD_CCUS`); despesas de energia, aluguel, frete e pessoal sobre a receita de cada loja; alíquota efetiva de IRPJ e CSLL sobre o lucro.
- **Por que importa:** compara lojas com a mesma régua.
- **Dados:** ECD I100: `COD_CCUS`, `CCUS`; I155 e I355 por centro; C500 (energia por estabelecimento). **Temos**, se a ECD tiver centro de custo por loja (**a verificar**).
- **Dificuldade:** média · **Resultado:** indicador

#### IG09 · Caixa tributário parado
- **Confere:** soma dos saldos de créditos: ICMS por loja (E110), PIS/COFINS (M100, M500, 1100, 1500), CIAP a apropriar (G125), retenções (1300, 1700); evolução.
- **Por que importa:** é dinheiro da empresa na mão do fisco. Junto com a IC09 e a CR11, vira plano de uso.
- **Dados:** os dos registros citados. **Temos.**
- **Dificuldade:** baixa · **Resultado:** indicador

#### IG10 · Calendário e previsão de tributos
- **Confere:** o que venceu e quanto, por tributo, loja e mês (E116, E250, E316, M205, M605), e a projeção dos próximos meses pela sazonalidade.
- **Por que importa:** fluxo de caixa.
- **Dados:** E116, E250, E316: `VL_OR`, `DT_VCTO`, `COD_REC`; M205, M605. **Temos.**
- **Dificuldade:** baixa · **Resultado:** indicador

#### IG11 · Perdas e baixas de estoque
- **Confere:** valor das baixas (CFOP 5927), das diferenças do levantamento (ES04) e dos ajustes de inventário, por loja e categoria, sobre a venda.
- **Por que importa:** perda é margem. Supermercado mede isso por setor; aqui sai do fiscal.
- **Dados:** C170/C190: `CFOP`, `VL_OPR`; H010. **Temos.**
- **Dificuldade:** média · **Resultado:** indicador

#### IG12 · Cobertura dos dados
- **Confere:** por loja e mês, o que existe de cada fonte (EFD Contribuições, EFD ICMS/IPI, ECD, XML) e o percentual de notas de cada fonte que tem par nas outras.
- **Por que importa:** diz o quanto se pode confiar em cada cruzamento, e o que pedir ao cliente. Estende a tabela `cobertura` que já existe.
- **Dados:** 0000 de cada arquivo; C100; XML. **Temos.**
- **Dificuldade:** baixa · **Resultado:** indicador

#### IG13 · Valor recuperável e risco, em reais
- **Confere:** soma, por tema e por regra, do valor estimado de cada oportunidade e de cada risco, com o que já foi validado pelo tributarista, o que foi pedido e o que entrou no caixa.
- **Por que importa:** é a tela que mostra o retorno do trabalho. Sem ela, o catálogo é uma lista de erros.
- **Dados:** a tabela `achados` com uma coluna de valor estimado e um estado por regra. **Temos** a base. **Falta:** registrar o andamento de cada achado.
- **Dificuldade:** média · **Resultado:** indicador

---

## 15. Reforma tributária: transição (RT)

Em 2026 a CBS e o IBS são destacados com alíquotas de teste (0,9% e 0,1%) e o recolhimento é dispensado para quem
cumpre as obrigações acessórias (LC 214/2025, arts. 343 a 348). PIS e COFINS continuam devidos em 2026.

#### RT01 · Notas de 2026 sem o grupo de IBS e CBS
- **Confere:** NF-e e NFC-e emitidas pela empresa sem os campos de IBS/CBS por item, ou com alíquotas diferentes das de teste.
- **Por que importa:** cumprir a obrigação acessória é a condição da dispensa de recolhimento em 2026. O cronograma de obrigatoriedade mudou durante 2026 (Nota Técnica 2025.002 e atos conjuntos; datas a confirmar).
- **Dados:** **Falta:** o leitor de XML ainda não guarda os campos de IBS/CBS (CST, `cClassTrib`, base, alíquotas, valores).
- **Dificuldade:** média · **Tributarista:** não · **Resultado:** risco

#### RT02 · Classificação tributária do IBS/CBS × NCM
- **Confere:** o `cClassTrib` de cada item contra o NCM e contra o tratamento atual de PIS/COFINS (alíquota zero, monofásico).
- **Por que importa:** as listas mudam: a cesta básica do IBS/CBS (LC 214/2025, art. 125 e Anexo I) não coincide com a alíquota zero de PIS/COFINS, que acaba em 2027. Cadastro errado agora vira imposto errado em 2027.
- **Dados:** 0200: `COD_NCM`; itens por CST. **Falta:** os campos novos do XML e a tabela de `cClassTrib`.
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** risco

#### RT03 · Créditos de PIS/COFINS antes da virada
- **Confere:** saldos e créditos não escriturados de PIS/COFINS (CR01 a CR11) com data de corte no fim do regime atual.
- **Por que importa:** o que não for apurado no regime atual segue regras de transição (LC 214/2025; **não pesquisado**: o tributarista deve confirmar prazos e forma de uso dos saldos).
- **Dados:** os das CR. **Temos.**
- **Dificuldade:** baixa · **Tributarista:** sim · **Resultado:** indicador

#### RT04 · Simulação da carga com IBS e CBS
- **Confere:** aplica as regras novas ao histórico de compras e vendas por item: débito, crédito (inclusive de fornecedores do Simples, com crédito limitado) e carga por categoria e loja.
- **Por que importa:** preço, margem e escolha de fornecedor mudam com a reforma; o histórico por item que já temos é a base da simulação.
- **Dados:** entradas e saídas por item; 0150; XML. **Temos.** **Falta:** alíquotas de referência e tabela de classificação.
- **Dificuldade:** alta · **Tributarista:** sim · **Resultado:** indicador

---

## 16. Teses avaliadas e que não entram como oportunidade

Para o dono saber que foram olhadas. Onde a decisão foi contra o contribuinte, a tese virou regra de **risco** (CR12).

| Tese | Situação | No catálogo |
|---|---|---|
| Crédito de PIS/COFINS sobre o ICMS da compra, a partir de 05/2023 | vedado pela Lei 14.592/2023; STJ, Tema 1364, contra o contribuinte (14/10/2026, segundo fonte secundária) | risco, CR12 |
| Crédito de PIS/COFINS sobre o ICMS-ST pago na compra | STJ, Tema 1231, contra (20/06/2024) | risco, CR12 |
| Crédito de PIS/COFINS na compra de monofásico para revenda | STJ, Tema 1093, contra (26/04/2022); combustíveis, Tema 1339 | risco, CR12 |
| Taxa de cartão fora da base de PIS/COFINS, ou como crédito | STF, Tema 1024, contra (RE 1.049.811) | não entra |
| Vale-transporte, refeição e uniforme como crédito no varejo | só para limpeza, conservação e manutenção (Lei 10.833, art. 3º, X); Receita nega ao varejo (SC Cosit 110/2023) | não entra |
| Insumos no comércio (embalagens, sacolas, material de loja) | Receita: não há insumo na atividade comercial (SC Cosit 110/2023 e 248/2019) | só na produção própria, CR07 |
| Frete entre estabelecimentos (centro de distribuição para lojas) | Súmula CARF 217 nega para produtos acabados; a aplicação à revenda é por analogia | risco, CR12 |
| Crédito de ICMS da energia elétrica no comércio | só a partir de 2033 (LC 87/1996, art. 33, II); STJ, Tema 242, nega a supermercado | risco, IC03 |
| PIS/COFINS na própria base | STF, Tema 1067, **pendente** | acompanhar |
| Bonificações e descontos de fornecedor fora da base | STJ, Tema 1412, **pendente**; Receita tributa (SC Cosit 202/2021) | indicador, PM13 |
| ISS e crédito presumido de ICMS fora da base | STF, Temas 118 e 843, a favor em 10/2026, **modulação pendente** (segundo as fontes consultadas) | PM14, aguardar |

---

## 17. O que falta de dado

O que mais destrava regras, em ordem:

1. **Extrair mais registros dos arquivos que já temos.** A extração da Auditoria guarda só C010, C100 e C170 da EFD
   Contribuições. As regras de venda ao consumidor precisam de C175, C181/C185, C381/C385, C481/C485 e C870; as da EFD
   ICMS/IPI precisam do C170 arquivo a arquivo (hoje só o resumo por item está publicado). Os blocos M, E, G, H, 1 e a
   ECD já estão publicados inteiros.
2. **Tabelas públicas** (sem custo): Tabelas 4.3.10 a 4.3.17 da EFD Contribuições (NCM monofásico, substituição,
   alíquota zero, isenção, suspensão), CFOP geradores de crédito, NCM e CFOP com vigência, CEST (Convênio ICMS
   142/2018), TIPI, Tabela 5.1.1 de ajustes de cada UF, base de CNPJ da Receita (situação cadastral e Simples).
3. **Campos do XML que o leitor não guarda:** total da nota (`vNF`), frete, seguro e outras despesas, UF e CRT do
   emitente, série, protocolo de autorização, nota referenciada (`refNFe`), FCP, DIFAL, crédito do Simples
   (`pCredSN`, `vCredICMSSN`), código de benefício (`cBenef`) e o grupo de IBS/CBS.
4. **Situação e eventos das notas** (cancelamento, manifestação): consulta à SEFAZ ou XML de eventos.
5. **XML de NFC-e**, se os cupons não estiverem por item na EFD Contribuições (**a verificar**).
6. **Outros arquivos do cliente:** ECF, DCTF e PER/DCOMP, XML de CT-e, extratos de cartões, controle patrimonial.
7. **Legislação estadual** de cada UF onde há loja: alíquotas internas, produtos em ST e margens, benefícios.
8. **Mapeamento contábil por cliente:** quais contas são de aluguel, energia, frete, estoque, tributos.

Pontos marcados "a verificar" pedem só uma olhada nos arquivos, sem carga pesada: se a venda por cupom vem por item
(C170) ou resumida (C175, C381, C481); se há bloco K; se há posto de combustível; se a ECD usa centro de custo por loja.

---

## 18. As 15 de maior valor para o dono

Critério: potencial em dinheiro × facilidade de fazer com o que já temos. O valor em reais só sai depois de rodar;
a ordem é a expectativa para uma rede de supermercados no lucro real.

| # | Auditoria | Por que está aqui | Dificuldade |
|---|---|---|---|
| 1 | **PM01** Monofásico tributado na venda ao consumidor | 9,25% sobre a venda de higiene, perfumaria, farmácia e autopeças, por 5 anos; a O01 já mostrou o padrão nos XML, e o volume está nos cupons | baixa |
| 2 | **PM03** Alíquota zero tributada | em supermercado, carnes, café, açúcar, óleo e higiene básica são grande parte da venda; termina em 2027 | média |
| 3 | **PM04** Mesmo produto com tratamentos diferentes | acha o erro de parametrização sem tabela externa; sai em dias | baixa |
| 4 | **CR02** Energia elétrica sem crédito | despesa alta em toda loja, crédito com inciso próprio, dados dos dois lados já lidos | baixa |
| 5 | **PM05** ICMS na base do PIS/COFINS | tese pacificada; falta medir o que a empresa ainda não excluiu | média |
| 6 | **CT12 + CR03** Despesas com crédito × créditos tomados (aluguéis) | um mapa só mostra aluguel, frete, armazenagem e benfeitorias sem crédito | média |
| 7 | **CR11** Saldo de créditos parado e ressarcível | o dinheiro já está apurado: falta pedir. Lê só blocos M e 1 | baixa |
| 8 | **IC09** Saldo credor de ICMS parado entre lojas | caixa imediato numa rede: crédito de uma loja paga o imposto de outra. Lê só o E110 | baixa |
| 9 | **ST02** Produto com ST tributado de novo na saída | ICMS pago em dobro, por item; típico de cadastro de supermercado | média |
| 10 | **CP01 + CP02** Ativo com ICMS fora do CIAP | refrigeração, gôndolas e equipamentos de ~120 lojas; 48 parcelas | média |
| 11 | **IC01** Crédito de ICMS destacado e não aproveitado | XML × EFD por item; 5 anos | média |
| 12 | **PM06** ICMS-ST na base do PIS/COFINS | valor alto em supermercado (Tema 1125), cálculo trabalhoso | alta |
| 13 | **CR01** Compra para revenda sem crédito | 9,25% sobre compras que o sistema deixou sem crédito | média |
| 14 | **CZ11** Transferências: saída de uma loja × entrada da outra | débito sem crédito correspondente em milhares de notas internas | média |
| 15 | **CZ01 + CZ02** Notas fora da EFD ICMS/IPI | não recupera dinheiro: evita a autuação mais comum das SEFAZ, e é barata | baixa |

Logo depois: **CR17** (inclusão de insumos: a O02 já detecta; falta gerar o arquivo corrigido), **ST01** (ressarcimento de ST na venda abaixo da base presumida, valor alto e rito difícil), **CP03**
(coeficiente do CIAP), **ES04** (levantamento de estoque, o maior risco), **EC09** e **EI06** (saldos que somem).

---

## 19. Ordem de implementação proposta

**Onda 0, preparar (sem regra nova).** Ampliar a extração (item 1 da seção 17), carregar as tabelas públicas do SPED,
acrescentar à tabela `achados` um valor estimado por achado e um tema, e resolver os quatro "a verificar".

**Onda 1, o que lê tabelas já publicadas (blocos M, 1, E, G).** EC07, EC08, EC09, EC12, EC20, CR11, CR14, EI05, EI06,
EI07, IC09, IC12, CP02, CP04, CP06, IG09, IG10. São regras leves, sem item a item, e já entregam dois itens do
ranking (7 e 8).

**Onda 2, pago a maior por item na EFD Contribuições.** EC01, EC02, EC03, PM04, PM01, PM03, PM08, PM09, PM11, CR12,
CD04, IG02, CR17. Usa o laço arquivo a arquivo que já existe; depende das tabelas 4.3.x. Entrega os itens 1, 2 e 3.

**Onda 3, créditos com a contabilidade.** CT12, CR02, CR03, CR04, CR06, CR08, CR09, CZ12, CZ13, CT09. Pede o
mapeamento das contas do cliente. Entrega os itens 4 e 6.

**Onda 4, ICMS por item e cruzamentos com XML.** CZ01, CZ02, CZ03, CZ04, CZ10, CZ11, IC01, IC02, IC03, ST02, ST03,
ST06, CP01, EI01 a EI04. Precisa do C170 da EFD ICMS/IPI arquivo a arquivo. Entrega os itens 9, 10, 11, 14 e 15.

**Onda 5, as teses de base de cálculo.** PM05, PM06, PM07, CR01, CR10. Só depois de o tributarista dizer o que a
empresa já fez (ações judiciais, exclusões em curso). Entrega os itens 5, 12 e 13.

**Onda 6, estoque, cadastro e contábil.** ES01 a ES11, CD01 a CD10, CT01 a CT19, ST01, ST09, CP03.

**Onda 7, indicadores e reforma.** IG01 a IG13, RK05, RK06, RK12, RT01 a RT04.

Em todas as ondas vale o método da Auditoria atual: `--contar` antes de publicar, conferir uma amostra de cada regra
no arquivo original, e desconfiar de regra com dezenas de milhares de achados.

---

## 20. Fontes

Pesquisa feita em 13/11/2026. As decisões de tribunais e as soluções de consulta foram conferidas, na maior parte, em
portais reconhecidos e não no texto oficial: **antes de usar numa peça ou num parecer, conferir o acórdão ou a norma**.
Julgamentos de 2026 (Temas 118, 843, 1364 e 1372) vêm de notícia; modulação e tese literal a confirmar.

Lidas no texto oficial:

- Lei 10.833/2003 (art. 3º e § 2º, III): https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm
- LC 87/1996 (arts. 12, 20, 21, 33): https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm
- Lei 9.430/1996 (arts. 40 a 42 e 44): https://www.planalto.gov.br/ccivil_03/leis/l9430.htm
- Lei 8.218/1991 (art. 12): https://www.planalto.gov.br/ccivil_03/leis/l8218.htm
- MP 2.158-35/2001 (art. 57): https://www.planalto.gov.br/ccivil_03/mpv/2158-35.htm
- STF, Tema 118 (notícia oficial): https://noticias.stf.jus.br/postsnoticias/stf-decide-que-iss-nao-integra-base-de-calculo-do-pis-e-da-cofins/
- Parecer SEI 7698/2021/ME (PGFN): https://www.gov.br/pgfn/pt-br/assuntos/representacao-judicial/documentos-portaria-502/parecer-sei-no-7698-pgfn-me.pdf/@@download/file/Parecer%20SEI%20n%C2%BA%207698.PGFN-ME.pdf
- Receita, Malha Fiscal Digital, lista de operações: https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/revisao-de-declaracao-malha/operacoes
- Receita, parâmetro 20.001 (EFD Contribuições × DCTF): https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/revisao-de-declaracao-malha/pj-parametro-20.001
- Receita, parâmetro 10.003: https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/revisao-de-declaracao-malha/pj-parametro-10.003
- Receita, operação 10.001: https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/revisao-de-declaracao-malha/operacao-10-001-ecf-zerada
- Goiás, notas técnicas das malhas (12, 13, 14, 101, 105, 114, 118, 132, 134, 137, 138 e outras): https://goias.gov.br/economia/notas-tecnicas/
- Pernambuco, indicadores de conformidade: https://www.sefaz.pe.gov.br/Servicos/Paginas/Divergencias_conformidade.aspx
- Paraná, malhas na EFD: https://www.fazenda.pr.gov.br/Noticia/Receita-Estadual-implanta-novas-malhas-fiscais-na-EFD-partir-de-maio-de-2026
- Rio Grande do Sul, autorregularização: https://estado.rs.gov.br/contribuintes-tem-prazo-para-regularizar-pendencias-de-escrituracao-indevida-de-creditos e https://estado.rs.gov.br/programa-de-autorregularizacao-busca-recuperar-r-41-3-milhoes-em-icms-devido-ao-estado
- RICMS-SP, art. 527: https://legislacao.fazenda.sp.gov.br/Paginas/art527.aspx
- Convênio ICMS 86/2022 (DIMP): https://www.confaz.fazenda.gov.br/legislacao/convenios/2022/CV086_22
- Bahia, Portaria SEFAZ 445/1998: https://www.legisweb.com.br/legislacao/?id=120510

Fontes secundárias:

- Tema 69 e modulação: https://www.ibet.com.br/plenario-decide-excluir-icms-da-base-de-calculo-do-pis-cofins-a-partir-de-2017/
- Tema 1125 e modulação: https://www.migalhas.com.br/depeso/410845/stj-julga-os-temas-1-125-e-1-231-e-surpreende-com-modulacao-da-decisao e https://www.machadomeyer.com.br/pt/boletim/stj-icms-st-deve-ser-excluido-da-base-de-calculo-do-pis-e-da-cofins
- Tema 1231: https://www.contabeis.com.br/noticias/69547/stj-nega-creditamento-de-pis-cofins-sobre-reembolso-de-icms-st/
- Tema 1364: https://apet.org.br/?p=143653
- Tema 1372: https://apet.org.br/?p=142214
- Tema 1093: https://juris.damasio.com.br/temas/stj/1093
- Tema 1412 (bonificações): https://apet.org.br/?p=142215 e https://netcpa.com.br/colunas/receita-exige-pis-e-cofins-sobre-bonificacoes/12823
- Tema 843: https://www.migalhas.com.br/quentes/466072/stf-exclui-credito-presumido-de-icms-da-base-do-piscofins
- Tema 1067: https://juris.damasio.com.br/temas/stf/1067
- Tema 1024: https://netcpa.com.br/colunas/stf-fixa-tese-sobre-incidencia-de-piscofins-sobre-taxas-de-administracao-de-cartao-de-credito/13450
- Tema 201 (ressarcimento de ST): https://guiatributario.net/2016/10/20/stf-contribuinte-tem-direito-a-diferenca-do-icms-st/
- Tema 242 (energia em supermercado): https://juris.damasio.com.br/temas/stj/242
- Insumos e varejo, SC Cosit 110/2023: https://okai.com.br/documento/2023-06-12/solucao-de-consulta-cosit-nº-110-de-12-de-junho-de-2023
- Parecer Normativo Cosit 5/2018: https://www.normaslegais.com.br/legislacao/parecer-normativo-cosit-5-2018.htm
- Súmula CARF 217: https://www.conjur.com.br/2025-abr-11/pis-cofins-e-agronegocio-frete-e-a-sumula-carf-217/
- Crédito extemporâneo, SC Cosit 355/2017: https://okai.com.br/documento/2017-07-13/solucao-de-consulta-cosit-nº-355-de-13-de-julho-de-2017 e https://www.migalhas.com.br/depeso/441357/creditos-extemporaneos-de-pis-cofins-efd-contribuicoes
- Alíquota zero, Lei 10.925/2004: https://www.legjur.com/legislacao/art/lei_00109252004-1
- Bebidas frias e monofásicos: https://www.jettax.com.br/blog/tributacao-monofasica/
- Convênio ICMS 109/2024 (transferências): https://www.machadomeyer.com.br/pt/boletim/legislacao-estadual-transferencia-de-creditos-de-icms-entre-estabelecimentos-do-mesmo-titular-deixa-de-ser-obrigatoria
- Subvenções e Tema 1182: https://www.migalhas.com.br/depeso/440179/subvencoes-de-icms-guerra-infinita-entre-fisco-e-contencioso-judicial
- Reforma, LC 214/2025, art. 348: https://www.legjur.com/legislacao/art/lec_00002142025-348 ; NF-e com IBS/CBS: https://www.contabeis.com.br/artigos/76943/nf-e-novas-regras-e-cronogramas-para-ibs-e-cbs-em-2026-2027/
- Rodadas de autorregularização da Receita: https://fenacon.org.br/noticias/receita-federal-oferece-oportunidade-de-regularizacao-de-divergencias-de-pis-e-cofins/ e https://online.crcsp.org.br/portal/noticias/noticia.asp?c=11044
- Levantamento de estoque em Mato Grosso: https://www.coad.com.br/home/noticias-detalhe/108428/sefaz-mt-notifica-209-industrias-mato-grossenses-por-irregularidades-na-escrituracao-fiscal

Não foi possível abrir na pesquisa: o portal do SPED (Guias Práticos da EFD ICMS/IPI e da EFD Contribuições). As
somas e regras de validação citadas nos temas 1 e 2 seguem os campos dos layouts do repositório e devem ser conferidas
contra o Guia Prático de cada escrituração antes de virar regra.
