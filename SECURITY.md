# Segurança — ExtractNeoron v2

Este sistema lida com dados de clientes (nomes, telefones, @instagram e
conteúdo de conversas comerciais). O modelo de ameaças e as defesas:

## Princípios

1. **Credenciais nunca param no servidor.** O login é feito do browser direto
   contra o Firebase Auth do Google (o mesmo login do Neoron). O servidor só
   recebe o `idToken` de curta duração e o verifica por assinatura RS256
   contra os certificados públicos do Google (cacheados). Sem senha em banco,
   sem senha em log, sem senha em trânsito pelo nosso backend.
2. **Acesso aos dados = permissão real do usuário.** Toda leitura do Firestore
   usa o token do próprio usuário logado. Se a conta perder acesso no Neoron,
   perde acesso aqui no mesmo instante.
3. **Rede fechada por padrão.** O container faz bind em `127.0.0.1`; a
   publicação é responsabilidade de um proxy TLS (Caddy/nginx) ou VPN. O
   painel não foi desenhado para internet aberta.
4. **Identidade em ações vem do token, nunca do cliente.** "Finalizado por",
   auditoria etc. usam o e-mail do JWT verificado.

## Defesas implementadas

| Camada | Defesa |
|---|---|
| Autenticação | Firebase idToken verificado localmente (alg fixo RS256, iss/aud/exp/kid checados, cache de certs com TTL do Google) |
| Autorização | allow-list opcional `AUTHORIZED_EMAILS` (403 para contas fora da lista) |
| Transporte | HSTS/TLS no proxy; `Referrer-Policy: no-referrer`; API com `Cache-Control: no-store` |
| Headers | Helmet com CSP estrita: só `self` + endpoints de auth do Google; `frame-ancestors 'none'` (anti-clickjacking); `object-src 'none'`; `base-uri 'none'` |
| XSS | zero HTML cru: todo dado do Neoron passa por `esc()` antes do DOM; links externos com `rel="noopener noreferrer"` |
| Injeção em planilha | células iniciadas por `= + - @` (incl. espaço à frente) são neutralizadas no CSV e no Excel |
| Prototype pollution | ids `__proto__`/`constructor`/`prototype` ignorados em todos os mapas persistidos |
| DoS | rate limit 600 req/15 min/IP; corpo limitado a 8 MB; extração com mutex (1 por vez); paginação e concorrência limitada (8) contra o Firestore |
| Sessão | tokens em `sessionStorage` (morrem com a aba), refresh silencioso, logout limpa tudo; expiração 401 → volta ao login |
| Auditoria | `data/audit.jsonl` append-only: quem extraiu, finalizou, reabriu, exportou, importou catálogo — com timestamp |
| Container | imagem alpine, `USER node` (non-root), healthcheck, sem devDependencies |
| Segredos | `.env` git-ignored; `ANTHROPIC_API_KEY` é o único segredo real do servidor; a chave web do Firebase é pública por design mas fica fora do fonte |
| Dados em repouso | `data/` fica no host, fora do git e fora da imagem; retenção automática (180 d) para finalizados e caches |

## O que NUNCA sai do host

- `data/` completo (leads, transcrições indexadas, auditoria).
- A única chamada externa além do Google (Firestore/Auth) é a API da Anthropic
  quando a nota IA está ativada — recebe um transcript compacto (últimas ~40
  mensagens, sem telefone/e-mail do cliente no prompt) e nada mais.

## Boas práticas de operação

- Rode atrás de VPN **ou** proxy TLS com allow-list de e-mails preenchida.
- Faça backup criptografado de `data/` (é o estado do time).
- Rotacione a senha de qualquer conta Neoron que já tenha circulado em texto
  plano (chat, e-mail, .env compartilhado).
- Revise `data/audit.jsonl` periodicamente.

## Reporte

Vulnerabilidade encontrada? Abra um issue privado ou contate o time de
tecnologia Belmont. Não publique detalhes antes da correção.
