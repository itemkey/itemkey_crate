create extension if not exists pgcrypto;

alter table if exists public.app_users
  add column if not exists email_verified_at timestamptz null;

update public.app_users
set email_verified_at = coalesce(email_verified_at, now())
where email is not null;

create table if not exists public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists email_verification_tokens_hash_unique_idx
  on public.email_verification_tokens(token_hash);

create index if not exists email_verification_tokens_lookup_idx
  on public.email_verification_tokens(app_user_id, consumed_at, expires_at, created_at desc);

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists password_reset_tokens_hash_unique_idx
  on public.password_reset_tokens(token_hash);

create index if not exists password_reset_tokens_lookup_idx
  on public.password_reset_tokens(app_user_id, consumed_at, expires_at, created_at desc);

create table if not exists public.auth_rate_events (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  ip_hash text not null,
  email_hash text null,
  was_success boolean not null,
  created_at timestamptz not null default now(),
  constraint auth_rate_events_action_check
    check (
      action in (
        'login',
        'register',
        'forgot_password',
        'reset_password',
        'verify_email',
        'resend_verification',
        'change_password'
      )
    )
);

create index if not exists auth_rate_events_ip_idx
  on public.auth_rate_events(action, ip_hash, created_at desc);

create index if not exists auth_rate_events_email_idx
  on public.auth_rate_events(action, email_hash, created_at desc)
  where email_hash is not null;
