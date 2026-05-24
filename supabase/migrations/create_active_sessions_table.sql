CREATE TABLE public.active_sessions (
  role          TEXT PRIMARY KEY,        -- e.g. 'P1', 'admin', 'PD'
  session_token TEXT NOT NULL,           -- random UUID generated at login
  logged_in_at  TIMESTAMPTZ DEFAULT NOW(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Only the service role (server) and the owner can read/write
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own row
CREATE POLICY "user reads own session"
  ON public.active_sessions
  FOR SELECT
  USING (user_id = auth.uid());

-- Allow authenticated users to upsert their own row
CREATE POLICY "user upserts own session"
  ON public.active_sessions
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user updates own session"
  ON public.active_sessions
  FOR UPDATE
  USING (user_id = auth.uid());

-- Allow authenticated users to delete their own row (logout)
CREATE POLICY "user deletes own session"
  ON public.active_sessions
  FOR DELETE
  USING (user_id = auth.uid());