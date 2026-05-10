
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in (
                  'admin','PD','DPDA','DPDO',
                  'P1','P2','P3','P4','P5','P6','P7','P8','P9','P10'
                )),
  display_name  text,
  title         text,
  avatar_url    text,
  avatar_color  text,
  initials      text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Auto-update updated_at on any row change
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();