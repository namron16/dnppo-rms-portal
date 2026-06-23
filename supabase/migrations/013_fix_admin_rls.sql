-- supabase/migrations/013_fix_admin_rls.sql
--
-- PROBLEM: The RLS policy "admin manages role registry" checks role = 'admin'
-- (hardcoded string). Dynamically created admin-group accounts (e.g. 'DN')
-- cannot write to role_registry even though they have nav_group = 'admin'.
--
-- FIX: Replace the write policy to check nav_group = 'admin' in role_registry
-- instead of matching the literal role string 'admin'.
--
-- The read policy is unchanged — all authenticated users can read active roles.

-- Drop the old write policy
DROP POLICY IF EXISTS "admin manages role registry" ON public.role_registry;

-- New policy: allow write access to any account whose role has nav_group='admin'
CREATE POLICY "admin manages role registry"
  ON public.role_registry FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.role_registry rr ON rr.role = p.role
      WHERE p.id = auth.uid()
        AND rr.nav_group = 'admin'
    )
  );

-- Also backfill nav_group into user_metadata for accounts created before this fix.
-- This ensures existing admin-group accounts have nav_group in their JWT.
UPDATE auth.users AS u
SET raw_user_meta_data = u.raw_user_meta_data || jsonb_build_object(
  'nav_group',      COALESCE(rr.nav_group, 'documents'),
  'is_viewer_only', COALESCE(rr.is_viewer_only, true)
)
FROM public.profiles p
JOIN public.role_registry rr ON rr.role = p.role
WHERE u.id = p.id
  AND (u.raw_user_meta_data->>'nav_group') IS NULL;