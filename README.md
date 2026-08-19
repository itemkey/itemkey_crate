# Item Key

3D-style workspace for hierarchical categories and notes.

## Run locally

```bash
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`.

## Run with a public HTTPS link

This project can be shared without a domain through a temporary Cloudflare Quick Tunnel.
Install `cloudflared` once:

```powershell
winget install --id Cloudflare.cloudflared
```

Then start the public production server:

```powershell
npm.cmd run public
```

The command builds the app, creates a `https://*.trycloudflare.com` link, starts
Next.js on `127.0.0.1:3000`, and sets `APP_BASE_URL` to that public link for
auth email/reset links. Keep the terminal open while using the site, and press
`Ctrl+C` to stop it.

Quick Tunnel links are temporary and change on each run. For a stable permanent
address later, use a real domain with a named Cloudflare Tunnel or deploy to a
hosting provider.

For local production testing without a public tunnel:

```powershell
npm.cmd run build
npm.cmd run start:local
```

## Run on a home Docker host

See `DEPLOY.ru.md` for the Docker Compose setup, environment variables, reverse
proxy notes, media output folder, updates, and database backup commands. The
default compose file only connects to `DATABASE_URL`; it does not run schema or
migration SQL automatically.

## Stack

- Next.js App Router
- PostgreSQL (`pg`)
- Custom auth (email + password), SMTP email verification, password reset, server-side sessions

## Environment variables

Required:

- `DB_PROVIDER=postgres`
- `DATABASE_URL=postgresql://user:password@host:5432/item_key`
- `APP_BASE_URL=https://your-domain.example`
- `WORKSPACE_SLUG=main`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

Optional:

- `NEXT_PUBLIC_WORKSPACE_SLUG=main`
- `PG_CONNECTION_TIMEOUT_MS`; `PG_QUERY_TIMEOUT_MS`, `PG_STATEMENT_TIMEOUT_MS`, `PG_LOCK_TIMEOUT_MS` (`0`/unset disables query limits)
- `PG_POOL_MAX` (default `20`), `PG_POOL_MIN` (default `1`), `PG_IDLE_TIMEOUT_MS` (default `45000`), `PG_KEEPALIVE_INITIAL_DELAY_MS` (default `10000`)
- `SESSION_TTL_DAYS` (default `30`)
- `SESSION_HASH_PEPPER` (recommended in production)
- `AUTH_SESSION_MAX_PER_USER` (default `5`)
- `USER_ID_CHANGE_COOLDOWN_DAYS` (default `30`)
- `MIGRATION_CODE_TTL_MINUTES` (default `20`)
- `MIGRATION_CODE_PEPPER` (recommended in production)
- `AUTH_REQUIRE_EMAIL_VERIFICATION` (default `true`)
- `EMAIL_VERIFICATION_TTL_MINUTES` (default `1440`)
- `PASSWORD_RESET_TTL_MINUTES` (default `30`)
- `AUTH_TOKEN_PEPPER` (recommended in production)
- `AUTH_RATE_LIMIT_PEPPER` (recommended in production)
- `AUTH_COOKIE_SECURE` (default `true` in production; set `false` only for private HTTP/LAN testing)
- `SMTP_SECURE` (`true` for SMTPS/465, иначе `false`)

See `.env.example`.

## Schema setup

1. Create PostgreSQL database.
2. If this is a fresh setup, run `postgres/schema.sql`.
3. If you already have production/local data, run the relevant upgrade scripts instead.
4. Before deploying the progressive `/crate` loader, apply `postgres/performance-upgrade.sql`. It is idempotent and does not delete user data.
5. Before deploying the bilingual interface, apply `postgres/account-locale-upgrade.sql`. It is idempotent; existing accounts receive `ru`.
6. Before deploying the private planner, apply `postgres/planner-upgrade.sql`. It is idempotent and keeps all legacy schedule cards intact for the import wizard.

> `postgres/schema.sql` intentionally drops existing tables before recreate.
> This fully resets all user data.
> The default Docker Compose setup does not run this file automatically.

## Auth model

- Registration/login through your own API routes:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/session`
- Additional auth routes:
  - `GET /api/auth/csrf`
  - `POST /api/auth/verify-email`
  - `POST /api/auth/resend-verification`
  - `POST /api/auth/forgot-password`
  - `POST /api/auth/reset-password`
  - `PATCH /api/account/password`
- Session stored in `app_sessions` and sent via httpOnly cookie.
- Session-lifecycle hardening: session cap per user + invalidation on password change/reset.
- Rate limiting for auth endpoints (`auth_rate_events`).
- CSRF protection for mutating API requests via `proxy.ts` + CSRF token.
- Account profile stored in `app_users`.

## Data model

Main tables:

- `app_users`
- `app_sessions`
- `email_verification_tokens`
- `password_reset_tokens`
- `auth_rate_events`
- `migration_codes`
- `workspaces`
- `categories`
- `category_messages`

## Security checks

- Verify no Supabase references: `npm.cmd run check:no-supabase`

## Current features

- Nested categories with navigation and back button
- Add/remove category logic based on selected insertion point
- Category message board with drag-and-drop reordering
- Right settings panel (category settings and message settings)
- Category format options: block / continuous
- Learning category type with message mode: info / exercise
- Search popup across categories and loaded messages
- Account-scoped workspaces
- Unique account `user-id` with 30-day change cooldown
- One-time migration code issuance by `user-id`
- Export/import for category subtree (category + descendants + messages)
