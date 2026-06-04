create table if not exists public.account_images (
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

create index if not exists account_images_user_kind_idx
  on public.account_images(app_user_id, kind, created_at desc);

drop trigger if exists trg_account_images_updated_at on public.account_images;

create trigger trg_account_images_updated_at
before update on public.account_images
for each row
execute function public.set_updated_at();
