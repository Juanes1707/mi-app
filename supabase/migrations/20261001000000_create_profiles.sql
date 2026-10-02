begin;

create schema if not exists private;

revoke all privileges on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  display_name text,
  avatar_url text,
  bio text not null default '',
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format_check check (
    username is null
    or (
      char_length(username) between 3 and 30
      and username ~ '^[A-Za-z0-9._]+$'
    )
  ),
  constraint profiles_bio_length_check check (char_length(bio) <= 150)
);

create unique index profiles_username_lower_unique_idx
  on public.profiles (lower(username))
  where username is not null;

alter table public.profiles enable row level security;

revoke all privileges on table public.profiles from public, anon, authenticated;

grant select, insert, update, delete
  on table public.profiles
  to service_role;

create function private.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger create_profile_after_auth_user_insert
  after insert on auth.users
  for each row
  execute function private.create_profile_for_new_auth_user();

revoke all privileges
  on function private.create_profile_for_new_auth_user()
  from public, anon, authenticated;

create function private.set_profile_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_profile_updated_at_before_update
  before update on public.profiles
  for each row
  execute function private.set_profile_updated_at();

revoke all privileges
  on function private.set_profile_updated_at()
  from public, anon, authenticated;

insert into public.profiles (id)
select users.id
from auth.users as users
on conflict (id) do nothing;

commit;
