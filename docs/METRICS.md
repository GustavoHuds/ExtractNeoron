# Métricas — definições exatas

> Regra da casa: **nenhum número sem definição**. Cada métrica abaixo diz o que
> conta, o que NÃO conta e de onde o dado vem. Foi assim que corrigimos a v1,
> em que o Neoron mostrava ~500 conversas e o painel ~100: a v1 só extraía a
> tag "negociando"; a v2 indexa a base inteira (todas as tags, todos os
> canais, inclusive os docs antigos sem metadata).

## Conceitos

- **Conversa** — um documento em `conversations_metadata` com ao menos 1
  mensagem. Inclui WhatsApp, Instagram DM, chat Web e docs legados sem canal.
- **Lead** — conversa em que o **cliente falou** ao menos uma vez
  (`userMsgs > 0`). Conversa só com bot não é lead.
- **Resposta humana** — mensagem com `sender: 'agent'`. Bot não conta nunca.

## Painel (barra de stats)

| Métrica | Definição |
|---|---|
| Abertos | leads com situação `Aberto` (sem tag de venda/desqualificação) e não finalizados no painel |
| Quentes | abertos com temperatura `quente` (ver algoritmo abaixo) |
| Aguardando resposta | a última mensagem é do cliente e nenhum humano respondeu ainda |
| Para ligar +24 h | aguardando há ≥ `CALL_QUEUE_HOURS` (padrão 24 h) **e** ≤ `CALL_QUEUE_MAX_DAYS` (padrão 14 dias) — é a fila de ligações. Quem espera há mais que isso é lead perdido: continua no pipeline (frio), mas não polui a fila |
| Não atendeu | leads com ≥ 2 tentativas de ligação registradas sem sucesso |
| Vendidos no mês | ver "Vendas" abaixo, no mês corrente |

## Métricas mensais (aba Métricas)

| Métrica | Conta | Não conta | Fonte |
|---|---|---|---|
| **Leads novos** | conversas cuja **primeira mensagem do cliente** cai no mês | chats só de bot; conversas antigas que apenas continuaram no mês | `convindex.firstUserTs` |
| **Conversas ativas** | conversas com ≥ 1 mensagem no mês | — | `convindex.monthsActive` |
| **Vendas** | união de: (a) leads finalizados como **Vendido** no painel, pela **data da finalização**; (b) leads com a tag **"venda realizada"** no Neoron, pela data da última atividade. Deduplicado por conversa | promessas ("vou querer") sem finalização/tag | `done.json` + tags |
| **Conversão** | vendas ÷ leads novos do mesmo mês | — | derivada |
| **1ª resposta mediana** | mediana do tempo entre a 1ª mensagem não-respondida do cliente e a 1ª resposta **humana**, sobre conversas iniciadas no mês | respostas do bot; gaps > 7 dias (outliers de reabertura) | `convindex.firstResponseMs` |
| **Ticket médio (estimado)** | média do preço de catálogo do produto detectado nos leads vendidos com preço | vendas sem produto identificado | catálogo TF-IDF |
| **Vendas por atendente** | atendente = nome mais frequente nos prefixos `Nome:` das mensagens de agente daquela conversa | — | mensagens |
| **Tendência 8 semanas** | 1ª resposta mediana por semana (segunda a domingo) da conversa iniciada naquela semana | — | `convindex` |

**Por que "estimado" no ticket:** o Neoron não guarda valor de pedido. Usamos o
preço de tabela do SKU casado por TF-IDF na conversa. É um proxy — bom para
comparar meses e atendentes, não para fechar contabilidade.

**Limitação conhecida (vendas por tag):** o Firestore não guarda *quando* a tag
"venda realizada" foi aplicada; usamos a última atividade da conversa como
aproximação. Vendas finalizadas pelo painel têm data exata. Recomendação ao
time: **finalizar no painel** — vira a fonte precisa.

## Temperatura (quente / morno / frio)

Score por sinais nas mensagens **do cliente** (as 4 últimas pesam 1,5×):

| Sinal | Peso |
|---|---|
| fechamento ("pode gerar o link", CPF, comprovante/PIX) | +4 |
| interesse ativo (preço, parcelas, entrega, "gostei") | +2 |
| pedido de info (fotos, medidas, cores) | +1 |
| adiamento ("vou pensar", "depois retorno") | −1 |
| crédito reprovado | −3 |
| objeção de preço / rejeição ("muito caro", "não quero") | −4 |

- **quente**: score ≥ 4 com 2+ categorias positivas distintas, ou qualquer
  sinal de fechamento.
- **frio**: negativa forte recente sem positiva recente, score ≤ −3, tag
  "desqualificado", ou 72 h+ parado sem intenção forte (decay).
- **morno**: o resto.

Cada lead mostra os **motivos** ("perguntou preço", "achou caro") — a
temperatura é sempre explicável, nunca uma caixa-preta.

## Nota IA (0-10, opcional)

Com `ANTHROPIC_API_KEY`, o Claude avalia o **vendedor** (presença, clareza,
proatividade, cordialidade — nunca a decisão do cliente). Cache por conversa:
só re-avalia quando o chat muda. Sem a chave, o painel funciona sem a coluna.

## Auditoria de números

Para conferir contra o Neoron: `npm run discover` imprime o total de conversas
por canal/status/tag direto do Firestore — o mesmo dado bruto que a extração
usa. Se o painel divergir do Neoron, esse script mostra onde.
