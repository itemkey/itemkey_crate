create table if not exists public.dictionary_word_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create index if not exists dictionary_word_groups_workspace_position_idx
  on public.dictionary_word_groups(workspace_id, position, created_at);

create table if not exists public.dictionary_word_group_items (
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

create unique index if not exists dictionary_word_group_items_block_unique_idx
  on public.dictionary_word_group_items(group_id, source_category_id, source_message_id, entry_id)
  where source_message_id is not null and dictionary_id is null;

create unique index if not exists dictionary_word_group_items_continuous_unique_idx
  on public.dictionary_word_group_items(group_id, source_category_id, dictionary_id, entry_id)
  where source_message_id is null and dictionary_id is not null;

create index if not exists dictionary_word_group_items_group_position_idx
  on public.dictionary_word_group_items(workspace_id, group_id, position, created_at);

create index if not exists dictionary_word_group_items_lookup_idx
  on public.dictionary_word_group_items(workspace_id, source_category_id, source_message_id, dictionary_id, entry_id);
