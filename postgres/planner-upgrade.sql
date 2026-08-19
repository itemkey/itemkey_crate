begin;

create extension if not exists pgcrypto;

create table if not exists public.planner_profiles (
  app_user_id uuid primary key references public.app_users(id) on delete cascade,
  timezone text not null default 'Europe/Minsk',
  horizon text not null default 'week' check (horizon in ('week', 'two_weeks', 'month')),
  reserve_ratio numeric(4,3) not null default 0.200 check (reserve_ratio between 0 and 0.600),
  default_buffer_minutes integer not null default 15 check (default_buffer_minutes between 0 and 120),
  availability jsonb not null default '{}'::jsonb,
  energy_windows jsonb not null default '[]'::jsonb,
  sleep_schedule jsonb not null default '{"mode":"fixed","weekdays":{"bedtime":"23:00","durationMinutes":480},"weekends":{"bedtime":"23:00","durationMinutes":480}}'::jsonb,
  assistant_setup_version integer not null default 0,
  revision bigint not null default 0,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.planner_profiles
  add column if not exists sleep_schedule jsonb not null
    default '{"mode":"fixed","weekdays":{"bedtime":"23:00","durationMinutes":480},"weekends":{"bedtime":"23:00","durationMinutes":480}}'::jsonb,
  add column if not exists assistant_setup_version integer not null default 0;

alter table public.planner_profiles alter column sleep_schedule set default
  '{"mode":"fixed","weekdays":{"bedtime":"23:00","durationMinutes":480},"weekends":{"bedtime":"23:00","durationMinutes":480}}'::jsonb;

create table if not exists public.planner_items (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  id text not null check (char_length(trim(id)) between 1 and 160),
  kind text not null check (kind in ('fixed_event', 'flexible_task', 'routine')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  notes text not null default '', area text not null default '', location text not null default '',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  energy text not null default 'normal' check (energy in ('low', 'normal', 'high')),
  estimate_minutes integer not null default 60 check (estimate_minutes between 5 and 1440),
  earliest_at timestamptz null, deadline_at timestamptz null,
  preferred_windows jsonb not null default '[]'::jsonb,
  avoided_windows jsonb not null default '[]'::jsonb,
  can_split boolean not null default false,
  min_chunk_minutes integer not null default 25 check (min_chunk_minutes between 5 and 1440),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 240),
  recurrence jsonb null, auto_plan boolean not null default true,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  unplaced_reason text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (app_user_id, id)
);

alter table public.planner_items
  add column if not exists unplaced_reason text not null default '';

create index if not exists planner_items_user_status_priority_idx
  on public.planner_items(app_user_id, status, priority, deadline_at, created_at);

create table if not exists public.planner_blocks (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  id text not null check (char_length(trim(id)) between 1 and 160),
  item_id text null, title text not null check (char_length(trim(title)) between 1 and 160),
  start_at timestamptz not null, end_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'skipped', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'auto', 'migrated')),
  fixed boolean not null default false, occurrence_key text null,
  actual_start_at timestamptz null, actual_end_at timestamptz null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (app_user_id, id),
  constraint planner_blocks_time_check check (end_at > start_at),
  constraint planner_blocks_item_fk foreign key (app_user_id, item_id)
    references public.planner_items(app_user_id, id) on delete cascade
);

alter table public.planner_blocks drop constraint if exists planner_blocks_item_fk;
alter table public.planner_blocks add constraint planner_blocks_item_fk
  foreign key (app_user_id, item_id)
  references public.planner_items(app_user_id, id) on delete cascade;

create index if not exists planner_blocks_user_range_idx
  on public.planner_blocks(app_user_id, start_at, end_at)
  include (status, fixed, item_id, occurrence_key);
drop index if exists public.planner_blocks_occurrence_unique_idx;
create index if not exists planner_blocks_occurrence_idx
  on public.planner_blocks(app_user_id, item_id, occurrence_key)
  where item_id is not null and occurrence_key is not null and status <> 'cancelled';

create table if not exists public.planner_proposals (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  base_revision bigint not null, proposal_data jsonb not null,
  expires_at timestamptz not null, applied_at timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists planner_proposals_user_expiry_idx
  on public.planner_proposals(app_user_id, expires_at desc);

create table if not exists public.planner_change_sets (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  from_revision bigint not null, to_revision bigint not null, trigger text not null,
  changes jsonb not null, inverse_snapshot jsonb not null,
  undone_at timestamptz null, created_at timestamptz not null default now()
);
create index if not exists planner_change_sets_user_created_idx
  on public.planner_change_sets(app_user_id, created_at desc);

create table if not exists public.planner_legacy_imports (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  source_key text not null, source_title text not null default '',
  imported_item_ids jsonb not null default '[]'::jsonb,
  imported_block_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (app_user_id, source_key)
);

create table if not exists public.planner_sleep_events (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  wake_date date not null,
  event_kind text not null default 'sleep_change' check (event_kind in ('sleep_change', 'check_in')),
  state text not null default 'confirmed' check (state in ('tentative', 'confirmed', 'completed')),
  actual_start_at timestamptz null,
  projected_end_at timestamptz null,
  actual_end_at timestamptz null,
  estimated_start_from_at timestamptz null,
  estimated_start_to_at timestamptz null,
  restedness text null check (restedness is null or restedness in ('not_rested', 'okay', 'well_rested')),
  recovery_night boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_user_id, wake_date),
  constraint planner_sleep_events_time_check check (
    (projected_end_at is null or (actual_start_at is not null and projected_end_at > actual_start_at))
    and (actual_end_at is null or (actual_start_at is not null and actual_end_at > actual_start_at))
    and ((estimated_start_from_at is null and estimated_start_to_at is null)
      or (estimated_start_from_at is not null and estimated_start_to_at is not null
        and estimated_start_to_at >= estimated_start_from_at))
  )
);

alter table public.planner_sleep_events
  add column if not exists event_kind text not null default 'sleep_change',
  add column if not exists state text not null default 'confirmed',
  add column if not exists estimated_start_from_at timestamptz null,
  add column if not exists estimated_start_to_at timestamptz null,
  add column if not exists restedness text null,
  add column if not exists recovery_night boolean not null default false;

alter table public.planner_sleep_events alter column actual_start_at drop not null;
alter table public.planner_sleep_events alter column projected_end_at drop not null;
alter table public.planner_sleep_events drop constraint if exists planner_sleep_events_time_check;
alter table public.planner_sleep_events add constraint planner_sleep_events_time_check check (
  (projected_end_at is null or (actual_start_at is not null and projected_end_at > actual_start_at))
  and (actual_end_at is null or (actual_start_at is not null and actual_end_at > actual_start_at))
  and ((estimated_start_from_at is null and estimated_start_to_at is null)
    or (estimated_start_from_at is not null and estimated_start_to_at is not null
      and estimated_start_to_at >= estimated_start_from_at))
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'planner_sleep_events_event_kind_check') then
    alter table public.planner_sleep_events add constraint planner_sleep_events_event_kind_check
      check (event_kind in ('sleep_change', 'check_in'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'planner_sleep_events_state_check') then
    alter table public.planner_sleep_events add constraint planner_sleep_events_state_check
      check (state in ('tentative', 'confirmed', 'completed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'planner_sleep_events_restedness_check') then
    alter table public.planner_sleep_events add constraint planner_sleep_events_restedness_check
      check (restedness is null or restedness in ('not_rested', 'okay', 'well_rested'));
  end if;
end
$$;
create index if not exists planner_sleep_events_user_range_idx
  on public.planner_sleep_events(app_user_id, wake_date desc);

alter table if exists public.auth_rate_events drop constraint if exists auth_rate_events_action_check;
alter table if exists public.auth_rate_events add constraint auth_rate_events_action_check
  check (action in (
    'login','register','forgot_password','reset_password','verify_email',
    'resend_verification','change_password','planner_reset'
  ));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_planner_profiles_updated_at') then
    create trigger trg_planner_profiles_updated_at before update on public.planner_profiles
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_planner_items_updated_at') then
    create trigger trg_planner_items_updated_at before update on public.planner_items
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_planner_blocks_updated_at') then
    create trigger trg_planner_blocks_updated_at before update on public.planner_blocks
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_planner_sleep_events_updated_at') then
    create trigger trg_planner_sleep_events_updated_at before update on public.planner_sleep_events
      for each row execute function public.set_updated_at();
  end if;
end
$$;

commit;
