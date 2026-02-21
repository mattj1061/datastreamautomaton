#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.synthesis" ]]; then
  if [[ -f ".env.synthesis.example" ]]; then
    cp ".env.synthesis.example" ".env.synthesis"
  else
    echo ".env.synthesis is missing and no template was found."
    exit 1
  fi
fi

set -a
source .env.synthesis
set +a

exec node dist/index.js --run
