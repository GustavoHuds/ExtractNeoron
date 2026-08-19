# API HTTP

Todas as rotas `/api/*` exigem `Authorization: Bearer <idToken>` (token
Firebase da conta Neoron do usuário, verificado por assinatura no servidor).
Respostas da API saem com `Cache-Control: no-store`. Rate limit: 600 req /
15 min / IP. Ações que mudam estado entram na trilha `data/audit.jsonl`.

## Público (sem auth)

| Rota | Descrição |
|---|---|
| `GET /health` | liveness `{ok:true}` |
| `GET /config.js` | chave web pública do Firebase para o browser |

## Dados

### `GET /api/data`
Última extração **com estado ao vivo**: finalizações, tentativas de ligação e
remoções da fila refletem na hora (sem re-extração), e os campos que dependem
do relógio (tempo de espera, fila +24 h, decay de temperatura) são recalculados
a cada chamada. Shape: `{ generatedAt, account, conversationsScanned,
chatsFetched, count, leads, situacao{}, temperatura{}, canais{}, etapas{},
aguardando, aguardando24h, naoAtendeu, feitos, vendidosMes, rows[] }`.

### `POST /api/extract`
Roda a extração incremental com o token do chamador. Body opcional
`{"force": true}` re-busca tudo. 429 se já houver uma em andamento.

### `GET /api/metrics?mes=YYYY-MM`
Métricas mensais (padrão: mês corrente): `{ mes, mesAnterior, kpis{}, canais{},
funil[], finalizados, porAtendente[], tendenciaResposta[], mesesDisponiveis[] }`.
Definições em [METRICS.md](METRICS.md).

### `GET /api/messages/:botId/:convId`
Transcrição ao vivo (nunca cacheada): `{ messages: [{sender, ts, text, author}] }`.

## Ações

### `POST /api/done`
`{ id, done: true|false, reason?: 'vendido'|'sem_retorno'|'sem_interesse'|'concorrente'|'outro', note? }`
Finaliza/reabre. `by` sai do token verificado, nunca do cliente. Ao finalizar,
um snapshot do lead é salvo (aba Finalizados sobrevive ao lead sair do Neoron).

### `POST /api/noanswer`
`{ id, reset?: boolean, note? }` — registra tentativa "não atendeu" (2+ move o
lead para o balde Não atendeu) ou zera (volta à fila).

### `POST /api/fila/dismiss`
`{ id, restore?: boolean }` — remove o lead da fila de ligações (✕) ou o
restaura. A remoção vale para o episódio de espera atual: se o cliente mandar
uma mensagem nova sem resposta, o lead volta à fila automaticamente.

### `GET|POST /api/justificativas`
Presets de justificativa do time. POST `{ text, remove?: boolean }`.

## Catálogo

### `GET /api/catalog` → `{ loaded, count, source }`
### `POST /api/catalog`
CSV ou JSON cru (`text/csv`, `text/plain` ou JSON). Colunas: `codigo, nome,
preco, categoria`. Substitui o catálogo ativo.

## Export

### `POST /api/download` (CSV) · `POST /api/download.xlsx` (Excel)
Body `{ ids?: string[] }` — quando presente, exporta só essas conversas na
ordem dada (o front manda o filtro atual). Células neutralizadas contra
fórmula-injection.
