# Arquitetura — ExtractNeoron v2

## Visão geral

```
Browser (public/)                    Servidor (src/)                      Google Cloud
┌──────────────────┐    Bearer      ┌──────────────────────┐   REST     ┌──────────────┐
│ login (auth.js)  │───idToken────▶│ server.js (Express)  │──────────▶│ Firebase Auth │
│ pipeline (app.js)│               │  auth.js (verify JWT)│           │ Firestore     │
│ fila (app.js)    │◀──JSON────────│  extract.js          │◀──────────│  (projeto     │
│ métricas         │               │  monthly.js          │           │   "neoron")   │
│ (metricas.js)    │               │  store.js → data/    │           └──────────────┘
└──────────────────┘               └──────────────────────┘
```

- O usuário loga **no Firebase do Neoron** direto do browser (a senha nunca
  passa pelo nosso servidor). O `idToken` resultante vai em cada request.
- O servidor **verifica o token localmente** (RS256, certs do Google em cache)
  e usa o token do próprio usuário para ler o Firestore — ou seja, cada
  extração roda com as permissões reais de quem clicou.
- Estado compartilhado do time (finalizados, tentativas de ligação,
  justificativas, índice, auditoria) vive em `data/` no host.

## Como o dado vive no Neoron (mapeado ao vivo)

```
bots_draft/{botId}                                bots do usuário (users[])
bots/{botId}/agents/{uid}                         nomes dos atendentes
bots/{botId}/departments/{id}                     departamentos
bots/{botId}/conversations_metadata/{convId}      1 doc por conversa
bots/{botId}/conversations/{convId}/messages/{id} histórico completo
```

Fatos importantes descobertos na base real (ago/2026):

- `channel` ∈ `WHATSAPP` (190) · `INSTAGRAM` (5) · `WEB` (6) · **ausente** (225
  docs "stub" com quase nada de metadata, mas com mensagens reais dentro).
- Leads de Instagram têm `contact.instagram_username` e telefone vazio.
- Tags são **mapas de objetos** `{id: {name, color, id}}` em `contact.tags` E
  `conversation.tags` (não arrays).
- Mensagens: `{ sender: 'user'|'agent'|'bot', created_date: ms, message:{content},
  message_list:[{content}] }`. Mensagens de agente têm prefixo
  `<strong>Nome</strong>:` — é daí que sai o atendente real.
- Status inclui `CLOSED` além dos `TAKEOVER_*`.

## Módulos (src/)

| Módulo | Responsabilidade |
|---|---|
| `config.js` | env, caminhos de dados |
| `firestore.js` | cliente REST do Firestore + decode de documentos |
| `neoron.js` | domínio: bots, agentes, conversas, mensagens, `mapLimit` |
| `auth.js` | verificação local de idToken (RS256) + allow-list |
| `lead.js` | normalização conversa → lead (canal, etapa, tags, telefone/@ig) |
| `extract.js` | orquestra a extração incremental; resumo; CSV |
| `metrics.js` | velocidade de resposta, temperatura por sinais, atendente |
| `monthly.js` | métricas mensais reais (vendas, conversão, tendência, equipe) |
| `products.js` | detecção de categoria por regex |
| `catalog.js` | catálogo importado + match TF-IDF de SKU |
| `ai.js` | nota IA 0-10 do atendimento (opcional, cacheada) |
| `store.js` | persistência em `data/` + auditoria |
| `xlsx.js` | export Excel |
| `sanitize.js` | anti fórmula-injection em CSV/Excel |
| `server.js` | rotas HTTP + hardening |

## O índice incremental (a peça-chave)

`data/convindex.json` guarda, por conversa, tudo que é derivado das mensagens:

```
{ metaLastMs, lastMs, firstTs, firstUserTs, msgCount, userMsgs, agentMsgs,
  atendente, firstResponseMs, medianResponseMs, pendingUserTs,
  interesseScore, temperatura, motivos, monthsActive[], produto* }
```

Na extração, uma conversa só é re-buscada quando `conversations_metadata.
last_message_at` difere do `metaLastMs` cacheado. Consequências:

1. **Primeira extração**: varre as ~426 conversas (1-2 min).
2. **Extrações seguintes**: buscam só o que mudou (segundos).
3. **Métricas mensais** saem do índice — inclusive dos 225 docs "stub" que a
   v1 nem enxergava (é por isso que agora o total bate com o Neoron).

Docs stub não têm `last_message_at` (`metaLastMs = 0`); são buscados uma vez e
depois só re-verificados se a metadata ganhar timestamp.

Campos dependentes do relógio (aguardando há quanto tempo, fila +24 h, decay
de temperatura) são recomputados a cada request a partir de `pendingUserTs` e
`lastMs` — o cache nunca "congela" a urgência.

## Frontend (public/)

Sem build, sem dependências. `index.html` + 4 scripts:

- `auth.js` — login/refresh/logout (sessionStorage; refresh automático).
- `app.js` — shell, pipeline, fila, modais (transcrição, finalizar), export.
- `metricas.js` — visão do gestor (KPIs com delta, pódio, barras mês×mês,
  funil, tendência, tabela da equipe).
- `charts.js` — SVG line chart + sparklines (zero libs).

Tudo que vem do Neoron passa por `esc()` antes do DOM — nunca HTML cru.
Design system Belmont (cores/tipografia) em `style.css`, derivado de
`Design/Leads Pipeline.dc.html`.

## Dados locais (`data/`, git-ignored)

| Arquivo | Conteúdo | Cresce? |
|---|---|---|
| `leads.json` | última extração (rows + resumo) | sobrescrito |
| `leads.csv` | espelho CSV | sobrescrito |
| `convindex.json` | índice incremental por conversa | podado (retenção) |
| `done.json` | finalizados `{id: {at, by, reason, note, snap}}` | podado (180 d) |
| `noanswer.json` | tentativas de ligação | pequeno |
| `justificativas.json` | presets do time | pequeno |
| `ai-scores.json` | cache da nota IA | podado |
| `history.jsonl` | snapshot por extração (tendências) | append |
| `audit.jsonl` | trilha de auditoria (quem fez o quê) | append |
| `catalogo.json` | catálogo importado | substituído |

## Decisões e trade-offs

- **JSON em disco, não banco**: 1 host, poucas centenas de leads, escrita
  atômica (`.tmp` + rename). Se a base multiplicar por 100, o próximo passo é
  SQLite — a interface do `store.js` já isola isso.
- **Token do usuário, não service account**: sem credencial privilegiada
  parada no servidor; acesso morre junto com a conta Neoron do usuário.
- **Escala horizontal/incremental**: novos canais = novo valor em `canalOf` +
  badge no front; novas etapas = tag em `STAGE_TAGS`; novos sinais de
  temperatura = entrada em `SIGNALS`.
