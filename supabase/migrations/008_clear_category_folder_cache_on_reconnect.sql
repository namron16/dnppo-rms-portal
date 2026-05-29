-- supabase/migrations/008_clear_category_folder_cache_on_reconnect.sql
-- When an account reconnects (upsert on account_email), we need to
-- clear its cached folder IDs so the gateway re-resolves them against
-- the correct (possibly new) root folder.

CREATE OR REPLACE FUNCTION public.trg_clear_category_folder_cache()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only clear when root_folder_id changes (reconnect scenario)
  IF OLD.root_folder_id IS DISTINCT FROM NEW.root_folder_id THEN
    DELETE FROM public.category_folders
    WHERE pool_account_id = NEW.id;

    RAISE NOTICE 'Cleared category_folders cache for pool account % (root folder changed: % → %)',
      NEW.id, OLD.root_folder_id, NEW.root_folder_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_storage_pool_clear_cache
  AFTER UPDATE OF root_folder_id ON public.storage_pool
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_clear_category_folder_cache();