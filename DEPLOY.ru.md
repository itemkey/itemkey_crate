# Домашний Docker-хостинг

Этот проект запускается как Next.js server + PostgreSQL. Статический хостинг не подойдет, потому что в приложении есть API routes, auth, Postgres, SSE и медиа-роуты.

## Что подготовлено

- `Dockerfile` собирает production standalone-образ Next.js.
- `docker-compose.yml` поднимает только приложение и подключается к базе из `DATABASE_URL`.
- `docker-compose.local-db.yml` опционально добавляет отдельный PostgreSQL-контейнер.
- `docker-compose.fresh-db.yml` опционально подключает `postgres/schema.sql` только для новой пустой базы.
- `deploy.env.example` содержит все переменные для домашнего сервера.
- В образ добавлены `ffmpeg`, `ffprobe` и `yt-dlp` для media converter / YouTube downloader.
- По умолчанию никакие schema/migration SQL-скрипты не запускаются.

## Первый запуск

На сервере в папке проекта:

```bash
cp deploy.env.example .env
```

Заполни `.env`:

- `APP_BASE_URL` - публичный адрес сайта, например `https://itemkey.example.com`.
- `DATABASE_URL` - строка подключения к уже существующей базе. Это главный безопасный режим: compose не запускает `schema.sql`, не дропает таблицы и не меняет схему.
- `SESSION_HASH_PEPPER`, `MIGRATION_CODE_PEPPER`, `AUTH_TOKEN_PEPPER`, `AUTH_RATE_LIMIT_PEPPER` - случайные секреты.
- `SMTP_*` - SMTP от почты, иначе регистрация/верификация/сброс пароля не смогут отправлять письма.

Секреты удобно генерировать так:

```bash
openssl rand -base64 32
```

Если `openssl` нет:

```bash
docker run --rm node:22-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Запуск:

```bash
docker compose up -d --build
docker compose ps
```

Эта команда не поднимает новый Postgres и не запускает SQL-скрипты. Она только запускает приложение, которое подключается к `DATABASE_URL`.

Перед первым деплоем версии с ускоренной загрузкой `/crate` примени к существующей базе идемпотентную миграцию `postgres/performance-upgrade.sql`. Например:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres/performance-upgrade.sql
```

Перед деплоем версии с переключателем RU/EN обязательно примени миграцию языка аккаунта:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres/account-locale-upgrade.sql
```

Она идемпотентна и присваивает существующим аккаунтам русский язык. Запускай её до обновления контейнера приложения.

Сначала миграция, затем новый контейнер приложения. PostgreSQL и приложение должны находиться в одном регионе/локальной сети: межрегиональная задержка напрямую ухудшает серверную загрузку рабочего дерева.

Логи:

```bash
docker compose logs -f app
docker compose logs -f db
```

## Reverse proxy

Лучше не выпускать Next.js напрямую в интернет. Поставь перед ним Caddy, Nginx, Traefik или тот reverse proxy, который уже обслуживает твои боты/сервисы.

Пример Caddy:

```caddyfile
itemkey.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Пример Nginx:

```nginx
server {
  server_name itemkey.example.com;

  client_max_body_size 520m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
  }
}
```

Включи HTTP/2 на HTTPS-listener и Brotli или gzip для `text/html`, `text/css`, JavaScript, JSON и RSC-ответов. Не включай публичное кэширование `/crate` и пользовательских `/api/*`: приложение отправляет для них `private, no-store`. Заголовок `X-Accel-Buffering: no` и `proxy_buffering off` нужны, чтобы Suspense-поток доходил до браузера сразу.

Для публичного домена оставь `AUTH_COOKIE_SECURE=true`. Если проверяешь только по `http://IP:3000` внутри локальной сети, временно поставь `AUTH_COOKIE_SECURE=false`, иначе production cookies не будут отправляться браузером по HTTP.

## Если нужен новый Postgres в Docker

Если базы еще нет и ты хочешь поднять Postgres рядом с приложением, сначала выставь в `.env`:

```env
DATABASE_URL=postgresql://itemkey:change-me-postgres-password@db:5432/item_key
POSTGRES_DB=item_key
POSTGRES_USER=itemkey
POSTGRES_PASSWORD=change-me-postgres-password
```

Для локального Postgres-контейнера без автоматической схемы:

```bash
docker compose -f docker-compose.yml -f docker-compose.local-db.yml up -d --build
```

Для абсолютно новой пустой базы, когда данных точно нет, можно один раз добавить init-файл:

```bash
docker compose -f docker-compose.yml -f docker-compose.local-db.yml -f docker-compose.fresh-db.yml up -d --build
```

Не используй `docker-compose.fresh-db.yml` для базы, где уже есть данные. `postgres/schema.sql` содержит `drop table`.

## Медиа-папка

В контейнере доступна папка:

```text
/data/media
```

В Linux-контейнере кнопка выбора папки через PowerShell не работает, поэтому в media converter / YouTube downloader указывай `/data/media` вручную.

По умолчанию это named volume `media_data`. Если хочешь видеть файлы прямо рядом с проектом на сервере, замени volume в `docker-compose.yml`:

```yaml
    volumes:
      - ./data/media:/data/media
```

И выдай права пользователю контейнера:

```bash
mkdir -p data/media
sudo chown -R 1001:1001 data/media
```

## Обновление

После `git pull` или загрузки новых файлов:

```bash
docker compose up -d --build
```

Если менял `NEXT_PUBLIC_WORKSPACE_SLUG`, обязательно пересобери образ, потому что `NEXT_PUBLIC_*` встраивается во фронтенд во время `next build`.

## Бэкап базы

Если используешь уже существующую внешнюю базу, делай бэкап её штатным способом. Если на машине есть `pg_dump`, можно так:

```bash
pg_dump "$DATABASE_URL" > itemkey-backup.sql
```

Если используешь локальный Docker Postgres из `docker-compose.local-db.yml`, создать дамп можно так:

```bash
docker compose -f docker-compose.yml -f docker-compose.local-db.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > itemkey-backup.sql
```

Восстановить в пустую базу:

```bash
docker compose -f docker-compose.yml -f docker-compose.local-db.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < itemkey-backup.sql
```

## Важное про схему

`postgres/schema.sql` дропает и пересоздает таблицы. Обычный `docker compose up -d --build` его не использует. Для уже существующей базы не запускай `schema.sql` вручную без бэкапа; если когда-нибудь понадобится изменение схемы, сначала делай дамп и применяй только конкретные upgrade-скрипты из папки `postgres/`.
