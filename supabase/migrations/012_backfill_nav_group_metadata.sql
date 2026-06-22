-- supabase/migrations/012_backfill_nav_group_metadata.sql
--
-- PURPOSE: Existing accounts created before the nav_group fix don't have
-- nav_group or is_viewer_only in their JWT user_metadata.
-- This migration backfills those values from role_registry into auth.users
-- so the middleware can enforce correct routes for old accounts too.
--
-- Safe to run multiple times (DO UPDATE is idempotent).
-- Run this once in Supabase SQL Editor or via `supabase db push`.

UPDATE auth.users AS u
SET raw_user_meta_data = u.raw_user_meta_data || jsonb_build_object(
  'nav_group',      COALESCE(rr.nav_group, 'documents'),
  'is_viewer_only', COALESCE(rr.is_viewer_only, true)
)
FROM public.profiles p
JOIN public.role_registry rr ON rr.role = p.role
WHERE u.id = p.id
  -- Only update rows that are missing nav_group (avoids overwriting new accounts)
  AND (u.raw_user_meta_data->>'nav_group') IS NULL;