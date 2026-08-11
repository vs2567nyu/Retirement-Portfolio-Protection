#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agent_install_dir="$HOME/Library/LaunchAgents"
backend_label="com.vishmurda.retirement-lab.backend"
frontend_label="com.vishmurda.retirement-lab.frontend"
launch_domain="gui/$(id -u)"

stop_service() {
  local label="$1"
  local description="$2"
  if launchctl print "$launch_domain/$label" >/dev/null 2>&1; then
    launchctl bootout "$launch_domain/$label"
    printf '%s stopped.\n' "$description"
  else
    printf '%s was already stopped.\n' "$description"
  fi
  rm -f "$agent_install_dir/$label.plist"
}

stop_service "$frontend_label" "Presentation site"
stop_service "$backend_label" "Calculation engine"
rm -f "$project_dir/.local-runtime/backend.pid" "$project_dir/.local-runtime/frontend.pid"
