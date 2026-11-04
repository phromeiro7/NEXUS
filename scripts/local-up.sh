#!/usr/bin/env bash
# Sobe a aplicação inteira no Mac, sem túnel: API, site, lembretes e long polling do Telegram.
# `caffeinate -i` impede o Mac de dormir enquanto isto roda. Ctrl+C para tudo.
# Pré-requisitos: Supabase local no ar (`supabase start`), apps/api/.env preenchido e `pnpm install` feito.
# Portas: API em PORT (apps/api/.env; 3111 aqui) e site em WEB_PORT (padrão 3110). A 3000 e a 3001 costumam
# estar ocupadas por outros projetos; NEXT_PUBLIC_API_URL (apps/web/.env.local) precisa apontar para a porta da API.
# Uso: scripts/local-up.sh [--sem-telegram]
set -euo pipefail
cd "$(dirname "$0")/.."

WEB_PORT="${WEB_PORT:-3110}"
pids=()

# O pnpm gera netos (tsx, next): matar só o PID filho deixaria processos órfãos segurando as portas.
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do kill_tree "$pid"; done
}
trap cleanup EXIT INT TERM

echo "Compilando o site (uma vez)..."
pnpm --filter @aj/web build

pnpm --filter @aj/api start & pids+=($!)
pnpm --filter @aj/web exec next start -p "$WEB_PORT" & pids+=($!)
# Dá tempo da API abrir a porta antes de o agendador e o polling chamarem.
sleep 5
pnpm --filter @aj/api reminders:loop & pids+=($!)
if [ "${1:-}" != "--sem-telegram" ]; then
  pnpm --filter @aj/api telegram:poll & pids+=($!)
fi

# Mantém o Mac acordado enquanto este script viver.
caffeinate -i -w "$$" &
pids+=($!)
# Sem `wait -n` (o bash 3.2 do macOS não tem): sai quando qualquer processo (menos o caffeinate) cair.
while :; do
  for pid in "${pids[@]}"; do
    kill -0 "$pid" 2>/dev/null || { echo "Um dos processos parou; encerrando os demais."; exit 1; }
  done
  sleep 3
done
