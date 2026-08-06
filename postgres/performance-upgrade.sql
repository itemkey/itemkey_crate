begin;

alter table public.public_category_members
  add column if not exists mount_parent_category_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.public_category_members'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (mount_parent_category_id)%'
  ) then
    alter table public.public_category_members
      add constraint public_category_members_mount_parent_fk
      foreign key (mount_parent_category_id)
      references public.categories(id)
      on delete set null;
  end if;
end
$$;

create index if not exists categories_workspace_summary_order_idx
  on public.categories(workspace_id, position, created_at, id)
  include (parent_id, title, description, tag, format, category_type, updated_at);

create index if not exists public_category_members_user_root_idx
  on public.public_category_members(app_user_id, public_root_id)
  include (role, mount_parent_category_id, updated_at);

analyze public.categories;
analyze public.public_category_roots;
analyze public.public_category_members;
analyze public.category_messages;

commit;
