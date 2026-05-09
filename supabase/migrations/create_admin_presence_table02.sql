-- Drop old version if it used AdminRole text directly
drop table if exists public.admin_presence;

create table public.admin_presence (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  is_active   boolean not null default false,
  last_seen   timestamptz not null default now()
);