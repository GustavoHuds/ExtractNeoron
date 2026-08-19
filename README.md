# ExtractNeoron v2 · Belmont

Painel de inteligência de vendas das Lojas Belmont. Extrai **todos** os leads do
Neoron — WhatsApp, **Instagram DM** e chat Web — prioriza o pipeline por
urgência, monta a **fila de ligações (+24 h sem resposta)** e calcula as
métricas reais da equipe, mês a mês.

> v2 é o rework completo. A v1 só enxergava conversas com a tag "negociando"
> (~50 de 426) — por isso os números não batiam com o Neoron. A v2 indexa a
> base inteira. Baseline da v1 documentado em [`docs/PROJECT-SCOPE.md`](docs/PROJECT-SCOPE.md).

## O que ele faz

- **Login com a conta Neoron** — cada usuário entra com o próprio e-mail/senha.
  A senha vai direto para o Firebase (Google); o servidor nunca a vê.
- **Pipeline de leads** — lista em cards ordenada por urgência, com funil por
  etapa (Primeiro contato → Negociando → Proposta enviada → Fechamento),
  temperatura (quente/morno/frio explicável por sinais da conversa), canal
  (WhatsApp / Instagram / Web), produto detectado (catálogo TF-IDF + SKU +
  preço), atendente real (extraído das mensagens) e nota IA do atendimento.
- **Fila de ligações** — clientes esperando resposta humana há +24 h, com
  "Ligar agora", WhatsApp, registro de "Não atendeu" e seção separada para
  leads de Instagram (Responder DM).
- **Métricas da equipe** — vendas do mês vs mês anterior, conversão, 1ª
  resposta mediana (8 semanas), leads novos por canal, ticket médio estimado,
  pódio, tabela completa por atendente com sparklines. Definições honestas em
  [`docs/METRICS.md`](docs/METRICS.md).
- **Finalização com desfecho** — Vendido / Sem retorno / Sem interesse /
  Concorrente / Outro, com justificativas reutilizáveis e trilha de auditoria.
- **Exportação** — Excel e CSV respeitando o filtro atual (com proteção contra
  fórmula-injection).

## Rodando

```bash
cp .env.example .env      # preencha NEORON_API_KEY
npm ci
npm run serve             # http://localhost:3000
```

Ou em produção: `docker compose up -d --build` (bind em 127.0.0.1 — publique
via proxy TLS/VPN; ver [`docs/DEPLOY.md`](docs/DEPLOY.md)).

A primeira extração varre a base inteira (~1-2 min). As seguintes são
incrementais: só conversas que mudaram são re-buscadas (segundos).

## Documentação

| Doc | Conteúdo |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Módulos, fluxo de dados, índice incremental |
| [`docs/METRICS.md`](docs/METRICS.md) | Definição exata de cada métrica e de onde vem |
| [`docs/API.md`](docs/API.md) | Rotas HTTP, auth, payloads |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | VPS + Docker + proxy + backup |
| [`SECURITY.md`](SECURITY.md) | Modelo de ameaças e defesas |
| [`docs/PROJECT-SCOPE.md`](docs/PROJECT-SCOPE.md) | Baseline da v1 (histórico) |

## Stack

Node.js 22 + Express (sem framework no front — HTML/CSS/JS puro, sem build).
Dados do Neoron via Firestore REST com o token do próprio usuário. Estado
local em `data/` (JSON, git-ignored). Testes com `node --test` (`npm test`).
