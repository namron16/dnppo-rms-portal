-- =============================================================================
-- FIX: Admin-group access (DN and any future admin-group roles)
-- Resolves:
--   1. Infinite recursion in role_registry RLS
--   2. admin_logs blocked for non-'admin' roles
--   3. admin_presence showing only 1 online
--   4. Backfills nav_group into JWT metadata for existing admin-group accounts
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1: Create a SECURITY DEFINER helper to check nav_group
-- Runs as DB owner internally — breaks the recursion loop
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin_nav_group()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_registry rr ON rr.role = p.role
    WHERE p.id = auth.uid()
      AND rr.nav_group = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_nav_group() TO authenticated;


-- -----------------------------------------------------------------------------
-- STEP 2: Fix role_registry RLS (was causing the recursion)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "admin manages role registry" ON public.role_registry;

CREATE POLICY "admin manages role registry"
  ON public.role_registry FOR ALL
  USING (public.is_admin_nav_group());


-- -----------------------------------------------------------------------------
-- STEP 3: Fix admin_logs RLS
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "admin reads all logs" ON public.admin_logs;

CREATE POLICY "admin reads all logs"
  ON public.admin_logs FOR SELECT
  USING (public.is_admin_nav_group());

-- Keep insert open for any authenticated user (existing behaviour)
DROP POLICY IF EXISTS "insert own log" ON public.admin_logs;

CREATE POLICY "insert own log"
  ON public.admin_logs FOR INSERT
  WITH CHECK (user_id = auth.uid());


-- -----------------------------------------------------------------------------
-- STEP 4: Fix admin_presence RLS
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "admin reads all presence"    ON public.admin_presence;
DROP POLICY IF EXISTS "leadership reads all presence" ON public.admin_presence;

-- Any admin-group role can read all presence rows
CREATE POLICY "admin reads all presence"
  ON public.admin_presence FOR SELECT
  USING (public.is_admin_nav_group());

-- Leadership (PD, DPDA, DPDO) can also read presence for their dashboards
CREATE POLICY "leadership reads all presence"
  ON public.admin_presence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('PD', 'DPDA', 'DPDO')
    )
  );

-- Every user can still upsert their own presence row (unchanged)
DROP POLICY IF EXISTS "any user upserts own presence" ON public.admin_presence;

CREATE POLICY "any user upserts own presence"
  ON public.admin_presence FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- -----------------------------------------------------------------------------
-- STEP 5: Make sure role_registry has nav_group = 'admin' for DN
-- (add more roles here if needed)
-- -----------------------------------------------------------------------------

UPDATE public.role_registry
SET nav_group = 'admin'
WHERE role = 'DN';


-- -----------------------------------------------------------------------------
-- STEP 6: Backfill nav_group + is_viewer_only into JWT metadata
-- Covers DN and any other admin-group account missing these fields
-- -----------------------------------------------------------------------------

UPDATE auth.users AS u
SET raw_user_meta_data = u.raw_user_meta_data || jsonb_build_object(
  'nav_group',      rr.nav_group,
  'is_viewer_only', COALESCE(rr.is_viewer_only, false)
)
FROM public.profiles p
JOIN public.role_registry rr ON rr.role = p.role
WHERE u.id = p.id
  AND rr.nav_group = 'admin'
  AND (
    (u.raw_user_meta_data->>'nav_group') IS NULL
    OR (u.raw_user_meta_data->>'nav_group') != 'admin'
  );


-- -----------------------------------------------------------------------------
-- DONE
-- After running this script:
--   1. DN (and any admin-group role) can access log history, user management,
--      backup & recovery, system settings, and drive storage
--   2. No more infinite recursion error
--   3. admin_presence shows all online users correctly
--   4. DN must log out and back in for the JWT metadata update to take effect
-- -----------------------------------------------------------------------------