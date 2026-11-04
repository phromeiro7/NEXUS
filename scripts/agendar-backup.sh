#!/usr/bin/env bash
# Agenda o backup do banco no launchd do Mac: todo dia às 03:00 (só roda com o Mac ligado e o Docker aberto,
# porque o `supabase db dump` usa um container). Log em ~/Backups/nexus/backup.log.
# Uso: scripts/agendar-backup.sh instalar | remover | status | agora
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
label="com.nexus.backup"
plist="$HOME/Library/LaunchAgents/$label.plist"
dir="${BACKUP_DIR:-$HOME/Backups/nexus}"
alvo="gui/$(id -u)/$label"

case "${1:-}" in
  instalar)
    mkdir -p "$dir" "$HOME/Library/LaunchAgents"
    # O launchd começa com um PATH mínimo: leva o do shell de agora (pnpm, node e docker).
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$root/scripts/backup-db.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string></dict>
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
    rm -f "$plist"; echo "Agendamento removido" ;;
  status) launchctl print "$alvo" 2>/dev/null | grep -E "state|last exit code|runs" || echo "Não agendado" ;;
  agora) launchctl kickstart -k "$alvo" && echo "Disparado; veja $dir/backup.log" ;;
  *) echo "Uso: $0 instalar | remover | status | agora"; exit 1 ;;
esac
