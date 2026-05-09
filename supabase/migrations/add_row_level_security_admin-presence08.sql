alter table public.admin_presence enable row level security;

-- Users can upsert their own presence
create policy "upsert own presence"
  on public.admin_presence for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- PD, DPDA, DPDO, admin can read all presence
create policy "leadership reads all presence"
  on public.admin_presence for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role in ('admin','PD','DPDA','DPDO','P1')
    )
  );