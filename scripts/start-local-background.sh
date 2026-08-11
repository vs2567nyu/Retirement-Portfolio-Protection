#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="$project_dir/.local-runtime"
service_root="$HOME/Library/Application Support/RetirementLab"
service_runtime="$service_root/runtime"
service_site="$service_root/site"
service_logs="$service_root/logs"
agent_source_dir="$project_dir/launchd"
agent_install_dir="$HOME/Library/LaunchAgents"
backend_label="com.vishmurda.retirement-lab.backend"
frontend_label="com.vishmurda.retirement-lab.frontend"
launch_domain="gui/$(id -u)"
backend_log="$service_logs/backend.stderr.log"
frontend_log="$service_logs/frontend.stderr.log"
build_log="$runtime_dir/build.log"

mkdir -p "$runtime_dir" "$agent_install_dir" "$service_runtime" "$service_site" "$service_logs"
cd "$project_dir"

fail() {
  printf '\nRetirement Lab could not start: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed."
}

listener_pid() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true
}

job_is_loaded() {
  launchctl print "$launch_domain/$1" >/dev/null 2>&1
}

backend_is_ready() {
  local response
  response="$(curl -fsS --max-time 2 http://127.0.0.1:8000/api/health 2>/dev/null)" || return 1
  [[ "$response" == *'"service"'*'"retirement-simulation"'* ]]
}

frontend_is_ready() {
  local response
  response="$(curl -g -fsS --max-time 3 http://localhost:3000/ 2>/dev/null)" || return 1
  [[ "$response" == *"Retirement Protection Lab"* ]]
}

wait_until_ready() {
  local check_name="$1"
  local attempts="$2"
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if "$check_name"; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

require_command curl
require_command install
require_command launchctl
require_command lsof
require_command node
require_command npm
require_command python3
require_command rsync

backend_listener="$(listener_pid 8000)"
if [[ -n "$backend_listener" ]] && ! job_is_loaded "$backend_label"; then
  fail "a temporary process is already using port 8000. Close its terminal, then open the lab again."
fi

frontend_listener="$(listener_pid 3000)"
if [[ -n "$frontend_listener" ]] && ! job_is_loaded "$frontend_label"; then
  fail "a temporary process is already using port 3000. Close its terminal, then open the lab again."
fi

printf 'Preparing the presentation site…\n'
if [[ ! -x "$project_dir/node_modules/.bin/vinext" ]]; then
  npm install >"$build_log" 2>&1 || {
    tail -n 30 "$build_log" >&2 || true
    fail "the presentation dependencies could not be installed."
  }
fi

: > "$build_log"
WRANGLER_LOG_PATH="$runtime_dir/wrangler.log" \
  "$project_dir/node_modules/.bin/vinext" build --prerender-all >>"$build_log" 2>&1 || {
  tail -n 40 "$build_log" >&2 || true
  fail "the presentation build did not complete."
}

if [[ ! -f "$project_dir/dist/server/prerendered-routes/index.html" ]]; then
  fail "the presentation did not produce its offline start page."
fi

rsync -a --delete --exclude '__pycache__' --exclude '*.pyc' \
  "$project_dir/backend/" "$service_runtime/backend/"
rsync -a --delete "$project_dir/data/" "$service_runtime/data/"
rsync -a --delete "$project_dir/dist/client/" "$service_site/"
install -m 644 "$project_dir/dist/server/prerendered-routes/index.html" "$service_site/index.html"

install -m 644 "$agent_source_dir/$backend_label.plist" "$agent_install_dir/$backend_label.plist"
install -m 644 "$agent_source_dir/$frontend_label.plist" "$agent_install_dir/$frontend_label.plist"

if job_is_loaded "$frontend_label"; then
  launchctl bootout "$launch_domain/$frontend_label" >/dev/null 2>&1 || true
fi
if job_is_loaded "$backend_label"; then
  launchctl bootout "$launch_domain/$backend_label" >/dev/null 2>&1 || true
fi

rm -f "$runtime_dir/backend.pid" "$runtime_dir/frontend.pid"
: > "$service_logs/backend.stdout.log"
: > "$backend_log"
: > "$service_logs/frontend.stdout.log"
: > "$frontend_log"

launchctl bootstrap "$launch_domain" "$agent_install_dir/$backend_label.plist" \
  || fail "the calculation engine service could not be registered."
launchctl bootstrap "$launch_domain" "$agent_install_dir/$frontend_label.plist" || {
  launchctl bootout "$launch_domain/$backend_label" >/dev/null 2>&1 || true
  fail "the presentation service could not be registered."
}

if ! wait_until_ready backend_is_ready 30; then
  tail -n 30 "$backend_log" >&2 || true
  fail "the calculation engine did not become ready."
fi
printf 'Calculation engine is ready and monitored.\n'

if ! wait_until_ready frontend_is_ready 40; then
  tail -n 40 "$frontend_log" >&2 || true
  fail "the presentation site did not become ready."
fi
printf 'Presentation site is ready and monitored.\n'

printf '\nRetirement Lab is available at http://localhost:3000\n'
if command -v open >/dev/null 2>&1; then
  open http://localhost:3000/
fi
