#!/usr/bin/env bash
# Agenda o backup do banco no launchd do Mac: todo dia às 03:00 (só roda com o Mac ligado e o Docker aberto,
# porque o `supabase db dump` usa um container). Log em ~/Backups/nexus/backup.log.
# O launchd não pode ler a pasta Documents (proteção do macOS), onde fica o projeto: `instalar` copia o CLI do
# Supabase e o script para ~/.local/share/nexus-backup e o agendamento roda de lá, sem tocar no repositório.
# Reinstale (`instalar` de novo) depois de mudar scripts/backup-db.sh ou de atualizar o CLI.
# Uso: scripts/agendar-backup.sh instalar | remover | status | agora
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
label="com.nexus.backup"
plist="$HOME/Library/LaunchAgents/$label.plist"
dir="${BACKUP_DIR:-$HOME/Backups/nexus}"
support="$HOME/.local/share/nexus-backup"
alvo="gui/$(id -u)/$label"

case "${1:-}" in
  instalar)
    ref="$(cat "$root/supabase/.temp/project-ref" 2>/dev/null || true)"
    [ -n "$ref" ] || { echo "Projeto não vinculado (supabase link): não achei supabase/.temp/project-ref"; exit 1; }
    bin="$(ls "$root"/node_modules/.pnpm/@supabase+cli-*/node_modules/@supabase/cli-*/bin/supabase 2>/dev/null | head -1)"
    [ -n "$bin" ] || { echo "CLI do Supabase não encontrado: rode pnpm install"; exit 1; }
    mkdir -p "$dir" "$support" "$HOME/Library/LaunchAgents"
    cp "$bin" "$support/supabase"; cp "$root/scripts/backup-db.sh" "$support/backup-db.sh"
    chmod 700 "$support/supabase" "$support/backup-db.sh"
    # O launchd começa com um PATH mínimo: leva o do shell de agora (docker).
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$support/backup-db.sh</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$PATH</string>
    <key>SUPABASE_BIN</key><string>$support/supabase</string>
    <key>SUPABASE_PROJECT_REF</key><string>$ref</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$dir/backup.log</string>
  <key>StandardErrorPath</key><string>$dir/backup.log</string>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
    echo "Agendado: todo dia às 03:00 (log em $dir/backup.log)" ;;
  remover)
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    rm -f "$plist"; rm -rf "$support"; echo "Agendamento removido" ;;
  status) launchctl print "$alvo" 2>/dev/null | grep -E "state|last exit code|runs" || echo "Não agendado" ;;
  agora) launchctl kickstart -k "$alvo" && echo "Disparado; veja $dir/backup.log" ;;
  *) echo "Uso: $0 instalar | remover | status | agora"; exit 1 ;;
esac
