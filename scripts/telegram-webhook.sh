#!/usr/bin/env bash
# Registra, consulta ou remove o webhook do bot, lendo o token e o segredo de .env.telegram (nunca os imprime).
# O polling local e o webhook não convivem: `set` desliga o polling na prática (pare o scripts/local-up.sh antes).
# Uso: scripts/telegram-webhook.sh set https://<api>.onrender.com | info | delete
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.telegram; set +a
api() { curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/$1" "${@:2}"; }
show() { python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get("result",d); print({k: r.get(k) for k in ("ok","url","pending_update_count","last_error_message","allowed_updates") if k in r or k=="ok"})'; }
case "${1:-}" in
  set)
    base="${2:?informe a URL https da API}"
    [[ "$base" == https://* ]] || { echo "A URL precisa ser https://"; exit 1; }
    api setWebhook -d "url=${base%/}/telegram/webhook" -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
      -d 'allowed_updates=["message","callback_query"]' | python3 -c 'import sys,json; print("setWebhook ok:", json.load(sys.stdin).get("ok"))'
    api getWebhookInfo | show ;;
  info) api getWebhookInfo | show ;;
  delete) api deleteWebhook | python3 -c 'import sys,json; print("deleteWebhook ok:", json.load(sys.stdin).get("ok"))' ;;
  *) echo "Uso: $0 set <url-https-da-api> | info | delete"; exit 1 ;;
esac
