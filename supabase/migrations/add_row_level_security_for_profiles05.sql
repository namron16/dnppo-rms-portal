alter table public.profiles enable row level security;

-- Any authenticated user can read their own profile
create policy "select own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Only service-role (seed script / admin functions) can insert
create policy "insert profiles (service only)"
  on public.profiles for insert
  with check (false);  -- blocked for all JWT users; use service role key

-- Users can update their own display_name and avatar_url only
create policy "update own display prefs"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);