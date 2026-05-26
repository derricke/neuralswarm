#!/usr/bin/env bash

set -euo pipefail

child_pid=""

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM HUP

  if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
    echo "Stopping dev process tree for PID $child_pid"
    kill -TERM "-$child_pid" 2>/dev/null || kill -TERM "$child_pid" 2>/dev/null || true
    sleep 1
    kill -KILL "-$child_pid" 2>/dev/null || kill -KILL "$child_pid" 2>/dev/null || true
  fi

  exit "$exit_code"
}

trap cleanup EXIT INT TERM HUP

# Start in a dedicated process group so cleanup can terminate all descendants
setsid nodemon --watch src --ext ts --exec ts-node src/index.ts &
child_pid=$!
wait "$child_pid"
