# ExtractNeoron — Chats "Negociando"

Extrai do Neoron todas as conversas marcadas com a tag **"Negociando"** e monta
uma tabela (CSV + dashboard local) com **nome, contato, contexto (última
mensagem), responsável, departamento e há quantas horas o chat está parado** —
para identificar leads esquecidos e ligar para eles.

## Como o Neoron funciona (descoberto por engenharia reversa)

- O Neoron é um app **Firebase** (projeto `neoron`). O login usa **Firebase Auth**
  (e-mail/senha) e os dados ficam no **Cloud Firestore** — não há API REST pública
  de leitura (a API documentada só *envia* campanhas).
- O atendimento humano fica no módulo **"Direct"** (`https://direct.neoron.io`).
  `app.neoron.io` é apenas o construtor de chatbots.
- As conversas ficam em `bots/{botId}/conversations_metadata/{convId}` e o
  histórico de mensagens em `bots/{botId}/conversations/{convId}/messages`.
- **"Negociando" é uma _tag_ de contato** (`contact.tags` / `contact.tags_id`),
  não o campo de sistema `status` (que é `CHATBOT`, `TAKEOVER_QUEUE`,
  `TAKEOVER_IN_ATTENDANCE`, etc.). Resolvemos a tag pelo **nome** (`negociando`),
  então não dependemos de um id fixo.

Por isso a extração é feita direto no **Firestore REST** com o token de login —
sem scraping de tela, robusto e rápido.

## Setup (local)

```bash
npm install
cp .env.example .env       # preencha NEORON_API_KEY (chave web pública do Firebase)
npm run serve              # abre o dashboard em http://localhost:3000
```

O login do dashboard é feito **no navegador** (sua conta do Neoron) — o navegador memoriza você para login automático. A **senha nunca vai para o servidor**; ele só valida o token do Firebase.

O `.env` guarda apenas config **não-sensível do servidor** (a `NEORON_API_KEY` é pública por design). `NEORON_EMAIL`/`NEORON_PASSWORD` são usados **somente** pelo `discover.js` (mapeamento local) — não pelo painel. Para rodar o `discover.js`, instale o Chromium: `npx playwright install chromium`.

## Deploy na VPS (Docker Compose)

Voltado para acesso **interno/VPN**: o painel é publicado **só em `127.0.0.1`** da VPS (não fica exposto à internet). Acesse por **túnel SSH** (`ssh -L 3000:127.0.0.1:3000 usuario@vps`) ou pela sua VPN, depois abra `http://localhost:3000`.

Pré-requisitos na VPS: Docker + Docker Compose plugin.

```bash
# 1. Configurar segredos (uma vez). NÃO versionado.
cp .env.example .env
nano .env            # defina NEORON_API_KEY (e, se quiser, AUTHORIZED_EMAILS)

# 2. Subir
docker compose up -d --build

# 3. Atualizações futuras (seu fluxo "pull + deploy")
git pull && docker compose up -d --build
```

Estado (leads marcados como "Feito", histórico e o catálogo importado) persiste no volume `neoron-data` entre reinícios/rebuilds. Logs: `docker compose logs -f`. Health: `http://127.0.0.1:3000/health`.

### Catálogo (importe o seu)

O catálogo de produtos **não é versionado** — cada deployment carrega o seu. No painel, clique em **Catálogo** e selecione um `.json` (mesmo formato do `catalogo-dados.json`: lista de itens com `nome`, `codigo`, `preco`, `categoria`). Ele é salvo em `data/catalogo.json` (volume) e usado para casar produtos por SKU. Sem catálogo, o app continua funcionando com detecção por **categoria**.

## Uso

### Página **Leads** (`/`)
- Botão **Extrair** re-executa a extração; **auto-atualização a cada 15 min**.
- **Filtro por situação**: **Abertos** (padrão) · Não atendeu · **Finalizados** · Todos · Vendidos · Descartados. Leads finalizados vivem só na aba Finalizados e não poluem a fila de ligação.
- **Etiqueta de temperatura** (faixa colorida à esquerda): 🔴 quente · 🟠 morno · 🔵 frio (por recência + se o cliente está aguardando resposta).
- Badge **⏳ aguardando** quando o cliente mandou a última mensagem e espera resposta.
- **Telefone formatado** + ícones de **copiar**, **WhatsApp** e **👁 ver conversa** (transcript completo em popup).
- Botão **Finalizar** por lead: popup com o desfecho (Vendido, Sem retorno, Sem interesse, Comprou concorrente, Outro), registro de **"Não atendeu a ligação"** e **justificativas reutilizáveis** (selecione uma pronta ou escreva e salve a sua). Tudo persistente e compartilhado na rede.
- **Aba Finalizados**: histórico de quem concluiu, quando e por quê — mesmo que o lead saia da tag "negociando" (snapshot). Expurgo automático após **180 dias** (`DONE_RETENTION_DAYS`).
- **Nota IA (0-10)** do atendimento do vendedor por conversa (opcional — requer `ANTHROPIC_API_KEY`). Usa modelo barato, transcript compacto e cache por conversa: só gasta tokens quando o chat muda.
- **Exportar**: Excel (`.xlsx` estilizado) ou CSV.

### Página **Timeline** (`/timeline.html`)
Monitoramento corporativo com dados reais:
- **Velocidade de 1ª resposta** (mediana) — tempo real entre a pergunta do cliente e a resposta do atendente (corrige a métrica antiga de "espera", que contava tempo desde qualquer mensagem).
- **Volume de conversas por dia**, **distribuição do tempo de 1ª resposta** (destaca as lentas > 4h), **funil/conversão** (Aberto/Vendido/Descartado) e **desempenho por atendente** (conversas, 1ª resposta, vendas, aguardando).
- **Pipeline ao longo do tempo** (acumulado a cada extração).

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/firestore.js` | Cliente Firebase Auth + Firestore REST (sign-in, runQuery, listDocuments, decode). |
| `src/extractor.js` | Núcleo: varre `conversations_metadata`, filtra pela tag, normaliza, escreve CSV/JSON. |
| `src/catalog.js` | Casa a conversa com o **catálogo importado** (`data/catalogo.json`, carregado pelo botão **Catálogo**) via TF-IDF: quando um modelo/marca é citado (SMILE, GRECIA, ORTOBOM, MIDEA…), identifica o **SKU + preço**. Exige token âncora + 2 tokens + preço > 0 para confirmar. Sem catálogo, cai no fallback por categoria. |
| `src/products.js` | Fallback: quando nenhum modelo é citado, detecta a **categoria** (Colchão, Cama casal, Guarda-roupa…) por palavra-chave. Edite `PRODUCT_RULES`. |
| `src/metrics.js` | Nome real do atendente (do texto da conversa) + velocidade de resposta correta (pergunta→resposta). |
| `src/timeline.js` | Agrega métricas históricas para a página Timeline. |
| `src/store.js` | Persistência do "Feito" (com snapshot + expurgo de 180 dias), justificativas reutilizáveis e snapshots do pipeline. |
| `src/ai.js` | Nota IA (0-10) do atendimento por conversa (Claude Haiku, transcript compacto, cache em `data/ai-scores.json`). |
| `src/xlsx.js` | Exportação Excel estilizada (exceljs). |
| `src/server.js` | Express + rede local (`/api/extract`, `/api/data`, `/api/done`, `/api/download[.xlsx]`, `/api/timeline`). |
| `src/config.js` | Carrega `.env`, caminhos e parâmetros. |
| `src/discover.js` | Ferramenta de **mapeamento** (Playwright): loga no Direct e captura as queries do Firestore. Use se o Neoron mudar a estrutura. |
| `public/` | Dashboard (HTML/CSS/JS). |
| `data/` | Saída + sessão (git-ignored). |

## Segurança

Ver **[SECURITY.md](SECURITY.md)** para a postura completa. Resumo:

- **Nenhum segredo no código.** A chave web do Firebase vem do `.env` (injetada no browser via `/config.js`); `.env`, `data/` e `storageState.json` são git-ignored.
- **Auth obrigatória** em todas as rotas `/api/*` (Firebase ID token, RS256 verificado localmente). Allow-list opcional de e-mails via `AUTHORIZED_EMAILS`.
- **Headers de segurança** via `helmet` (CSP estrita: sem JS externo; só endpoints do Firebase) e **rate limiting** (`express-rate-limit`).
- **Exposição mínima**: no Docker o painel só escuta em `127.0.0.1` (acesso via VPN/túnel SSH).
- ⚠️ **Rotacione** a senha da conta Neoron usada localmente pelo `discover.js` se ela já esteve em um `.env` compartilhado.

## Observações / próximos passos possíveis

- Hoje a extração varre todas as conversas do bot (241 no momento) e filtra em
  memória — simples e robusto. Se o volume crescer muito, dá para trocar pelo
  filtro server-side `contact.tags_id array-contains {tagId}` (sem `orderBy`,
  usa índice automático).
- "Fazer ligações": por ora só montamos a tabela com o indicador de tempo parado.
  Um passo futuro seria alertas (WhatsApp/e-mail) para os chats esquecidos.
