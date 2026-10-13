#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -un)" != "sampo" ]]; then
  echo "Запускайте от пользователя sampo" >&2
  exit 1
fi

cd /opt/sampo
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"
npm ci --include=dev
npm run build
chmod -R a+rX client/dist
sudo /usr/bin/systemctl restart sampo

for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    echo "Готово: $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "Сервис не ответил на /api/health" >&2
journalctl -u sampo -n 80 --no-pager >&2 || true
exit 1
