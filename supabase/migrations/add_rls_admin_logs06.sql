alter table public.admin_logs enable row level security;

-- Super admin (role = 'admin') can read all logs
create policy "admin reads all logs"
  on public.admin_logs for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Any authenticated user can insert their own log row
create policy "insert own log"
  on public.admin_logs for insert
  with check (user_id = auth.uid());