#!/usr/bin/env bash

project_dir="$(cd "$(dirname "$0")" && pwd)"
"$project_dir/scripts/stop-local-background.sh"
printf '\nRetirement Lab has been stopped.\n'
