#!/usr/bin/env bash
# Backup do banco do projeto Supabase (só dados; o schema está nas migrations) em ~/Backups/nexus, fora do
# repositório. Guarda os 14 mais recentes. Precisa do Docker aberto (o `supabase db dump` roda o pg_dump nele).
# Dois modos:
#   - dentro do repositório (padrão): usa o CLI do projeto e o projeto vinculado (`--linked`);
#   - independente: com SUPABASE_BIN e SUPABASE_PROJECT_REF definidos não toca no repositório. É o modo do
#     agendamento (scripts/agendar-backup.sh): o launchd não pode ler a pasta Documents (proteção do macOS).
# Uso: scripts/backup-db.sh
set -euo pipefail
dir="${BACKUP_DIR:-$HOME/Backups/nexus}"
mkdir -p "$dir"; chmod 700 "$dir"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$dir/nexus-$stamp.sql.gz"
tmp="$(mktemp)"

# `auth` inclui as contas (o dump padrão ignora os schemas do sistema).
flags=(db dump --data-only --use-copy -s public,auth -f "$tmp")
if [ -n "${SUPABASE_BIN:-}" ]; then
  "$SUPABASE_BIN" "${flags[@]}" --project-ref "${SUPABASE_PROJECT_REF:?defina SUPABASE_PROJECT_REF}" >/dev/null
else
  cd "$(dirname "$0")/.."
  pnpm --filter @nexus/api exec supabase "${flags[@]}" --linked >/dev/null
fi

gzip -c "$tmp" > "$out"
rm -f "$tmp"; chmod 600 "$out"
ls -1t "$dir"/nexus-*.sql.gz | tail -n +15 | xargs -I{} rm -f {}
echo "$(date '+%F %T') Backup: $out ($(du -h "$out" | cut -f1))"
