#!/bin/bash
# Claude Code hook script to update Stream Deck status

# Read and parse all fields in a single jq call (IFS=tab to handle spaces in paths)
IFS=$'\t' read -r session_id event project_dir notif_type < <(jq -r '[.session_id // "", .hook_event_name // "", .cwd // "", .notification_type // ""] | @tsv')

# Detect parent application by walking up the process tree
detect_parent_app() {
  local pid=$$
  local app_name=""
  # Walk up process tree looking for a known GUI app
  for i in {1..10}; do
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [[ -z "$pid" || "$pid" == "1" ]] && break
    local cmd=$(ps -o comm= -p "$pid" 2>/dev/null)
    case "$cmd" in
      *Hyper*) app_name="Hyper"; break ;;
      *Cursor*) app_name="Cursor"; break ;;
      *iTerm*) app_name="iTerm2"; break ;;
      *Warp*) app_name="Warp"; break ;;
      *Alacritty*) app_name="Alacritty"; break ;;
      *kitty*) app_name="kitty"; break ;;
      *Code*) app_name="VS Code"; break ;;
      *zed*) app_name="Zed"; break ;;
      *Terminal) app_name="Terminal"; break ;;
    esac
  done
  echo "${app_name:-Unknown}"
}

# Detect the Claude Code (node) process PID by walking up the process tree
detect_claude_pid() {
  local pid=$$
  for i in {1..10}; do
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [[ -z "$pid" || "$pid" == "1" ]] && break
    local cmd=$(ps -o comm= -p "$pid" 2>/dev/null)
    if [[ "$cmd" == *"node"* || "$cmd" == *"claude"* ]]; then
      echo "$pid"
      return
    fi
  done
  # Fallback: use direct parent PID
  echo "$PPID"
}

# Only detect app and PID on SessionStart to avoid overhead on every hook
if [[ "$event" == "SessionStart" ]]; then
  app_name=$(detect_parent_app)
  claude_pid=$(detect_claude_pid)
  # Cache the app name and PID for this session
  mkdir -p "$HOME/.claude/hooks/cache"
  echo "$app_name" > "$HOME/.claude/hooks/cache/$session_id.app"
  echo "$claude_pid" > "$HOME/.claude/hooks/cache/$session_id.pid"
else
  # Read cached app name and PID
  app_name=$(cat "$HOME/.claude/hooks/cache/$session_id.app" 2>/dev/null || echo "Terminal")
  claude_pid=$(cat "$HOME/.claude/hooks/cache/$session_id.pid" 2>/dev/null || echo "")
fi

# Exit immediately if no session ID
[[ -z "$session_id" ]] && exit 0

# Get project name from directory (use parameter expansion, not basename command)
project_name="${project_dir##*/}"
[[ -z "$project_name" ]] && project_name="claude"

# Determine state and action based on event type
action_type="update"
case "$event" in
  SessionStart|Stop)
    state="idle"
    ;;
  SessionEnd)
    action_type="remove"
    state="idle"
    ;;
  UserPromptSubmit|PreToolUse|PostToolUse)
    state="working"
    ;;
  Notification)
    [[ "$notif_type" != "permission_prompt" ]] && exit 0
    state="waiting"
    ;;
  *)
    exit 0
    ;;
esac

# Send HTTP POST - SessionEnd must be synchronous to ensure delivery;
# other events can be fire-and-forget for lower latency
if [[ "$action_type" == "remove" ]]; then
  curl -s -X POST "http://127.0.0.1:31548/status" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$session_id\",\"state\":\"$state\",\"project\":\"$project_name\",\"action\":\"$action_type\",\"app\":\"$app_name\",\"pid\":${claude_pid:-0}}" \
    --connect-timeout 1 --max-time 2 >/dev/null 2>&1
else
  curl -s -X POST "http://127.0.0.1:31548/status" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$session_id\",\"state\":\"$state\",\"project\":\"$project_name\",\"action\":\"$action_type\",\"app\":\"$app_name\",\"pid\":${claude_pid:-0}}" \
    --connect-timeout 1 &
fi

# Clean up cache on session end
if [[ "$event" == "SessionEnd" ]]; then
  rm -f "$HOME/.claude/hooks/cache/$session_id.app" 2>/dev/null
  rm -f "$HOME/.claude/hooks/cache/$session_id.pid" 2>/dev/null
fi

exit 0
