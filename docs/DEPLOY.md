# Установка на сервер

Сампо ставится на один сервер Ubuntu или Debian. Nginx отдаёт собранный клиент и проксирует `/api` на Node.js, который слушает только `127.0.0.1:3000`. PostgreSQL стоит на той же машине. Миграции применяются при старте процесса.

После пуша в ветку `main` GitHub Actions заходит на сервер по SSH. Сервер сам забирает `origin/main`, собирает клиент и перезапускает службу.

Доступ по SSH — в локальном `docs/server.local.md`. Этого файла нет в git. Файл `server/.env` деплой не перезаписывает.

## Один раз на сервере

Репозиторий: `git@github.com:AtexKayne/sampo.git`.

На чистом сервере от root:

```bash
apt-get update && apt-get install -y git
ssh-keygen -t ed25519 -f /root/.ssh/github_bootstrap -N ""
cat /root/.ssh/github_bootstrap.pub
```

Публичный ключ добавьте в GitHub → Settings → Deploy keys без права записи. Затем:

```bash
GIT_SSH_COMMAND='ssh -i /root/.ssh/github_bootstrap -o IdentitiesOnly=yes' \
  git clone git@github.com:AtexKayne/sampo.git /opt/sampo
bash /opt/sampo/deploy/install.sh \
  --domain sampo.example.com \
  --admin-login admin \
  --admin-password 'длинный-пароль' \
  --email admin@example.com
```

`--email` нужен для HTTPS. Домен уже должен указывать на сервер, иначе сертификат не выпустится и сайт останется на HTTP. Логин — 3–32 символа: строчные латинские буквы, цифры и `_`. Пароль — от 8 до 128 символов. Администратор создаётся только если в базе ещё нет пользователей.

Скрипт ставит Node.js 22, nginx, PostgreSQL, пользователя `sampo`, базу `sampo` и файлы:

- код: `/opt/sampo`
- секреты: `/opt/sampo/server/.env` (в git не входит, повторный запуск его не перезаписывает)
- служба: `systemctl status sampo`
- сайт: `/etc/nginx/sites-available/sampo`

В конце скрипт печатает два ключа.

1. Публичный ключ сервера — второй deploy key в GitHub, тоже без права записи. Им сервер забирает код. Временный `/root/.ssh/github_bootstrap` после этого можно убрать из Deploy keys.
2. Приватный ключ `/root/sampo-actions.key` — секрет GitHub Actions. Его нельзя коммитить.

## Секреты GitHub

В репозитории: Settings → Secrets and variables → Actions.

| Секрет | Значение |
| --- | --- |
| `DEPLOY_HOST` | IP сервера |
| `DEPLOY_USER` | `sampo` |
| `DEPLOY_SSH_KEY` | весь файл `/root/sampo-actions.key`, включая строки BEGIN и END |

После сохранения секрета удалите `/root/sampo-actions.key` с сервера. Если файл уже удалён, а секрет потерян, сотрите в `/home/sampo/.ssh/authorized_keys` строку с пометкой `github-actions` и запустите `install.sh` ещё раз: он выпустит новую пару.

## Что происходит при пуше

Workflow `.github/workflows/deploy.yml` запускается на пуш в `main` и вручную из вкладки Actions. На сервере выполняется `deploy/pull.sh`:

1. `git fetch` и `git reset --hard origin/main`
2. `npm ci` и production-сборка клиента
3. `systemctl restart sampo`
4. проверка `http://127.0.0.1:3000/api/health`

Файл `server/.env` и база при этом не трогаются. Правки, сделанные прямо на сервере в отслеживаемых файлах, затрутся следующим пушем.

Первый пуш, если сервер ещё не установлен или секреты не заданы, завершится ошибкой. После установки откройте Actions и перезапустите Deploy.

## Проверка и логи

```bash
systemctl status sampo
journalctl -u sampo -n 100 --no-pager
curl -fsS http://127.0.0.1:3000/api/health
```

Ручной запуск той же выкладки:

```bash
sudo -u sampo bash /opt/sampo/deploy/pull.sh
```

## Переменные

`APP_ORIGIN` — адрес, который видит браузер, без слэша на конце, например `https://sampo.example.com`. От него зависит проверка живых уведомлений.

`COOKIE_SECURE=1` оставляет куку входа только для HTTPS. Для сайта без сертификата поставьте `0`, иначе браузер не сохранит вход. После включения HTTPS верните `1` и перезапустите службу:

```bash
systemctl restart sampo
```
