# Deploy — VPS + Docker

## Requisitos

- VPS Linux com Docker + Docker Compose.
- Proxy TLS (Caddy ou nginx) **ou** VPN (WireGuard/Tailscale) na frente.
- Git com acesso ao repositório.

## Primeira instalação

```bash
git clone https://github.com/GustavoHuds/ExtractNeoron.git
cd ExtractNeoron
cp .env.example .env
nano .env          # NEORON_API_KEY (obrigatório), AUTHORIZED_EMAILS, ANTHROPIC_API_KEY (opcional)
docker compose up -d --build
curl http://127.0.0.1:3000/health   # {"ok":true}
```

O compose faz bind em `127.0.0.1:3000` — nada exposto na internet por padrão.

### Publicando com Caddy (TLS automático)

```
painel.suaempresa.com.br {
    reverse_proxy 127.0.0.1:3000
}
```

Com VPN (Tailscale etc.), aponte o cliente para `http://IP-da-VPN:3000` e pule
o proxy — mas preencha `AUTHORIZED_EMAILS` mesmo assim.

## Atualização (deploy de nova versão)

Fluxo Git (trunk-based, deploy sempre da `main`):

```bash
git pull origin main
docker compose up -d --build
```

Releases são tags (`v2.0.0`, `v2.1.0`…): `git tag v2.x.y && git push --tags`.

## Fluxo de desenvolvimento

- `main` é sempre deployável (testes verdes: `npm test`).
- Trabalho novo em branch curta `feat/...` ou `fix/...` → PR → merge na main.
- Commits convencionais (`feat:`, `fix:`, `docs:`, `chore:`) — o histórico é
  parte da documentação.

## Backup

Todo o estado do time está em `data/`:

```bash
tar czf backup-$(date +%F).tar.gz data/
```

Agende diariamente (cron) e copie para fora do host. Para restaurar: pare o
container, extraia o tar em `data/`, suba de novo.

## Troubleshooting

| Sintoma | Causa provável |
|---|---|
| Login falha com credencial certa | `NEORON_API_KEY` vazia/errada no `.env` |
| 403 após login | e-mail fora de `AUTHORIZED_EMAILS` |
| Extração lenta toda vez | `data/convindex.json` sumiu (o volume `./data` não está montado?) |
| Números divergem do Neoron | rode `npm run discover` no host e compare por canal/tag |
| Nota IA vazia | `ANTHROPIC_API_KEY` não configurada (recurso é opcional) |
