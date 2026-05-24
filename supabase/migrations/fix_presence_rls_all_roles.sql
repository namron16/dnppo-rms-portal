-- File: supabase/migrations/fix_presence_rls_all_roles.sql
-- Fix 5 — Allow all authenticated users to update their own presence,
--         and allow admin to read all presence rows for the User Management page.

-- Allow ANY authenticated user to write/update their own presence row
-- (replaces the existing "upsert own presence" policy)
DROP POLICY IF EXISTS "upsert own presence"        ON public.admin_presence;
DROP POLICY IF EXISTS "leadership reads all presence" ON public.admin_presence;

-- Any user can insert/update their own presence row
CREATE POLICY "any user upserts own presence"
  ON public.admin_presence FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Super admin can read ALL presence rows (for the User Management page)
CREATE POLICY "admin reads all presence"
  ON public.admin_presence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
    )
  );

-- Leadership can read all presence (for their dashboards)
CREATE POLICY "leadership reads all presence"
  ON public.admin_presence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('PD', 'DPDA', 'DPDO')
    )
  );
