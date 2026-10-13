#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -un)" != "sampo" ]]; then
  echo "Запускайте от пользователя sampo" >&2
  exit 1
fi

cd /opt/sampo
exec 9>/tmp/sampo-deploy.lock
if ! flock -n 9; then
  echo "Деплой уже выполняется" >&2
  exit 1
fi

export GIT_TERMINAL_PROMPT=0
exec bash -c '
  set -euo pipefail
  cd /opt/sampo
  export GIT_TERMINAL_PROMPT=0
  git fetch origin main
  git reset --hard origin/main
  bash deploy/update.sh
'
