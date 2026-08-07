# Postura de Segurança — ExtractNeoron

Documento gerado após auditoria executada em 2026-08-07.

---

## Modelo de autenticação

O dashboard usa autenticação **browser-direct Firebase**: o usuário digita e-mail/senha no navegador, que se comunica diretamente com o endpoint Firebase Auth do Google via TLS. A senha **nunca trafega pela LAN em texto puro** e **nunca é armazenada pelo servidor local**. Após o login, o Firebase retorna um ID token (JWT, validade ≤ 1h) e um refresh token; o navegador guarda o **refresh token** (não a senha) no localStorage para login automático nas próximas sessões.

O servidor Express verifica cada requisição usando o ID token recebido como Bearer header, validando a assinatura RS256 localmente em `src/auth.js` (chaves públicas do Google). Nenhuma credencial é transmitida ao servidor além do token de curta duração.

---

## Controle de acesso

Todas as rotas `/api/*` exigem um Firebase ID token válido, verificado pelo middleware `requireAuth` em `src/server.js`. Sem token válido, a API retorna 401. Antes desta implementação, o dashboard ficava aberto na LAN sem qualquer autenticação.

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

A **Firebase web API key** é pública por design (a segurança do Firebase é garantida por tokens + Firebase Security Rules, não pelo sigilo da chave).

Os arquivos sensíveis são **git-ignored** e **não estão versionados**:

| Arquivo / padrão | Rastreado pelo git? |
|---|---|
| `.env` | **NÃO** (verificado: `git ls-files` não retornou `.env`) |
| `storageState.json` | **NÃO** (verificado: ausente em `git ls-files`) |
| `data/` (toda a pasta) | **NÃO** (verificado: ausente em `git ls-files`) |

Varredura do histórico git (`git log -p -S "NEORON_PASSWORD=" -- .`): apenas valores placeholder encontrados (`your-password-here`, `...`). **Nenhuma senha real no histórico.**

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

Os seguintes cabeçalhos HTTP são enviados pelo servidor Express em todas as respostas:

| Cabeçalho | Valor |
|---|---|
| `Content-Security-Policy` | `script-src 'self'` (sem JS externo) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |

---

## Riscos residuais (documentados)

1. **HTTP na LAN:** o servidor roda em HTTP puro. O ID token (Bearer, validade ≤ 1h) trafega em claro na rede local. Em ambiente de rede não confiável (Wi-Fi público, redes compartilhadas), recomenda-se habilitar HTTPS com certificado local (ex.: `mkcert`).

2. **Refresh token no localStorage:** o refresh token do Firebase fica no `localStorage` do navegador, acessível por JavaScript na origem. Mitigado pela CSP estrita (`script-src 'self'`, sem scripts de terceiros) e pelo escaping completo de todo conteúdo dinâmico — reduz significativamente a superfície de ataque XSS.

3. **Vuln `uuid` em `exceljs`:** conforme documentado na seção Dependências. Risco baixo no contexto de uso local.
