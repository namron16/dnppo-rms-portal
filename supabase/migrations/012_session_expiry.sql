-- =============================================================================
-- MIGRATION: 012_session_expiry.sql
-- Session Expiry & System Settings
--
-- What this does:
--   1. Adds expires_at to active_sessions so every login has a hard deadline.
--   2. Creates system_settings with a single row holding session_duration_hours.
--      The super admin changes this value from /admin/system-settings.
--   3. When the admin shortens the duration, ALL existing sessions whose
--      expires_at > now() + new_duration get their expires_at pulled back
--      immediately — so users are kicked on the next 30-second poll.
-- =============================================================================

-- ── 1. Add expires_at to active_sessions ─────────────────────────────────────

ALTER TABLE public.active_sessions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill existing rows: treat them as 24-hour sessions from when they logged in
UPDATE public.active_sessions
SET expires_at = logged_in_at + INTERVAL '24 hours'
WHERE expires_at IS NULL;

-- Now make it NOT NULL with a safe default
ALTER TABLE public.active_sessions
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '24 hours';

-- Index for the validity check: role + session_token + expires_at
CREATE INDEX IF NOT EXISTS idx_active_sessions_expiry
  ON public.active_sessions(role, expires_at);

-- ── 2. Create system_settings ─────────────────────────────────────────────────
-- Single-row config table. The app always reads/writes the row where id = 1.

CREATE TABLE IF NOT EXISTS public.system_settings (
  id                     INT PRIMARY KEY DEFAULT 1,        -- always 1 — single row
  session_duration_hours INT NOT NULL DEFAULT 24
    CONSTRAINT chk_session_duration CHECK (session_duration_hours BETWEEN 1 AND 168),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by             TEXT NOT NULL DEFAULT 'admin',

  -- Prevent accidental second rows
  CONSTRAINT singleton CHECK (id = 1)
);

-- Seed the default row
INSERT INTO public.system_settings (id, session_duration_hours)
VALUES (1, 24)
ON CONFLICT (id) DO NOTHING;

-- Auto-touch updated_at
CREATE TRIGGER trg_system_settings_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── 3. RPC: update_session_duration ──────────────────────────────────────────
-- Called by the settings page. Does two things atomically:
--   a) Updates system_settings.session_duration_hours
--   b) Pulls back expires_at on ALL active sessions that would now be over-limit
--      so existing users get kicked on their next 30-second poll.

CREATE OR REPLACE FUNCTION public.update_session_duration(
  p_hours    INT,
  p_admin_by TEXT DEFAULT 'admin'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate
  IF p_hours < 1 OR p_hours > 168 THEN
    RAISE EXCEPTION 'session_duration_hours must be between 1 and 168, got %', p_hours;
  END IF;

  -- Update the config
  UPDATE public.system_settings
  SET
    session_duration_hours = p_hours,
    updated_by             = p_admin_by,
    updated_at             = NOW()
  WHERE id = 1;

  -- Immediately enforce: any session whose expires_at is further in the future
  -- than now() + new_duration gets pulled back to now() + new_duration.
  -- On the user's next 30-second poll, expires_at < now() → they get kicked.
  UPDATE public.active_sessions
  SET expires_at = NOW() + (p_hours || ' hours')::INTERVAL
  WHERE expires_at > NOW() + (p_hours || ' hours')::INTERVAL;
END;
$$;

-- ── 4. RLS on system_settings ─────────────────────────────────────────────────

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Only admin can read or write
CREATE POLICY "admin manages system settings"
  ON public.system_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── 5. Grants ─────────────────────────────────────────────────────────────────

GRANT ALL ON public.system_settings TO service_role;
GRANT EXECUTE ON FUNCTION public.update_session_duration(INT, TEXT) TO service_role;

-- Allow the authenticated client to call the RPC (it's SECURITY DEFINER so
-- the RLS check inside still applies at the DB level)
GRANT EXECUTE ON FUNCTION public.update_session_duration(INT, TEXT) TO authenticated;

-- Allow authenticated users to read system_settings so sessionLock can fetch
-- the duration at login time without needing the service key.
-- We add a separate permissive SELECT policy for all authenticated users:
CREATE POLICY "authenticated reads system settings"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (TRUE);

COMMENT ON TABLE  public.system_settings                     IS 'Single-row app-wide configuration. Always id = 1.';
COMMENT ON COLUMN public.system_settings.session_duration_hours IS 'Max session length in hours (1–168). Changing this immediately shortens any active session that exceeds the new limit.';