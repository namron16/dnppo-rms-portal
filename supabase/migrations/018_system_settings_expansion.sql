-- =============================================================================
-- MIGRATION: 018_system_settings_expansion.sql
-- Expands the single-row system_settings table with:
--   Security   — configurable password rules + account lockout
--   Data       — log retention days + default backup retention days
--   Org Info   — office name + letterhead text
-- Adds a login_attempts table + RPCs for lockout enforcement and a
-- system-wide "force logout everyone" action (reuses the same
-- expires_at pull-back pattern as update_session_duration).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New columns on system_settings
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS min_password_length      INT  NOT NULL DEFAULT 12
    CONSTRAINT chk_min_pw_length CHECK (min_password_length BETWEEN 8 AND 64),
  ADD COLUMN IF NOT EXISTS require_uppercase         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS require_number             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS require_symbol             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lockout_max_attempts       INT  NOT NULL DEFAULT 5
    CONSTRAINT chk_lockout_max CHECK (lockout_max_attempts BETWEEN 3 AND 20),
  ADD COLUMN IF NOT EXISTS lockout_duration_minutes   INT  NOT NULL DEFAULT 15
    CONSTRAINT chk_lockout_duration CHECK (lockout_duration_minutes BETWEEN 1 AND 1440),
  ADD COLUMN IF NOT EXISTS log_retention_days           INT NOT NULL DEFAULT 90
    CONSTRAINT chk_log_retention CHECK (log_retention_days BETWEEN 7 AND 3650),
  ADD COLUMN IF NOT EXISTS default_backup_retention_days INT NOT NULL DEFAULT 90
    CONSTRAINT chk_backup_retention CHECK (default_backup_retention_days BETWEEN 7 AND 3650),
  ADD COLUMN IF NOT EXISTS org_name                   TEXT NOT NULL DEFAULT 'DNPPO Records Management System',
  ADD COLUMN IF NOT EXISTS org_letterhead_text         TEXT NOT NULL DEFAULT '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. login_attempts — tracks failed logins per role for lockout enforcement
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.login_attempts (
  role              TEXT PRIMARY KEY,          -- one row per role (e.g. 'P1')
  failed_count      INT  NOT NULL DEFAULT 0,
  last_failed_at    TIMESTAMPTZ,
  locked_until      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- No direct client access — all reads/writes go through the RPCs below,
-- which run SECURITY DEFINER and are safe to call pre-authentication.
CREATE POLICY "login_attempts_deny_all"
  ON public.login_attempts
  FOR ALL
  TO anon, authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

GRANT ALL ON public.login_attempts TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: is_account_locked — read-only check, callable pre-auth (anon)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_account_locked(p_role TEXT)
RETURNS TABLE (locked BOOLEAN, locked_until TIMESTAMPTZ, attempts_remaining INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.login_attempts%ROWTYPE;
  v_max     INT;
BEGIN
  SELECT lockout_max_attempts INTO v_max FROM public.system_settings WHERE id = 1;
  IF v_max IS NULL THEN v_max := 5; END IF;

  SELECT * INTO v_row FROM public.login_attempts WHERE role = p_role;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, v_max;
    RETURN;
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > NOW() THEN
    RETURN QUERY SELECT TRUE, v_row.locked_until, 0;
    RETURN;
  END IF;

  -- Lock has expired (or never set) — report remaining attempts
  RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, GREATEST(0, v_max - v_row.failed_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_account_locked(TEXT) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: record_failed_login — increments the counter, locks if threshold hit
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_failed_login(p_role TEXT)
RETURNS TABLE (locked BOOLEAN, locked_until TIMESTAMPTZ, attempts_remaining INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max      INT;
  v_minutes  INT;
  v_row      public.login_attempts%ROWTYPE;
BEGIN
  SELECT lockout_max_attempts, lockout_duration_minutes
    INTO v_max, v_minutes
    FROM public.system_settings WHERE id = 1;

  IF v_max IS NULL THEN v_max := 5; END IF;
  IF v_minutes IS NULL THEN v_minutes := 15; END IF;

  INSERT INTO public.login_attempts (role, failed_count, last_failed_at, updated_at)
  VALUES (p_role, 1, NOW(), NOW())
  ON CONFLICT (role) DO UPDATE SET
    -- Reset the counter if the previous lock window has fully expired
    failed_count = CASE
      WHEN public.login_attempts.locked_until IS NOT NULL AND public.login_attempts.locked_until <= NOW()
        THEN 1
      ELSE public.login_attempts.failed_count + 1
    END,
    last_failed_at = NOW(),
    updated_at = NOW()
  RETURNING * INTO v_row;

  IF v_row.failed_count >= v_max THEN
    UPDATE public.login_attempts
    SET locked_until = NOW() + (v_minutes || ' minutes')::INTERVAL
    WHERE role = p_role
    RETURNING * INTO v_row;

    RETURN QUERY SELECT TRUE, v_row.locked_until, 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, GREATEST(0, v_max - v_row.failed_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_failed_login(TEXT) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: reset_failed_logins — called after a successful login
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reset_failed_logins(p_role TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.login_attempts WHERE role = p_role;
$$;

GRANT EXECUTE ON FUNCTION public.reset_failed_logins(TEXT) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC: force_logout_all_sessions — emergency "kick everyone" button.
--    Same mechanism as update_session_duration's expiry pull-back: sets
--    every active session's expires_at to NOW(), so the next 30-second
--    poll (AuthGuard) signs everyone out. Admin-only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.force_logout_all_sessions(p_admin_by TEXT DEFAULT 'admin')
RETURNS INT
RETURNS NULL ON NULL INPUT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  UPDATE public.active_sessions SET expires_at = NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.admin_logs (user_id, role, action, description)
  VALUES (auth.uid(), 'admin', 'force_logout_all',
          format('Force-logged-out %s active session(s)', v_count));

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.force_logout_all_sessions(TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC: update_org_settings — lets admin update org info + retention +
--    password rules + lockout config in one call (mirrors
--    update_session_duration's admin-only guard pattern).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_system_settings(
  p_min_password_length          INT,
  p_require_uppercase            BOOLEAN,
  p_require_number               BOOLEAN,
  p_require_symbol               BOOLEAN,
  p_lockout_max_attempts         INT,
  p_lockout_duration_minutes     INT,
  p_log_retention_days           INT,
  p_default_backup_retention_days INT,
  p_org_name                     TEXT,
  p_org_letterhead_text          TEXT,
  p_admin_by                     TEXT DEFAULT 'admin'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  UPDATE public.system_settings
  SET
    min_password_length            = p_min_password_length,
    require_uppercase               = p_require_uppercase,
    require_number                  = p_require_number,
    require_symbol                  = p_require_symbol,
    lockout_max_attempts            = p_lockout_max_attempts,
    lockout_duration_minutes        = p_lockout_duration_minutes,
    log_retention_days              = p_log_retention_days,
    default_backup_retention_days   = p_default_backup_retention_days,
    org_name                        = p_org_name,
    org_letterhead_text             = p_org_letterhead_text,
    updated_by                      = p_admin_by,
    updated_at                      = NOW()
  WHERE id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_system_settings(
  INT, BOOLEAN, BOOLEAN, BOOLEAN, INT, INT, INT, INT, TEXT, TEXT, TEXT
) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Reschedule the log-retention pg_cron job to read log_retention_days
--    dynamically instead of the hardcoded 90 in add_delete_logs.sql.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_old_admin_logs()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INT;
BEGIN
  SELECT log_retention_days INTO v_days FROM public.system_settings WHERE id = 1;
  IF v_days IS NULL THEN v_days := 90; END IF;

  DELETE FROM public.admin_logs
  WHERE created_at < NOW() - (v_days || ' days')::INTERVAL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_old_admin_logs() TO service_role;

-- Replace the old hardcoded cron job (add_delete_logs.sql) with one that
-- calls the dynamic function above.
SELECT cron.unschedule('delete-old-logs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'delete-old-logs');

SELECT cron.schedule(
  'delete-old-logs-dynamic',
  '0 0 * * *',   -- every midnight
  $$SELECT public.purge_old_admin_logs()$$
);

COMMENT ON COLUMN public.system_settings.min_password_length IS
  'Enforced client-side (login/reset forms) and should also be checked server-side wherever passwords are set.';
COMMENT ON TABLE public.login_attempts IS
  'One row per role. Reset on successful login via reset_failed_logins(). Locked via record_failed_login() once lockout_max_attempts is reached.';