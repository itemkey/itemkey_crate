alter table public.app_users
  add column if not exists locale text not null default 'ru';

update public.app_users
set locale = 'ru'
where locale is null or locale not in ('ru', 'en');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_locale_check'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_locale_check check (locale in ('ru', 'en'));
  end if;
end
$$;
