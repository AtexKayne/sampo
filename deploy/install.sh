#!/usr/bin/env bash
# Первичная установка на Ubuntu/Debian. Повторный запуск не затирает server/.env.
set -euo pipefail

APP_DIR=/opt/sampo
APP_USER=sampo
ENV_FILE="$APP_DIR/server/.env"
REPO=git@github.com:AtexKayne/sampo.git

usage() {
  echo "Использование: sudo bash deploy/install.sh --domain example.com --admin-login admin --admin-password 'secret' [--email admin@example.com]" >&2
  exit 1
}

DOMAIN=""
ADMIN_LOGIN=""
ADMIN_PASSWORD=""
CERTBOT_EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --admin-login) ADMIN_LOGIN="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --email) CERTBOT_EMAIL="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$DOMAIN" && -n "$ADMIN_LOGIN" && -n "$ADMIN_PASSWORD" ]] || usage

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите от root: sudo bash deploy/install.sh ..." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$ROOT" != "$APP_DIR" ]]; then
  echo "Клонируйте репозиторий в $APP_DIR и запустите скрипт оттуда." >&2
  echo "Сейчас скрипт лежит в $ROOT" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "В $APP_DIR нет git-репозитория." >&2
  exit 1
fi

if [[ ! "$ADMIN_LOGIN" =~ ^[a-z0-9_]{3,32}$ ]]; then
  echo "Логин: 3–32 символа, строчные латинские буквы, цифры и _" >&2
  exit 1
fi

if [[ "${#ADMIN_PASSWORD}" -lt 8 || "${#ADMIN_PASSWORD}" -gt 128 || "$ADMIN_PASSWORD" == *$'\n'* ]]; then
  echo "Пароль: от 8 до 128 символов, без перевода строки" >&2
  exit 1
fi

if [[ "$DOMAIN" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  IS_IP=1
elif [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]; then
  IS_IP=0
else
  echo "Укажите доменное имя или IPv4-адрес" >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "Нужен Ubuntu или Debian" >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) echo "Нужен Ubuntu или Debian. Сейчас: ${ID:-unknown}" >&2; exit 1 ;;
esac

if [[ ! -x /usr/bin/systemctl ]]; then
  echo "Не найден /usr/bin/systemctl" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx postgresql postgresql-contrib openssl sudo xz-utils

ensure_swap() {
  local mem_kb swap_kb
  mem_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)"
  if [[ "$mem_kb" -ge 1500000 || "$swap_kb" -ge 500000 ]]; then
    return
  fi
  if [[ ! -f /swapfile ]]; then
    if ! fallocate -l 1G /swapfile; then
      dd if=/dev/zero of=/swapfile bs=1M count=1024
    fi
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
  elif ! grep -q '/swapfile' /proc/swaps; then
    swapon /swapfile
  fi
  if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  echo "Добавлен swap 1 ГБ: оперативной памяти мало для сборки клиента."
}

install_node() {
  export PATH="/usr/local/bin:$PATH"
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "Number(process.versions.node.split('.')[0])")"
    if [[ "$major" -ge 22 ]]; then
      echo "Node.js $(node -v) уже установлен"
      return
    fi
  fi

  local node_arch version_url version tmp
  case "$(uname -m)" in
    x86_64) node_arch=x64 ;;
    aarch64|arm64) node_arch=arm64 ;;
    *) echo "Архитектура $(uname -m) не поддерживается" >&2; exit 1 ;;
  esac

  version_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' https://nodejs.org/dist/latest-v22.x/)"
  version="$(basename "${version_url%/}")"
  version="${version#v}"
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Не удалось определить версию Node.js: ${version_url}" >&2
    exit 1
  fi

  echo "Ставлю Node.js ${version}"
  tmp="$(mktemp)"
  curl -fsSL "https://nodejs.org/dist/v${version}/node-v${version}-linux-${node_arch}.tar.xz" -o "$tmp"
  tar -xJf "$tmp" -C /usr/local --strip-components=1
  rm -f "$tmp"
  hash -r
  node -v
}

ensure_swap
install_node

node_bin="$(command -v node)"
if [[ "$node_bin" != "/usr/local/bin/node" ]]; then
  ln -sfn "$node_bin" /usr/local/bin/node
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
fi
if [[ ! -d "/home/$APP_USER" ]]; then
  mkdir -p "/home/$APP_USER"
fi
usermod -s /bin/bash "$APP_USER"
usermod -aG systemd-journal "$APP_USER"
chown "$APP_USER:$APP_USER" "/home/$APP_USER"

if [[ ! -f "$ENV_FILE" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_USER}') THEN
    CREATE ROLE ${APP_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${APP_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL
else
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '${APP_USER}'" | grep -qx 1; then
    echo "Нет роли PostgreSQL ${APP_USER}, а ${ENV_FILE} уже есть. Удалите .env только если базу можно создать заново." >&2
    exit 1
  fi
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'sampo'" | grep -qx 1; then
  sudo -u postgres createdb --owner="$APP_USER" sampo
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 755 "$APP_DIR" "$APP_DIR/client" "$APP_DIR/server"

install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
if [[ ! -f "/home/$APP_USER/.ssh/github_deploy" ]]; then
  runuser -u "$APP_USER" -- ssh-keygen -t ed25519 -f "/home/$APP_USER/.ssh/github_deploy" -N "" -C "sampo-server"
fi

cat > "/home/$APP_USER/.ssh/config" <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/config"
chmod 600 "/home/$APP_USER/.ssh/config"

touch "/home/$APP_USER/.ssh/known_hosts"
if ! grep -q github.com "/home/$APP_USER/.ssh/known_hosts"; then
  ssh-keyscan -t ed25519 github.com >> "/home/$APP_USER/.ssh/known_hosts"
fi
chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/known_hosts"
chmod 600 "/home/$APP_USER/.ssh/known_hosts"

touch "/home/$APP_USER/.ssh/authorized_keys"
if ! grep -q "github-actions" "/home/$APP_USER/.ssh/authorized_keys"; then
  tmp="$(mktemp -d)"
  ssh-keygen -t ed25519 -f "$tmp/actions" -N "" -C "github-actions"
  cat "$tmp/actions.pub" >> "/home/$APP_USER/.ssh/authorized_keys"
  install -m 600 "$tmp/actions" /root/sampo-actions.key
  rm -rf "$tmp"
  NEW_ACTIONS_KEY=1
else
  NEW_ACTIONS_KEY=0
fi
chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/authorized_keys"
chmod 600 "/home/$APP_USER/.ssh/authorized_keys"

runuser -u "$APP_USER" -- git -C "$APP_DIR" remote set-url origin "$REPO" || runuser -u "$APP_USER" -- git -C "$APP_DIR" remote add origin "$REPO"

cat > /etc/sudoers.d/sampo <<'EOF'
sampo ALL=(root) NOPASSWD: /usr/bin/systemctl restart sampo
EOF
chmod 440 /etc/sudoers.d/sampo
visudo -cf /etc/sudoers.d/sampo >/dev/null

sed "s/__DOMAIN__/${DOMAIN}/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/sampo
ln -sfn /etc/nginx/sites-available/sampo /etc/nginx/sites-enabled/sampo
rm -f /etc/nginx/sites-enabled/default
cp "$APP_DIR/deploy/nginx-map.conf" /etc/nginx/conf.d/sampo-upgrade.conf
nginx -t
systemctl enable nginx
systemctl restart nginx

SCHEME=http
if [[ "$IS_IP" -eq 0 && ( -n "$CERTBOT_EMAIL" || -d "/etc/letsencrypt/live/$DOMAIN" ) ]]; then
  apt-get install -y certbot python3-certbot-nginx
  if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
    if certbot --nginx -d "$DOMAIN" --non-interactive --redirect; then
      SCHEME=https
    else
      echo "Не удалось обновить сертификат ${DOMAIN}." >&2
    fi
  elif certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect; then
    SCHEME=https
  else
    echo "Certbot не выпустил сертификат. Сайт останется на HTTP, пока DNS домена не указывает на этот сервер." >&2
  fi
fi
if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  SCHEME=https
fi

dotenv_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

if [[ ! -f "$ENV_FILE" ]]; then
  JWT="$(openssl rand -base64 48 | tr -d '\n')"
  COOKIE_SECURE=0
  [[ "$SCHEME" == "https" ]] && COOKIE_SECURE=1
  VAPID_SUBJECT="mailto:${CERTBOT_EMAIL:-admin@${DOMAIN}}"
  (
    umask 077
    {
      printf 'DATABASE_URL=%s\n' "$(dotenv_quote "postgresql://sampo:${DB_PASSWORD}@127.0.0.1:5432/sampo")"
      printf 'APP_ORIGIN=%s\n' "$(dotenv_quote "${SCHEME}://${DOMAIN}")"
      printf 'API_PORT=%s\n' '"3000"'
      printf 'JWT_ACCESS_SECRET=%s\n' "$(dotenv_quote "$JWT")"
      printf 'SEED_ADMIN_LOGIN=%s\n' "$(dotenv_quote "$ADMIN_LOGIN")"
      printf 'SEED_ADMIN_PASSWORD=%s\n' "$(dotenv_quote "$ADMIN_PASSWORD")"
      printf 'COOKIE_SECURE=%s\n' "\"${COOKIE_SECURE}\""
      printf 'VK_CLIENT_ID=""\n'
      printf 'VK_CLIENT_SECRET=""\n'
      printf 'VK_REDIRECT_URI=""\n'
      printf 'VK_COMMUNITY_TOKEN=""\n'
      printf 'VK_COMMUNITY_ID=""\n'
      printf 'VK_CALLBACK_SECRET=""\n'
      printf 'VK_CALLBACK_CONFIRMATION=""\n'
      printf 'VAPID_PUBLIC_KEY=""\n'
      printf 'VAPID_PRIVATE_KEY=""\n'
      printf 'VAPID_SUBJECT=%s\n' "$(dotenv_quote "$VAPID_SUBJECT")"
    } > "$ENV_FILE"
  )
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "Файл ${ENV_FILE} уже есть, секреты не перезаписываю."
fi

cp "$APP_DIR/deploy/sampo.service" /etc/systemd/system/sampo.service
systemctl daemon-reload
systemctl enable sampo

runuser -u "$APP_USER" -- bash "$APP_DIR/deploy/update.sh"

export GIT_TERMINAL_PROMPT=0
public_ip="$(curl -4 -fsS --max-time 5 https://api.ipify.org || true)"

echo
echo "Сампо запущено: ${SCHEME}://${DOMAIN}"
echo "Первый администратор создаётся при пустой базе: ${ADMIN_LOGIN}"
echo
echo "1. GitHub → Settings → Deploy keys → Add. Write access не нужен."
echo "   Ключ сервера:"
cat "/home/$APP_USER/.ssh/github_deploy.pub"
echo
if [[ "$NEW_ACTIONS_KEY" -eq 1 ]]; then
  echo "2. GitHub → Settings → Secrets and variables → Actions:"
  echo "   DEPLOY_HOST = ${public_ip:-адрес этого сервера}"
  echo "   DEPLOY_USER = sampo"
  echo "   DEPLOY_SSH_KEY = содержимое файла /root/sampo-actions.key"
  echo "   После копирования ключа удалите /root/sampo-actions.key"
else
  echo "2. Ключ GitHub Actions уже лежит в authorized_keys. Секреты DEPLOY_HOST, DEPLOY_USER и DEPLOY_SSH_KEY менять не нужно."
fi
echo
echo "3. Пуш в ветку main запускает .github/workflows/deploy.yml: сервер делает git fetch и пересобирает приложение."
if runuser -u "$APP_USER" -- git ls-remote "$REPO" HEAD >/dev/null 2>&1; then
  echo "Доступ сервера к GitHub уже есть."
else
  echo "Сервер пока не может забирать репозиторий: добавьте deploy key из шага 1."
fi
if [[ "$SCHEME" != "https" ]]; then
  echo "Сайт открыт по HTTP. Для боевого адреса нужен домен и --email, затем в server/.env: APP_ORIGIN=https://домен и COOKIE_SECURE=1."
fi
