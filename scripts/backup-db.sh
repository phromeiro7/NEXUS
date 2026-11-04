#!/usr/bin/env bash
# Backup do banco do projeto Supabase vinculado (só dados; o schema está nas migrations) em ~/Backups/nexus, fora do repositório.
# Guarda os 14 mais recentes. Usa o CLI do Supabase (precisa estar logado e do Docker aberto).
# Uso: scripts/backup-db.sh   (dá para agendar no launchd ou no cron)
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${BACKUP_DIR:-$HOME/Backups/nexus}"
mkdir -p "$dir"; chmod 700 "$dir"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$dir/nexus-$stamp.sql.gz"
tmp="$(mktemp)"
# Só dados: o schema vem das migrations. `auth` inclui as contas (o dump padrão ignora schemas do sistema).
pnpm --filter @aj/api exec supabase db dump --linked --data-only --use-copy -s public,auth -f "$tmp" >/dev/null
gzip -c "$tmp" > "$out"
rm -f "$tmp"; chmod 600 "$out"
ls -1t "$dir"/nexus-*.sql.gz | tail -n +15 | xargs -I{} rm -f {}
echo "Backup: $out ($(du -h "$out" | cut -f1))"
