#!/usr/bin/env bash

project_dir="$(cd "$(dirname "$0")" && pwd)"
if ! "$project_dir/scripts/start-local-background.sh"; then
  printf '\nPress Return to close this window.\n'
  read -r
  exit 1
fi

printf 'You can close this window; the lab will keep running.\n'
