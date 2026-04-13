create extension if not exists pgcrypto;

drop table if exists public.auth_rate_events cascade;
drop table if exists public.password_reset_tokens cascade;
drop table if exists public.email_verification_tokens cascade;
drop table if exists public.app_sessions cascade;
drop table if exists public.projects cascade;
drop table if exists public.category_messages cascade;
drop table if exists public.categories cascade;
drop table if exists public.workspaces cascade;
drop table if exists public.migration_codes cascade;
drop table if exists public.auth_identities cascade;
drop table if exists public.app_users cascade;

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_verified_at timestamptz null,
  password_hash text not null,
  user_id text null,
  user_id_changed_at timestamptz null,
  nickname text not null default '',
  profile_description text not null default '',
  avatar_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_email_lower_check check (email = lower(email)),
  constraint app_users_user_id_lower_check
    check (user_id is null or user_id = lower(user_id)),
  constraint app_users_user_id_format_check
    check (
      user_id is null
      or user_id ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$'
    )
);

create unique index app_users_email_unique_idx
  on public.app_users(email);

create unique index app_users_user_id_unique_idx
  on public.app_users(user_id)
  where user_id is not null;

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index app_sessions_token_hash_unique_idx
  on public.app_sessions(token_hash);

create index app_sessions_user_idx
  on public.app_sessions(app_user_id, expires_at);

create table public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index email_verification_tokens_hash_unique_idx
  on public.email_verification_tokens(token_hash);

create index email_verification_tokens_lookup_idx
  on public.email_verification_tokens(app_user_id, consumed_at, expires_at, created_at desc);

create table public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index password_reset_tokens_hash_unique_idx
  on public.password_reset_tokens(token_hash);

create index password_reset_tokens_lookup_idx
  on public.password_reset_tokens(app_user_id, consumed_at, expires_at, created_at desc);

create table public.auth_rate_events (
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

create index auth_rate_events_ip_idx
  on public.auth_rate_events(action, ip_hash, created_at desc);

create index auth_rate_events_email_idx
  on public.auth_rate_events(action, email_hash, created_at desc)
  where email_hash is not null;

create table public.migration_codes (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  code_hash text not null,
  code_hint text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  constraint migration_codes_attempts_check check (attempts >= 0)
);

create index migration_codes_app_user_created_idx
  on public.migration_codes(app_user_id, created_at desc);

create index migration_codes_lookup_idx
  on public.migration_codes(app_user_id, consumed_at, expires_at);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.app_users(id) on delete cascade,
  slug text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, slug)
);

create index workspaces_owner_idx
  on public.workspaces(owner_user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  tag_filter text not null default '',
  container_category_ids text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create index projects_workspace_position_idx
  on public.projects(workspace_id, position, created_at);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid null,
  title text not null check (char_length(trim(title)) > 0),
  content text not null default '',
  description text not null default '',
  tag text not null default '',
  format text not null default 'continuous' check (format in ('block', 'continuous')),
  category_type text not null default 'learning' check (category_type in ('learning')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint categories_workspace_parent_fk
    foreign key (workspace_id, parent_id)
    references public.categories(workspace_id, id)
    on delete cascade,
  constraint categories_not_self_parent check (id is distinct from parent_id)
);

create index categories_workspace_parent_position_idx
  on public.categories(workspace_id, parent_id, position, created_at);

create table public.category_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category_id uuid not null,
  title text not null default 'Новый блок',
  content text not null default '',
  position integer not null default 0,
  message_type text not null default 'info' check (message_type in ('info', 'exercise')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint messages_workspace_category_fk
    foreign key (workspace_id, category_id)
    references public.categories(workspace_id, id)
    on delete cascade
);

create index category_messages_workspace_category_position_idx
  on public.category_messages(workspace_id, category_id, position, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

create trigger trg_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create trigger trg_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create trigger trg_category_messages_updated_at
before update on public.category_messages
for each row execute function public.set_updated_at();
