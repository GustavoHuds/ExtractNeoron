# Postura de Segurança — ExtractNeoron

Documento gerado após auditoria executada em 2026-08-07.
Revisado em 2026-08-11 (hardening para deploy em VPS + remoção de chaves do código).

---

## Modelo de autenticação

O dashboard usa autenticação **browser-direct Firebase**: o usuário digita e-mail/senha no navegador, que se comunica diretamente com o endpoint Firebase Auth do Google via TLS. A senha **nunca trafega pela LAN em texto puro** e **nunca é armazenada pelo servidor local**. Após o login, o Firebase retorna um ID token (JWT, validade ≤ 1h) e um refresh token; o navegador guarda o **refresh token** (não a senha) no localStorage para login automático nas próximas sessões.

O servidor Express verifica cada requisição usando o ID token recebido como Bearer header, validando a assinatura RS256 localmente em `src/auth.js` (chaves públicas do Google). Nenhuma credencial é transmitida ao servidor além do token de curta duração.

---

## Controle de acesso

Todas as rotas `/api/*` exigem um Firebase ID token válido, verificado pelo middleware `requireAuth` em `src/auth.js`. Sem token válido, a API retorna 401.

**Allow-list opcional:** definindo `AUTHORIZED_EMAILS` (lista separada por vírgula) no `.env`, apenas esses e-mails são aceitos — qualquer outro token válido recebe **403**. Vazia (padrão), qualquer conta Neoron válida entra (adequado apenas atrás de VPN/rede interna).

**Rate limiting:** `express-rate-limit` limita a superfície `/api/*` (600 req / 15 min por IP), protegendo as rotas caras (`/api/extract`, `/api/timeline/refresh`) e a validação de token contra abuso.

**Tamanho de payload:** `express.json({ limit: '8mb' })` — teto para o corpo das requisições (o import de catálogo é o maior caso legítimo).

---

## XSS

- A função `esc()` escapa caracteres HTML especiais (`&`, `<`, `>`, `"`, `'` e crase) antes de qualquer inserção via `innerHTML`.
- CSP estrita aplicada nos headers HTTP: `script-src 'self'` — nenhum JS de terceiros é carregado.
- Todo conteúdo dinâmico gerado a partir dos dados do Firestore passa por `esc()` antes de ser renderizado no DOM.

---

## Injeção de fórmula (CSV / Excel)

Neutralizada em `src/sanitize.js`: células cujo conteúdo começa com `=`, `+`, `-`, `@`, TAB ou CR recebem o prefixo `'` (apóstrofo), impedindo que planilhas interpretem o valor como fórmula.

---

## Segredos

**Nenhuma chave fica no código-fonte.** A **Firebase web API key** é pública por design (a segurança do Firebase vem de tokens + Firebase Security Rules, não do sigilo da chave), mas mesmo assim foi **removida do código** e passou a ser lida de `NEORON_API_KEY` (env). O servidor a entrega ao browser em tempo de execução via `GET /config.js` — assim nenhum literal `AIza…` aparece em arquivos versionados e scanners de segredo (GitHub/Google) não sinalizam mais o repositório.

Os arquivos sensíveis são **git-ignored** e **não estão versionados**:

| Arquivo / padrão | Rastreado pelo git? |
|---|---|
| `.env` | **NÃO** |
| `storageState.json` | **NÃO** |
| `data/` (estado + catálogo importado) | **NÃO** |

Varredura do histórico (`git log --all -- .env`): o `.env` real **nunca** foi commitado; apenas `.env.example` com placeholders.

**Ação recomendada:** a senha da conta Neoron usada pelo `discover.js` (ferramenta local de mapeamento) deve ser **rotacionada** se já esteve em um `.env` compartilhado ou copiado para outra máquina — ela é o único segredo real do fluxo e não é necessária no servidor.

---

## Dependências

Resultado do `npm audit --omit=dev` executado em 2026-08-07:

```
# npm audit report

uuid  <11.1.1
Severity: moderate
uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided
https://github.com/advisories/GHSA-w5hq-g745-h8pq
fix available via `npm audit fix --force` (breaking change)
node_modules/uuid
  exceljs  >=3.5.0
  Depends on vulnerable versions of uuid
  node_modules/exceljs

2 moderate severity vulnerabilities
```

`npm audit fix` (sem `--force`) foi executado e **não alterou nenhum pacote** — a correção disponível exigiria rebaixar `exceljs` para a versão 3.4.0 (breaking change). A vulnerabilidade (`uuid` < 11.1.1) afeta apenas a geração de UUIDs v3/v5/v6 com buffer externo — este projeto usa `exceljs` apenas para exportação local de Excel e não gera UUIDs com buffers externos. Risco residual: **baixo** no contexto de uso local/LAN.

**Ação recomendada:** monitorar o release de `exceljs` compatível com `uuid ≥ 11.1.1` e atualizar quando disponível sem breaking change.

---

## Divulgação de informação

As respostas de erro da API são genéricas (ex.: `{"error":"Unauthorized"}`); detalhes de stack trace e mensagens internas ficam apenas no log do servidor (stdout). Tokens e senhas nunca são logados.

---

## Cabeçalhos de segurança

Aplicados via **`helmet`** (padrão de mercado) com CSP ajustada às necessidades reais do app:

| Cabeçalho | Valor |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `connect-src` só self + `identitytoolkit`/`securetoken` do Google; `script-src 'self'` (sem JS externo); `base-uri 'none'`; `frame-ancestors 'none'`; `object-src 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` (reforçado por `frame-ancestors 'none'` na CSP) |
| `Referrer-Policy` | `no-referrer` |
| `X-Powered-By` | removido (`app.disable('x-powered-by')`) |

`HSTS` fica desligado no app (só faz sentido sobre HTTPS) — habilite-o no terminador TLS caso um proxy/HTTPS seja adicionado.

## Exposição de rede / deployment

No Docker Compose o container publica a porta **apenas em `127.0.0.1`** da VPS (`ports: "127.0.0.1:3000:3000"`), então o painel **não fica acessível pela internet pública** — o acesso é por VPN ou túnel SSH. O processo roda como usuário **não-root** (`USER node`) e a imagem **não inclui Playwright/Chromium** (o servidor nunca abre navegador), reduzindo tamanho e superfície de ataque.

## Ataques considerados (pentest)

| Vetor | Situação |
|---|---|
| **CSRF** | Não aplicável — auth por Bearer header (não cookie); requisição cross-site não injeta o header. |
| **XSS** | CSP estrita + `esc()` em todo conteúdo dinâmico. |
| **SSRF** | Sem URLs controladas pelo usuário no servidor (só certs do Google + Firestore com o token do próprio usuário). |
| **Path traversal** | Downloads servem caminhos fixos; catálogo em caminho fixo/validado. |
| **Prototype pollution** | Import de catálogo e `setDone` rejeitam chaves `__proto__`/`constructor`/`prototype`. |
| **Alg confusion / token forjado** | `verifyIdToken` exige RS256, valida `iss`/`aud`/`exp`/assinatura contra os certs do Google (coberto por testes). |
| **DoS** | Rate limit + limite de body + guardas de concorrência nas rotas caras. |

---

## Riscos residuais (documentados)

1. **HTTP na LAN:** o servidor roda em HTTP puro. O ID token (Bearer, validade ≤ 1h) trafega em claro na rede local. Em ambiente de rede não confiável (Wi-Fi público, redes compartilhadas), recomenda-se habilitar HTTPS com certificado local (ex.: `mkcert`).

2. **Refresh token no localStorage:** o refresh token do Firebase fica no `localStorage` do navegador, acessível por JavaScript na origem. Mitigado pela CSP estrita (`script-src 'self'`, sem scripts de terceiros) e pelo escaping completo de todo conteúdo dinâmico — reduz significativamente a superfície de ataque XSS.

3. **Vuln `uuid` em `exceljs`:** conforme documentado na seção Dependências. Risco baixo no contexto de uso local.
