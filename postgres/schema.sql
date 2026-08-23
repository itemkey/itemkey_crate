create extension if not exists pgcrypto;

drop table if exists public.auth_rate_events cascade;
drop table if exists public.planner_legacy_imports cascade;
drop table if exists public.planner_sleep_events cascade;
drop table if exists public.planner_change_sets cascade;
drop table if exists public.planner_proposals cascade;
drop table if exists public.planner_blocks cascade;
drop table if exists public.planner_items cascade;
drop table if exists public.planner_profiles cascade;
drop table if exists public.password_reset_tokens cascade;
drop table if exists public.email_verification_tokens cascade;
drop table if exists public.app_sessions cascade;
drop table if exists public.inbox_items cascade;
drop table if exists public.public_category_members cascade;
drop table if exists public.public_category_roots cascade;
drop table if exists public.friendships cascade;
drop table if exists public.projects cascade;
drop table if exists public.dictionary_study_progress cascade;
drop table if exists public.dictionary_word_group_items cascade;
drop table if exists public.dictionary_word_groups cascade;
drop table if exists public.category_messages cascade;
drop table if exists public.categories cascade;
drop table if exists public.workspaces cascade;
drop table if exists public.migration_codes cascade;
drop table if exists public.account_images cascade;
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
  locale text not null default 'ru',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_email_lower_check check (email = lower(email)),
  constraint app_users_user_id_lower_check
    check (user_id is null or user_id = lower(user_id)),
  constraint app_users_user_id_format_check
    check (
      user_id is null
      or user_id ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$'
    ),
  constraint app_users_locale_check check (locale in ('ru', 'en'))
);

create unique index app_users_email_unique_idx
  on public.app_users(email);

create unique index app_users_user_id_unique_idx
  on public.app_users(user_id)
  where user_id is not null;

create table public.account_images (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  kind text not null,
  mime_type text not null,
  size_bytes integer not null,
  image_data bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_images_kind_check
    check (kind in ('avatar', 'motivation')),
  constraint account_images_mime_type_check
    check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp')),
  constraint account_images_size_check
    check (size_bytes > 0 and size_bytes <= 5242880)
);

create index account_images_user_kind_idx
  on public.account_images(app_user_id, kind, created_at desc);

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
        'change_password',
        'planner_reset'
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

create index categories_workspace_summary_order_idx
  on public.categories(workspace_id, position, created_at, id)
  include (parent_id, title, description, tag, format, category_type, updated_at);

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

create table public.dictionary_word_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create index dictionary_word_groups_workspace_position_idx
  on public.dictionary_word_groups(workspace_id, position, created_at);

create table public.dictionary_word_group_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  group_id uuid not null,
  source_category_id uuid not null,
  source_message_id uuid null,
  dictionary_id text null,
  entry_id text not null check (char_length(trim(entry_id)) > 0),
  entry_snapshot jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dictionary_word_group_items_group_fk
    foreign key (workspace_id, group_id)
    references public.dictionary_word_groups(workspace_id, id)
    on delete cascade,
  constraint dictionary_word_group_items_category_fk
    foreign key (workspace_id, source_category_id)
    references public.categories(workspace_id, id)
    on delete cascade,
  constraint dictionary_word_group_items_message_fk
    foreign key (workspace_id, source_message_id)
    references public.category_messages(workspace_id, id)
    on delete cascade,
  constraint dictionary_word_group_items_source_check check (
    (source_message_id is not null and dictionary_id is null)
    or (source_message_id is null and dictionary_id is not null)
  )
);

create unique index dictionary_word_group_items_block_unique_idx
  on public.dictionary_word_group_items(group_id, source_category_id, source_message_id, entry_id)
  where source_message_id is not null and dictionary_id is null;

create unique index dictionary_word_group_items_continuous_unique_idx
  on public.dictionary_word_group_items(group_id, source_category_id, dictionary_id, entry_id)
  where source_message_id is null and dictionary_id is not null;

create index dictionary_word_group_items_group_position_idx
  on public.dictionary_word_group_items(workspace_id, group_id, position, created_at);

create index dictionary_word_group_items_lookup_idx
  on public.dictionary_word_group_items(workspace_id, source_category_id, source_message_id, dictionary_id, entry_id);

create table public.dictionary_study_progress (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_category_id uuid not null,
  source_message_id uuid null,
  dictionary_id text null,
  progress_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dictionary_study_progress_category_fk
    foreign key (workspace_id, source_category_id)
    references public.categories(workspace_id, id)
    on delete cascade,
  constraint dictionary_study_progress_message_fk
    foreign key (workspace_id, source_message_id)
    references public.category_messages(workspace_id, id)
    on delete cascade,
  constraint dictionary_study_progress_source_check check (
    (source_message_id is not null and dictionary_id is null)
    or (source_message_id is null and dictionary_id is not null)
  )
);

create unique index dictionary_study_progress_block_unique_idx
  on public.dictionary_study_progress(app_user_id, workspace_id, source_category_id, source_message_id)
  where source_message_id is not null and dictionary_id is null;

create unique index dictionary_study_progress_continuous_unique_idx
  on public.dictionary_study_progress(app_user_id, workspace_id, source_category_id, dictionary_id)
  where source_message_id is null and dictionary_id is not null;

create index dictionary_study_progress_user_updated_idx
  on public.dictionary_study_progress(app_user_id, updated_at desc);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.app_users(id) on delete cascade,
  addressee_user_id uuid not null references public.app_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_not_self_check check (requester_user_id <> addressee_user_id)
);

create unique index friendships_pair_unique_idx
  on public.friendships (
    least(requester_user_id, addressee_user_id),
    greatest(requester_user_id, addressee_user_id)
  );

create index friendships_requester_idx
  on public.friendships(requester_user_id, status, created_at desc);

create index friendships_addressee_idx
  on public.friendships(addressee_user_id, status, created_at desc);

create table public.public_category_roots (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.app_users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  root_category_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, root_category_id),
  constraint public_category_roots_category_fk
    foreign key (workspace_id, root_category_id)
    references public.categories(workspace_id, id)
    on delete cascade
);

create index public_category_roots_owner_idx
  on public.public_category_roots(owner_user_id, created_at desc);

create table public.public_category_members (
  id uuid primary key default gen_random_uuid(),
  public_root_id uuid not null references public.public_category_roots(id) on delete cascade,
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  mount_parent_category_id uuid null references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (public_root_id, app_user_id)
);

create index public_category_members_user_idx
  on public.public_category_members(app_user_id, role, created_at desc);

create index public_category_members_mount_parent_idx
  on public.public_category_members(mount_parent_category_id);

create index public_category_members_user_root_idx
  on public.public_category_members(app_user_id, public_root_id)
  include (role, mount_parent_category_id, updated_at);

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references public.app_users(id) on delete cascade,
  recipient_user_id uuid not null references public.app_users(id) on delete cascade,
  type text not null check (type in ('category_share', 'public_invite')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  title text not null,
  message text not null default '',
  category_snapshot jsonb null,
  public_root_id uuid null references public.public_category_roots(id) on delete cascade,
  responded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_items_not_self_check check (sender_user_id <> recipient_user_id),
  constraint inbox_items_payload_check
    check (
      (type = 'category_share' and category_snapshot is not null and public_root_id is null)
      or
      (type = 'public_invite' and category_snapshot is null and public_root_id is not null)
    )
);

create index inbox_items_recipient_idx
  on public.inbox_items(recipient_user_id, status, created_at desc);

create index inbox_items_sender_idx
  on public.inbox_items(sender_user_id, status, created_at desc);

create unique index inbox_items_public_invite_pending_unique_idx
  on public.inbox_items(public_root_id, recipient_user_id)
  where type = 'public_invite' and status = 'pending';

create table public.planner_profiles (
  app_user_id uuid primary key references public.app_users(id) on delete cascade,
  timezone text not null default 'Europe/Minsk',
  horizon text not null default 'week' check (horizon in ('week', 'two_weeks', 'month')),
  reserve_ratio numeric(4,3) not null default 0.200 check (reserve_ratio between 0 and 0.600),
  default_buffer_minutes integer not null default 15 check (default_buffer_minutes between 0 and 120),
  availability jsonb not null default '{}'::jsonb,
  availability_overrides jsonb not null default '{}'::jsonb,
  energy_windows jsonb not null default '[]'::jsonb,
  sleep_schedule jsonb not null default '{"mode":"fixed","weekdays":{"bedtime":"23:00","durationMinutes":480},"weekends":{"bedtime":"23:00","durationMinutes":480}}'::jsonb,
  planning_policy jsonb not null default '{"focus":"sleep","minimumNightMinutes":360,"maxNightDeficitMinutes":120,"maxRollingSevenDayDeficitMinutes":180,"recoveryHorizonNights":3,"deadlineChainGapMinutes":5}'::jsonb,
  assistant_setup_version integer not null default 0,
  revision bigint not null default 0,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.planner_items (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  id text not null check (char_length(trim(id)) between 1 and 160),
  kind text not null check (kind in ('fixed_event', 'flexible_task', 'routine')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  notes text not null default '',
  area text not null default '',
  location text not null default '',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  energy text not null default 'normal' check (energy in ('low', 'normal', 'high')),
  estimate_minutes integer not null default 60 check (estimate_minutes between 5 and 600000),
  uncertainty_policy jsonb not null default '{}'::jsonb,
  commitment_level text not null default 'required' check (commitment_level in ('must_not_skip', 'required', 'desired', 'if_time')),
  planning_rank integer not null default 0 check (planning_rank between 0 and 1000000),
  earliest_at timestamptz null,
  deadline_at timestamptz null,
  deadline_type text not null default 'none' check (deadline_type in ('none', 'target', 'hard')),
  target_finish_at timestamptz null,
  target_finish_mode text not null default 'auto' check (target_finish_mode in ('auto', 'manual')),
  estimate_confidence text not null default 'normal' check (estimate_confidence in ('high', 'normal', 'low')),
  deadline_policy jsonb not null default '{"chainMode":"inherit"}'::jsonb,
  milestones jsonb not null default '[]'::jsonb,
  allowed_windows jsonb not null default '[]'::jsonb,
  preferred_windows jsonb not null default '[]'::jsonb,
  avoided_windows jsonb not null default '[]'::jsonb,
  can_split boolean not null default false,
  min_chunk_minutes integer not null default 25 check (min_chunk_minutes between 5 and 1440),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 1440),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 1440),
  recurrence jsonb null,
  auto_plan boolean not null default true,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  unplaced_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_user_id, id)
);

create index planner_items_user_status_priority_idx
  on public.planner_items(app_user_id, status, priority, deadline_at, created_at);

create table public.planner_blocks (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  id text not null check (char_length(trim(id)) between 1 and 160),
  item_id text null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'skipped', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'auto', 'migrated')),
  fixed boolean not null default false,
  role text not null default 'work' check (role in ('work', 'uncertainty_reserve', 'calibration', 'protected_free')),
  end_estimate jsonb null,
  soft boolean not null default false,
  occurrence_key text null,
  actual_start_at timestamptz null,
  actual_end_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_user_id, id),
  constraint planner_blocks_time_check check (end_at > start_at),
  constraint planner_blocks_item_fk
    foreign key (app_user_id, item_id)
    references public.planner_items(app_user_id, id)
    on delete cascade
);

create index planner_blocks_user_range_idx
  on public.planner_blocks(app_user_id, start_at, end_at)
  include (status, fixed, item_id, occurrence_key);

create index planner_blocks_occurrence_idx
  on public.planner_blocks(app_user_id, item_id, occurrence_key)
  where item_id is not null and occurrence_key is not null and status <> 'cancelled';

create table public.planner_deferred_remainders (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  id text not null check (char_length(trim(id)) between 1 and 160),
  item_id text null,
  source_block_id text null,
  occurrence_key text null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  total_minutes integer not null check (total_minutes between 1 and 600000),
  pending_minutes integer not null check (pending_minutes between 0 and 600000),
  scheduled_minutes integer not null default 0 check (scheduled_minutes between 0 and 600000),
  expires_at timestamptz not null,
  resolved_at timestamptz null,
  resolution text null check (resolution is null or resolution in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_user_id, id),
  constraint planner_deferred_remainders_volume_check
    check (pending_minutes + scheduled_minutes <= total_minutes)
);

create index planner_deferred_remainders_user_expiry_idx
  on public.planner_deferred_remainders(app_user_id, expires_at, resolved_at);

create table public.planner_proposals (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  base_revision bigint not null,
  proposal_data jsonb not null,
  expires_at timestamptz not null,
  applied_at timestamptz null,
  created_at timestamptz not null default now()
);

create index planner_proposals_user_expiry_idx
  on public.planner_proposals(app_user_id, expires_at desc);

create table public.planner_change_sets (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  from_revision bigint not null,
  to_revision bigint not null,
  trigger text not null,
  changes jsonb not null,
  inverse_snapshot jsonb not null,
  undone_at timestamptz null,
  created_at timestamptz not null default now()
);

create index planner_change_sets_user_created_idx
  on public.planner_change_sets(app_user_id, created_at desc);

create table public.planner_legacy_imports (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  source_key text not null,
  source_title text not null default '',
  imported_item_ids jsonb not null default '[]'::jsonb,
  imported_block_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (app_user_id, source_key)
);

create table public.planner_sleep_events (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  wake_date date not null,
  event_kind text not null default 'sleep_change' check (event_kind in ('sleep_change', 'check_in', 'planned_adjustment')),
  state text not null default 'confirmed' check (state in ('tentative', 'confirmed', 'completed', 'planned')),
  actual_start_at timestamptz null,
  projected_end_at timestamptz null,
  actual_end_at timestamptz null,
  estimated_start_from_at timestamptz null,
  estimated_start_to_at timestamptz null,
  planned_start_at timestamptz null,
  planned_end_at timestamptz null,
  planned_duration_minutes integer null check (planned_duration_minutes is null or planned_duration_minutes between 15 and 960),
  selection_reason text null check (selection_reason is null or selection_reason in ('preference', 'workload', 'hard_deadline', 'recovery', 'manual', 'activation_transition')),
  borrowed_minutes integer not null default 0 check (borrowed_minutes between 0 and 120),
  restedness text null check (restedness is null or restedness in ('not_rested', 'okay', 'well_rested')),
  sleepiness_level integer null check (sleepiness_level is null or sleepiness_level between 0 and 4),
  feedback_text text not null default '',
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

create index planner_sleep_events_user_range_idx
  on public.planner_sleep_events(app_user_id, wake_date desc);

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

create trigger trg_account_images_updated_at
before update on public.account_images
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

create trigger trg_dictionary_study_progress_updated_at
before update on public.dictionary_study_progress
for each row execute function public.set_updated_at();

create trigger trg_friendships_updated_at
before update on public.friendships
for each row execute function public.set_updated_at();

create trigger trg_public_category_roots_updated_at
before update on public.public_category_roots
for each row execute function public.set_updated_at();

create trigger trg_public_category_members_updated_at
before update on public.public_category_members
for each row execute function public.set_updated_at();

create trigger trg_inbox_items_updated_at
before update on public.inbox_items
for each row execute function public.set_updated_at();

create trigger trg_planner_profiles_updated_at
before update on public.planner_profiles
for each row execute function public.set_updated_at();

create trigger trg_planner_items_updated_at
before update on public.planner_items
for each row execute function public.set_updated_at();

create trigger trg_planner_blocks_updated_at
before update on public.planner_blocks
for each row execute function public.set_updated_at();

create trigger trg_planner_sleep_events_updated_at
before update on public.planner_sleep_events
for each row execute function public.set_updated_at();
