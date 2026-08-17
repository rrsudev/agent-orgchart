#!/usr/bin/env bash
# Track which live VS Code window is receiving Claude Code hook events for each
# workspace. The discovery files in ~/.claude/agent-flow/ are the source of truth:
# one per activated Agent Fruitstand instance, naming its hook-server port + PID + workspace.
#
# Usage:
#   scripts/track-agent-flow.sh          # snapshot
#   scripts/track-agent-flow.sh --watch  # refresh every 2s
#   scripts/track-agent-flow.sh --ping    # also POST a test event to each hook server

set -euo pipefail
DIR="$HOME/.claude/agent-flow"

show() {
  printf '\n=== Agent Fruitstand instances receiving hooks ===\n'
  local found=0
  for f in "$DIR"/*.json; do
    [ -e "$f" ] || continue
    [ "$(basename "$f")" = "workspaces.json" ] && continue
    found=1
    local port pid ws alive app
    port=$(python3 -c "import json,sys;print(json.load(open('$f'))['port'])" 2>/dev/null || echo '?')
    pid=$(python3 -c "import json,sys;print(json.load(open('$f'))['pid'])" 2>/dev/null || echo '?')
    ws=$(python3 -c "import json,sys;print(json.load(open('$f'))['workspace'])" 2>/dev/null || echo '?')
    if kill -0 "$pid" 2>/dev/null; then alive="ALIVE"; else alive="DEAD (stale)"; fi
    app=$(ps -p "$pid" -o command= 2>/dev/null | grep -oE "/[^ ]*Visual Studio Code[^/]*\.app" | head -1)
    [ -z "$app" ] && app="(process gone)"
    printf '  workspace : %s\n' "$ws"
    printf '  hook port : 127.0.0.1:%s   pid %s   %s\n' "$port" "$pid" "$alive"
    printf '  app       : %s\n' "$app"
    if [ "${1:-}" = "--ping" ] && [ "$alive" = "ALIVE" ]; then
      local code
      code=$(curl -s -o /dev/null -w '%{http_code}' -m 2 \
        -H 'Content-Type: application/json' \
        -d "{\"session_id\":\"tracker-ping\",\"hook_event_name\":\"Notification\",\"cwd\":\"$ws\",\"notification_type\":\"other\"}" \
        "http://127.0.0.1:$port/" 2>/dev/null || echo 'ERR')
      printf '  ping      : HTTP %s (server reachable)\n' "$code"
    fi
    printf '\n'
  done
  [ "$found" = 0 ] && printf '  (none — no Agent Fruitstand window is registered; open the panel in the window that has your project)\n\n'
  return 0
}

case "${1:-}" in
  --watch) while true; do clear; show "${2:-}"; sleep 2; done ;;
  --ping)  show --ping ;;
  *)       show ;;
esac
