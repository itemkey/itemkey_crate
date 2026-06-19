create table if not exists public.dictionary_study_progress (
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

create unique index if not exists dictionary_study_progress_block_unique_idx
  on public.dictionary_study_progress(app_user_id, workspace_id, source_category_id, source_message_id)
  where source_message_id is not null and dictionary_id is null;

create unique index if not exists dictionary_study_progress_continuous_unique_idx
  on public.dictionary_study_progress(app_user_id, workspace_id, source_category_id, dictionary_id)
  where source_message_id is null and dictionary_id is not null;

create index if not exists dictionary_study_progress_user_updated_idx
  on public.dictionary_study_progress(app_user_id, updated_at desc);

drop trigger if exists trg_dictionary_study_progress_updated_at on public.dictionary_study_progress;

create trigger trg_dictionary_study_progress_updated_at
before update on public.dictionary_study_progress
for each row
execute function public.set_updated_at();
