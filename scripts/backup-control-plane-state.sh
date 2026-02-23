#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/backup-control-plane-state.sh

Creates a control-plane backup snapshot (tar.gz + manifest) under ./.runtime/backups/control-plane.
The snapshot includes automaton runtime state and operator telemetry, but excludes wallet shares/keys.

Included by default (if present):
- ~/.automaton/state.db (+ wal/shm)
- ~/.automaton/automaton.json
- ~/.automaton/heartbeat.yml
- treasury Telegram offset file
- .runtime/treasury-settings-audit.jsonl
- redacted .env.synthesis snapshot (secrets/tokens/passwords masked)

Environment overrides:
  AUTOMATON_BACKUP_OUTPUT_ROOT              Output root (default: ./.runtime/backups/control-plane)
  AUTOMATON_BACKUP_AUTOMATON_HOME           Automaton home dir (default: ~/.automaton or AUTOMATON_HOME)
  AUTOMATON_BACKUP_ENV_FILE                 Env file to redact/capture (default: ./.env.synthesis)
  AUTOMATON_BACKUP_AUDIT_LOG                Treasury settings audit log path (default: ./.runtime/treasury-settings-audit.jsonl)
  AUTOMATON_BACKUP_INCLUDE_OPERATOR_LOGS    true|false copy .runtime/operator-stack/*.log (default: false)
  AUTOMATON_BACKUP_KEEP_STAGING             true|false keep unpacked staging directory (default: false)
  AUTOMATON_BACKUP_RETENTION_DAYS           Optional prune old backup directories under output root
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

expand_home() {
  local p="${1:-}"
  if [[ -z "$p" ]]; then
    printf ''
  elif [[ "$p" == '~' ]]; then
    printf '%s' "$HOME"
  elif [[ "$p" == "~/"* ]]; then
    printf '%s/%s' "$HOME" "${p:2}"
  else
    printf '%s' "$p"
  fi
}

read_env_file_value() {
  local key="$1" file="$2" raw=""
  [[ -f "$file" ]] || return 1
  raw="$(awk -v key="$key" '
    BEGIN { pat = "^[[:space:]]*" key "=" }
    $0 ~ pat && $0 !~ /^[[:space:]]*#/ {
      line = $0
      sub(pat, "", line)
      val = line
    }
    END { if (val != "") print val }
  ' "$file")" || return 1
  raw="${raw%$'\r'}"
  if [[ "$raw" =~ ^\"(.*)\"$ ]]; then
    raw="${BASH_REMATCH[1]}"
  elif [[ "$raw" =~ ^\'(.*)\'$ ]]; then
    raw="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$raw"
}

is_sensitive_key() {
  local key="$1"
  case "$key" in
    *TOKEN_ADDRESS|AUTOMATON_VULTISIG_SEND_TOKEN|AUTOMATON_TREASURY_TX_EXPLORER_TX_URL_TEMPLATE|SERVICE_PUBLIC_BASE_URL|AUTOMATON_PRODUCT_API_BASE_URL)
      return 1
      ;;
  esac
  case "$key" in
    *PASSWORD*|*SECRET*|*PASSPHRASE*|*PRIVATE*|*MNEMONIC*|*API_KEY*|*BOT_TOKEN*|*READ_TOKEN*|*WRITE_TOKEN*|*INTERNAL_TOKEN*|*CHAT_ID*|*SIGNER_CMD*|*WALLET*|*VAULT*)
      return 0
      ;;
  esac
  if [[ "$key" == *TOKEN && "$key" != *TOKEN_ADDRESS ]]; then
    return 0
  fi
  if [[ "$key" == *KEY && "$key" != *MONKEY ]]; then
    return 0
  fi
  return 1
}

redact_env_file() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  [[ -f "$src" ]] || return 1
  : > "$dst"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "$line" ]]; then
      printf '%s\n' "$line" >> "$dst"
      continue
    fi
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)= ]]; then
      local key="${BASH_REMATCH[1]}"
      if is_sensitive_key "$key"; then
        printf '%s=[REDACTED]\n' "$key" >> "$dst"
      else
        printf '%s\n' "$line" >> "$dst"
      fi
    else
      printf '%s\n' "$line" >> "$dst"
    fi
  done < "$src"
}

record_included() { printf '%s\n' "$1" >> "$INCLUDED_LIST"; }
record_missing() { printf '%s\n' "$1" >> "$MISSING_LIST"; }

copy_into_snapshot() {
  local src="$1" rel="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$SNAPSHOT_DIR/$(dirname "$rel")"
    cp -p "$src" "$SNAPSHOT_DIR/$rel"
    record_included "$rel"
  else
    record_missing "$rel"
  fi
}

copy_glob_files() {
  local pattern="$1" rel_dir="$2"
  shopt -s nullglob
  local matches=( $pattern )
  shopt -u nullglob
  if (( ${#matches[@]} == 0 )); then
    record_missing "$rel_dir/*"
    return
  fi
  mkdir -p "$SNAPSHOT_DIR/$rel_dir"
  local src base
  for src in "${matches[@]}"; do
    base="$(basename "$src")"
    cp -p "$src" "$SNAPSHOT_DIR/$rel_dir/$base"
    record_included "$rel_dir/$base"
  done
}

sha256_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    sha256sum "$file" | awk '{print $1}'
  fi
}

AUTOMATON_HOME_DIR="$(expand_home "${AUTOMATON_BACKUP_AUTOMATON_HOME:-${AUTOMATON_HOME:-~/.automaton}}")"
ENV_FILE="$(expand_home "${AUTOMATON_BACKUP_ENV_FILE:-$ROOT_DIR/.env.synthesis}")"
AUDIT_LOG_PATH="$(expand_home "${AUTOMATON_BACKUP_AUDIT_LOG:-$ROOT_DIR/.runtime/treasury-settings-audit.jsonl}")"
OUTPUT_ROOT="$(expand_home "${AUTOMATON_BACKUP_OUTPUT_ROOT:-$ROOT_DIR/.runtime/backups/control-plane}")"
INCLUDE_OPERATOR_LOGS="$(printf '%s' "${AUTOMATON_BACKUP_INCLUDE_OPERATOR_LOGS:-false}" | tr '[:upper:]' '[:lower:]')"
KEEP_STAGING="$(printf '%s' "${AUTOMATON_BACKUP_KEEP_STAGING:-false}" | tr '[:upper:]' '[:lower:]')"
RETENTION_DAYS="${AUTOMATON_BACKUP_RETENTION_DAYS:-}"

TELEGRAM_OFFSET_DEFAULT="~/.automaton/treasury-telegram-offset.json"
TELEGRAM_OFFSET_RAW="${AUTOMATON_TREASURY_TELEGRAM_OFFSET_FILE:-}"
if [[ -z "$TELEGRAM_OFFSET_RAW" && -f "$ENV_FILE" ]]; then
  TELEGRAM_OFFSET_RAW="$(read_env_file_value AUTOMATON_TREASURY_TELEGRAM_OFFSET_FILE "$ENV_FILE" || true)"
fi
if [[ -z "$TELEGRAM_OFFSET_RAW" ]]; then
  TELEGRAM_OFFSET_RAW="$TELEGRAM_OFFSET_DEFAULT"
fi
TELEGRAM_OFFSET_PATH="$(expand_home "$TELEGRAM_OFFSET_RAW")"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$OUTPUT_ROOT/$TIMESTAMP"
SNAPSHOT_DIR="$RUN_DIR/snapshot"
INCLUDED_LIST="$RUN_DIR/included.txt"
MISSING_LIST="$RUN_DIR/missing.txt"
ARTIFACT_PATH="$RUN_DIR/control-plane-backup.tar.gz"
MANIFEST_PATH="$RUN_DIR/manifest.json"

mkdir -p "$SNAPSHOT_DIR" "$RUN_DIR"
: > "$INCLUDED_LIST"
: > "$MISSING_LIST"

printf '[backup-control-plane] automaton_home=%s\n' "$AUTOMATON_HOME_DIR"
printf '[backup-control-plane] output=%s\n' "$RUN_DIR"

# Core state/config (wallet files intentionally excluded)
copy_into_snapshot "$AUTOMATON_HOME_DIR/state.db" "automaton/state.db"
copy_into_snapshot "$AUTOMATON_HOME_DIR/state.db-wal" "automaton/state.db-wal"
copy_into_snapshot "$AUTOMATON_HOME_DIR/state.db-shm" "automaton/state.db-shm"
copy_into_snapshot "$AUTOMATON_HOME_DIR/automaton.json" "automaton/automaton.json"
copy_into_snapshot "$AUTOMATON_HOME_DIR/heartbeat.yml" "automaton/heartbeat.yml"
copy_into_snapshot "$TELEGRAM_OFFSET_PATH" "automaton/treasury-telegram-offset.json"

# If automaton.json points at a non-default DB path, copy it too when present.
CUSTOM_DB_PATH=""
if [[ -f "$AUTOMATON_HOME_DIR/automaton.json" ]]; then
  CUSTOM_DB_PATH="$(python3 - <<'PY' "$AUTOMATON_HOME_DIR/automaton.json" 2>/dev/null || true
import json, os, sys
p = sys.argv[1]
try:
    cfg = json.load(open(p, 'r', encoding='utf-8'))
    v = cfg.get('dbPath') if isinstance(cfg, dict) else None
    if isinstance(v, str) and v:
        print(v)
except Exception:
    pass
PY
)"
  if [[ -n "$CUSTOM_DB_PATH" ]]; then
    CUSTOM_DB_PATH="$(expand_home "$CUSTOM_DB_PATH")"
    if [[ "$CUSTOM_DB_PATH" != "$AUTOMATON_HOME_DIR/state.db" ]]; then
      copy_into_snapshot "$CUSTOM_DB_PATH" "automaton/custom-state.db"
      copy_into_snapshot "${CUSTOM_DB_PATH}-wal" "automaton/custom-state.db-wal"
      copy_into_snapshot "${CUSTOM_DB_PATH}-shm" "automaton/custom-state.db-shm"
    fi
  fi
fi

# Operator audit logs / runtime diagnostics
copy_into_snapshot "$AUDIT_LOG_PATH" "runtime/treasury-settings-audit.jsonl"
if [[ "$INCLUDE_OPERATOR_LOGS" == "true" ]]; then
  copy_glob_files "$ROOT_DIR/.runtime/operator-stack"/*.log "runtime/operator-stack"
fi

# Redacted env snapshot (exclude secrets/tokens/passwords)
if redact_env_file "$ENV_FILE" "$SNAPSHOT_DIR/config/.env.synthesis.redacted"; then
  record_included "config/.env.synthesis.redacted"
else
  record_missing "config/.env.synthesis.redacted"
fi

# Notes file for restore safety / exclusions
cat > "$SNAPSHOT_DIR/README.txt" <<TXT
Control-plane backup snapshot created by scripts/backup-control-plane-state.sh

Included:
- Automaton state DB + sqlite sidecars (if present)
- Automaton config / heartbeat config
- Treasury Telegram offset file
- Treasury settings audit log
- Redacted .env.synthesis snapshot

Excluded intentionally:
- Wallet material / key files / Vultisig shares
- Full unredacted .env.synthesis
- Arbitrary .automaton contents not listed above
TXT
record_included "README.txt"

tar -czf "$ARTIFACT_PATH" -C "$SNAPSHOT_DIR" .
if [[ ! -s "$ARTIFACT_PATH" ]]; then
  echo '[backup-control-plane] error: backup artifact is empty' >&2
  exit 1
fi

ARTIFACT_SHA256="$(sha256_file "$ARTIFACT_PATH")"
ARTIFACT_SIZE_BYTES="$(wc -c < "$ARTIFACT_PATH" | tr -d ' ')"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - <<'PY' "$MANIFEST_PATH" "$CREATED_AT" "$ARTIFACT_PATH" "$ARTIFACT_SIZE_BYTES" "$ARTIFACT_SHA256" "$INCLUDED_LIST" "$MISSING_LIST" "$AUTOMATON_HOME_DIR" "$ENV_FILE" "$AUDIT_LOG_PATH" "$TELEGRAM_OFFSET_PATH"
import json, os, sys
(
    manifest_path,
    created_at,
    artifact_path,
    artifact_size,
    artifact_sha,
    included_list,
    missing_list,
    automaton_home,
    env_file,
    audit_log,
    telegram_offset,
) = sys.argv[1:]

def read_lines(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return [ln.strip() for ln in f if ln.strip()]
    except FileNotFoundError:
        return []

manifest = {
    'createdAt': created_at,
    'backupType': 'automaton_control_plane_snapshot_v1',
    'artifact': os.path.basename(artifact_path),
    'artifactSizeBytes': int(artifact_size),
    'artifactSha256': artifact_sha,
    'inputs': {
        'automatonHome': automaton_home,
        'envFile': env_file,
        'treasurySettingsAuditLog': audit_log,
        'telegramOffsetFile': telegram_offset,
    },
    'included': read_lines(included_list),
    'missingOptional': read_lines(missing_list),
    'exclusions': [
        'wallet material / key files',
        'Vultisig vault shares',
        'unredacted .env.synthesis',
    ],
}
with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
PY

if [[ "$KEEP_STAGING" != "true" ]]; then
  rm -rf "$SNAPSHOT_DIR"
fi

if [[ -n "$RETENTION_DAYS" && "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  printf '[backup-control-plane] pruning backup run directories older than %s day(s) under %s\n' "$RETENTION_DAYS" "$OUTPUT_ROOT"
  find "$OUTPUT_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +
fi

printf '[backup-control-plane] ok\n'
printf '  artifact: %s\n' "$ARTIFACT_PATH"
printf '  manifest: %s\n' "$MANIFEST_PATH"
printf '  sha256: %s\n' "$ARTIFACT_SHA256"
