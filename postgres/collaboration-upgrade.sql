create extension if not exists pgcrypto;

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.app_users(id) on delete cascade,
  addressee_user_id uuid not null references public.app_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_not_self_check check (requester_user_id <> addressee_user_id)
);

create unique index if not exists friendships_pair_unique_idx
  on public.friendships (
    least(requester_user_id, addressee_user_id),
    greatest(requester_user_id, addressee_user_id)
  );

create index if not exists friendships_requester_idx
  on public.friendships(requester_user_id, status, created_at desc);

create index if not exists friendships_addressee_idx
  on public.friendships(addressee_user_id, status, created_at desc);

create table if not exists public.public_category_roots (
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

create index if not exists public_category_roots_owner_idx
  on public.public_category_roots(owner_user_id, created_at desc);

create table if not exists public.public_category_members (
  id uuid primary key default gen_random_uuid(),
  public_root_id uuid not null references public.public_category_roots(id) on delete cascade,
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  mount_parent_category_id uuid null references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (public_root_id, app_user_id)
);

alter table public.public_category_members
  add column if not exists mount_parent_category_id uuid null references public.categories(id) on delete set null;

create index if not exists public_category_members_user_idx
  on public.public_category_members(app_user_id, role, created_at desc);

create index if not exists public_category_members_mount_parent_idx
  on public.public_category_members(mount_parent_category_id);

insert into public.workspaces (owner_user_id, slug, title)
select distinct pcm.app_user_id, 'main', 'Main workspace'
from public.public_category_members pcm
left join public.workspaces workspace
  on workspace.owner_user_id = pcm.app_user_id
  and workspace.slug = 'main'
where pcm.mount_parent_category_id is null
  and workspace.id is null
on conflict (owner_user_id, slug)
do nothing;

insert into public.categories (
  workspace_id,
  parent_id,
  title,
  content,
  description,
  tag,
  format,
  category_type,
  position
)
select
  workspace.id,
  null,
  'main',
  '',
  '',
  '#main',
  'continuous',
  'learning',
  coalesce((
    select max(existing.position) + 1
    from public.categories existing
    where existing.workspace_id = workspace.id
      and existing.parent_id is null
  ), 0)
from public.workspaces workspace
where workspace.slug = 'main'
  and exists (
    select 1
    from public.public_category_members pcm
    where pcm.app_user_id = workspace.owner_user_id
      and pcm.mount_parent_category_id is null
  )
  and not exists (
    select 1
    from public.categories existing_main
    where existing_main.workspace_id = workspace.id
      and existing_main.parent_id is null
      and lower(trim(existing_main.title)) = 'main'
  );

update public.public_category_members pcm
set mount_parent_category_id = main_category.id
from public.workspaces workspace
join public.categories main_category
  on main_category.workspace_id = workspace.id
  and main_category.parent_id is null
  and lower(trim(main_category.title)) = 'main'
where pcm.mount_parent_category_id is null
  and workspace.owner_user_id = pcm.app_user_id
  and workspace.slug = 'main';

create table if not exists public.inbox_items (
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

create index if not exists inbox_items_recipient_idx
  on public.inbox_items(recipient_user_id, status, created_at desc);

create index if not exists inbox_items_sender_idx
  on public.inbox_items(sender_user_id, status, created_at desc);

create unique index if not exists inbox_items_public_invite_pending_unique_idx
  on public.inbox_items(public_root_id, recipient_user_id)
  where type = 'public_invite' and status = 'pending';

drop trigger if exists trg_friendships_updated_at on public.friendships;
create trigger trg_friendships_updated_at
before update on public.friendships
for each row execute function public.set_updated_at();

drop trigger if exists trg_public_category_roots_updated_at on public.public_category_roots;
create trigger trg_public_category_roots_updated_at
before update on public.public_category_roots
for each row execute function public.set_updated_at();

drop trigger if exists trg_public_category_members_updated_at on public.public_category_members;
create trigger trg_public_category_members_updated_at
before update on public.public_category_members
for each row execute function public.set_updated_at();

drop trigger if exists trg_inbox_items_updated_at on public.inbox_items;
create trigger trg_inbox_items_updated_at
before update on public.inbox_items
for each row execute function public.set_updated_at();
