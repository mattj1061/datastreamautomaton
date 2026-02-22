#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$ROOT_DIR/.runtime/operator-stack"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"
FORCE_MODE=0

ALL_COMPONENTS=(dashboard-api dashboard-ui telegram-listener treasury-worker-loop)

mkdir -p "$PID_DIR" "$LOG_DIR"

pid_file() { echo "$PID_DIR/$1.pid"; }
log_file() { echo "$LOG_DIR/$1.log"; }

component_cmd() {
  case "$1" in
    dashboard-api)
      echo 'node scripts/automaton-dashboard-api.mjs'
      ;;
    dashboard-ui)
      echo 'npm --prefix dashboard run dev -- --host 127.0.0.1 --strictPort'
      ;;
    telegram-listener)
      echo 'npm run treasury:telegram:listen'
      ;;
    treasury-worker-loop)
      cat <<'CMD'
INTERVAL="${AUTOMATON_TREASURY_WORKER_LOOP_INTERVAL_SEC:-15}"
while true; do
  echo "[treasury-worker-loop] $(date -u +%Y-%m-%dT%H:%M:%SZ) tick (interval=${INTERVAL}s)"
  npm run treasury:worker || true
  sleep "$INTERVAL"
done
CMD
      ;;
    *)
      return 1
      ;;
  esac
}

component_desc() {
  case "$1" in
    dashboard-api) echo 'Dashboard API bridge (:8787)';;
    dashboard-ui) echo 'Dashboard Vite dev server (:5174)';;
    telegram-listener) echo 'Telegram treasury command listener';;
    treasury-worker-loop) echo 'Looping Vultisig outbox worker';;
    *) echo "$1" ;;
  esac
}

component_port() {
  case "$1" in
    dashboard-api) echo '8787';;
    dashboard-ui) echo '5174';;
    *) echo '' ;;
  esac
}

kill_conflicting_port_listeners() {
  local name="$1" port="$2"
  local pids pid i
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN -n -P 2>/dev/null | sort -u | tr '
' ' ')"
  if [[ -z "${pids// }" ]]; then
    return 0
  fi

  echo "[ops] --force enabled: killing listeners on port $port before starting $name (pids: $pids)"
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  for i in 1 2 3 4 5 6; do
    if ! lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN -n -P 2>/dev/null | sort -u | tr '
' ' ')"
  if [[ -n "${pids// }" ]]; then
    echo "[ops] --force: hard-killing remaining listeners on port $port (pids: $pids)"
    for pid in $pids; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi
}

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

is_component_running() {
  local pf
  pf="$(pid_file "$1")"
  [[ -f "$pf" ]] || return 1
  local pid
  pid="$(cat "$pf" 2>/dev/null || true)"
  is_pid_running "$pid"
}

cleanup_stale_pid() {
  local name="$1"
  local pf
  pf="$(pid_file "$name")"
  [[ -f "$pf" ]] || return 0
  local pid
  pid="$(cat "$pf" 2>/dev/null || true)"
  if ! is_pid_running "$pid"; then
    rm -f "$pf"
  fi
}

start_component() {
  local name="$1"
  cleanup_stale_pid "$name"
  if is_component_running "$name"; then
    echo "[ops] $name already running (pid $(cat "$(pid_file "$name")"))"
    return 0
  fi

  local cmd log pf pid port launch_cmd
  cmd="$(component_cmd "$name")"
  log="$(log_file "$name")"
  pf="$(pid_file "$name")"
  port="$(component_port "$name")"

  if [[ -n "$port" ]] && lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    if [[ "$FORCE_MODE" -eq 1 ]]; then
      kill_conflicting_port_listeners "$name" "$port"
      sleep 0.5
    fi
  fi
  if [[ -n "$port" ]] && lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "[ops] $name not started: expected port $port is already in use. Stop the existing process first, reuse it, or rerun with --force."
    return 0
  fi

  launch_cmd="$cmd"
  if [[ "$name" == "dashboard-api" ]]; then
    launch_cmd="exec $cmd"
  fi

  {
    echo ""
    echo "[ops] ===== $(date -u +%Y-%m-%dT%H:%M:%SZ) start $name ====="
    echo "[ops] cmd: $cmd"
  } >>"$log"

  nohup bash -lc "cd \"$ROOT_DIR\" && $launch_cmd" </dev/null >>"$log" 2>&1 &
  pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" >"$pf"
  sleep 1

  if is_pid_running "$pid"; then
    echo "[ops] started $name (pid $pid) -> $(component_desc "$name")"
  else
    echo "[ops] failed to start $name; recent log:" >&2
    tail -n 40 "$log" >&2 || true
    rm -f "$pf"
    return 1
  fi
}

stop_component() {
  local name="$1"
  local pf pid i
  pf="$(pid_file "$name")"
  if [[ ! -f "$pf" ]]; then
    echo "[ops] $name not running (no pid file)"
    return 0
  fi
  pid="$(cat "$pf" 2>/dev/null || true)"
  if ! is_pid_running "$pid"; then
    echo "[ops] $name stale pid file removed"
    rm -f "$pf"
    return 0
  fi

  echo "[ops] stopping $name (pid $pid)"
  kill "$pid" 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if ! is_pid_running "$pid"; then
      rm -f "$pf"
      echo "[ops] stopped $name"
      return 0
    fi
    sleep 0.5
  done

  echo "[ops] force-killing $name (pid $pid)"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pf"
}

status_component() {
  local name="$1" pf pid port
  pf="$(pid_file "$name")"
  port="$(component_port "$name")"
  if [[ -f "$pf" ]]; then
    pid="$(cat "$pf" 2>/dev/null || true)"
    if is_pid_running "$pid"; then
      echo "[ops] $name: running pid=$pid log=$(log_file "$name")"
      return 0
    fi
    echo "[ops] $name: stale pid file ($(pid_file "$name"))"
    return 0
  fi

  if [[ -n "$port" ]]; then
    local line
    line="$( (lsof -iTCP:"$port" -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR==2 {print $1" pid="$2" " $9}') || true )"
    if [[ -n "$line" ]]; then
      echo "[ops] $name: no pid file, but port $port in use by $line"
      return 0
    fi
  fi

  echo "[ops] $name: stopped"
}

resolve_components() {
  if [[ "$#" -eq 0 ]]; then
    printf '%s\n' "${ALL_COMPONENTS[@]}"
    return 0
  fi
  local name
  for name in "$@"; do
    case "$name" in
      all)
        printf '%s\n' "${ALL_COMPONENTS[@]}"
        ;;
      dashboard-api|dashboard-ui|telegram-listener|treasury-worker-loop)
        echo "$name"
        ;;
      *)
        echo "Unknown component: $name" >&2
        exit 1
        ;;
    esac
  done
}

usage() {
  cat <<USAGE
Usage: bash scripts/operator-stack.sh [--force] <start|stop|restart|status|logs> [component...]

Components:
  dashboard-api
  dashboard-ui
  telegram-listener
  treasury-worker-loop
  all (alias)

Examples:
  bash scripts/operator-stack.sh start
  bash scripts/operator-stack.sh restart dashboard-api dashboard-ui
  bash scripts/operator-stack.sh --force restart dashboard-api dashboard-ui
  bash scripts/operator-stack.sh status
  bash scripts/operator-stack.sh logs dashboard-api
USAGE
}

cmd="status"
if [[ "$#" -gt 0 && "$1" == "--force" ]]; then
  FORCE_MODE=1
  shift
fi
if [[ "$#" -gt 0 ]]; then
  cmd="$1"
  shift || true
fi
filtered_args=()
for arg in "$@"; do
  if [[ "$arg" == "--force" ]]; then
    FORCE_MODE=1
    continue
  fi
  filtered_args+=("$arg")
done
components=()
if [[ "${#filtered_args[@]}" -eq 0 ]]; then
  while IFS= read -r line; do
    components+=("$line")
  done < <(resolve_components)
else
  while IFS= read -r line; do
    components+=("$line")
  done < <(resolve_components "${filtered_args[@]}")
fi

case "$cmd" in
  start)
    for c in "${components[@]}"; do start_component "$c"; done
    ;;
  stop)
    for c in "${components[@]}"; do stop_component "$c"; done
    ;;
  restart)
    for c in "${components[@]}"; do stop_component "$c"; done
    for c in "${components[@]}"; do start_component "$c"; done
    ;;
  status)
    for c in "${components[@]}"; do status_component "$c"; done
    ;;
  logs)
    if [[ "${#components[@]}" -eq 1 ]]; then
      tail -n 80 -f "$(log_file "${components[0]}")"
    else
      tail -n 80 -f "$LOG_DIR"/*.log
    fi
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
