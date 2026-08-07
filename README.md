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

## Setup

```bash
npm install
npx playwright install chromium   # só é necessário para o discover.js (mapeamento)
cp .env.example .env               # e preencha as credenciais
```

`.env` (git-ignored — nunca commitado):

```
NEORON_EMAIL=...            # login admin do Neoron
NEORON_PASSWORD=...
IDLE_THRESHOLD_HOURS=24     # acima disso o chat é marcado "esquecido"
NEGOCIANDO_TAG_NAME=negociando
PORT=3000
```

## Uso

```bash
npm run extract   # gera data/negociando.csv e data/negociando.json
npm run serve     # abre o dashboard em http://localhost:3000
```

### Página **Leads** (`/`)
- Botão **Extrair** re-executa a extração; **auto-atualização a cada 15 min**.
- **Filtro inteligente por situação** (derivada das tags): **Abertos** (padrão) · Todos · Vendidos · Descartados. Assim os leads já vendidos/descartados não poluem a fila de ligação.
- **Etiqueta de temperatura** (faixa colorida à esquerda): 🔴 quente · 🟠 morno · 🔵 frio (por recência + se o cliente está aguardando resposta).
- Badge **⏳ aguardando** quando o cliente mandou a última mensagem e espera resposta.
- **Telefone formatado** + botão de **copiar** (ícone) e atalho **wa** (WhatsApp).
- Botão **Marcar feito** por lead (persistente e compartilhado na rede — para o atendente marcar quando ligar). "Ocultar feitos" liga/desliga.
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
| `src/catalog.js` | Casa a conversa com o **catálogo real** (`Catálogo - ref/data/catalogo-dados.json`) via TF-IDF: quando um modelo/marca é citado (SMILE, GRECIA, ORTOBOM, MIDEA…), identifica o **SKU + preço**. Exige token âncora + 2 tokens + preço > 0 para confirmar. |
| `src/products.js` | Fallback: quando nenhum modelo é citado, detecta a **categoria** (Colchão, Cama casal, Guarda-roupa…) por palavra-chave. Edite `PRODUCT_RULES`. |
| `src/metrics.js` | Nome real do atendente (do texto da conversa) + velocidade de resposta correta (pergunta→resposta). |
| `src/timeline.js` | Agrega métricas históricas para a página Timeline. |
| `src/store.js` | Persistência do "Feito" e snapshots do pipeline. |
| `src/xlsx.js` | Exportação Excel estilizada (exceljs). |
| `src/server.js` | Express + rede local (`/api/extract`, `/api/data`, `/api/done`, `/api/download[.xlsx]`, `/api/timeline`). |
| `src/config.js` | Carrega `.env`, caminhos e parâmetros. |
| `src/discover.js` | Ferramenta de **mapeamento** (Playwright): loga no Direct e captura as queries do Firestore. Use se o Neoron mudar a estrutura. |
| `public/` | Dashboard (HTML/CSS/JS). |
| `data/` | Saída + sessão (git-ignored). |

## Segurança

Credenciais só no `.env` (git-ignored). `data/` e `storageState.json` também são
ignorados. Tudo roda localmente; nenhum dado sai da máquina.

## Observações / próximos passos possíveis

- Hoje a extração varre todas as conversas do bot (241 no momento) e filtra em
  memória — simples e robusto. Se o volume crescer muito, dá para trocar pelo
  filtro server-side `contact.tags_id array-contains {tagId}` (sem `orderBy`,
  usa índice automático).
- "Fazer ligações": por ora só montamos a tabela com o indicador de tempo parado.
  Um passo futuro seria alertas (WhatsApp/e-mail) para os chats esquecidos.
