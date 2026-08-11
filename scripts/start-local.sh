#!/usr/bin/env bash
set -euo pipefail

model_pid=""

stop_model() {
  if [[ -n "$model_pid" ]] && kill -0 "$model_pid" 2>/dev/null; then
    kill "$model_pid" 2>/dev/null || true
    wait "$model_pid" 2>/dev/null || true
  fi
}

trap stop_model EXIT INT TERM

python3 -m backend.server --port 8000 &
model_pid=$!

npm run dev
