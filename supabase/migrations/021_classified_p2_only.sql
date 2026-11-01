CREATE OR REPLACE FUNCTION public.archive_document(
  p_table TEXT, p_doc_id TEXT, p_archive_id TEXT,
  p_title TEXT, p_type TEXT, p_archived_by TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_rows INT;
BEGIN
  IF p_table = 'confidential_docs' AND NOT EXISTS (
       SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'P2') THEN
    RAISE EXCEPTION 'Only P2 can archive or restore classified documents';
  END IF;

  IF    p_table = 'master_documents'  THEN UPDATE public.master_documents  SET archived = TRUE WHERE id = p_doc_id;
  ELSIF p_table = 'library_items'     THEN UPDATE public.library_items     SET archived = TRUE WHERE id = p_doc_id;
  ELSIF p_table = 'confidential_docs' THEN UPDATE public.confidential_docs SET archived = TRUE WHERE id = p_doc_id;
  ELSIF p_table = 'daily_journals'    THEN UPDATE public.daily_journals    SET archived = TRUE, updated_at = NOW() WHERE id = p_doc_id;
  ELSIF p_table = 'special_orders'    THEN UPDATE public.special_orders    SET status = 'ARCHIVED' WHERE id = p_doc_id;
  ELSE RAISE EXCEPTION 'Unsupported table: %', p_table;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Document % not found or you are not allowed to archive it', p_doc_id;
  END IF;

  DELETE FROM public.archived_docs WHERE id = p_archive_id;
  INSERT INTO public.archived_docs (id, title, type, archived_date, archived_by)
  VALUES (p_archive_id, p_title, p_type, CURRENT_DATE, p_archived_by);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_document(
  p_table TEXT, p_doc_id TEXT, p_archive_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_rows INT;
BEGIN
  IF p_table = 'confidential_docs' AND NOT EXISTS (
       SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'P2') THEN
    RAISE EXCEPTION 'Only P2 can archive or restore classified documents';
  END IF;

  IF    p_table = 'master_documents'  THEN UPDATE public.master_documents  SET archived = FALSE WHERE id = p_doc_id;
  ELSIF p_table = 'library_items'     THEN UPDATE public.library_items     SET archived = FALSE WHERE id = p_doc_id;
  ELSIF p_table = 'confidential_docs' THEN UPDATE public.confidential_docs SET archived = FALSE WHERE id = p_doc_id;
  ELSIF p_table = 'daily_journals'    THEN UPDATE public.daily_journals    SET archived = FALSE, updated_at = NOW() WHERE id = p_doc_id;
  ELSIF p_table = 'special_orders'    THEN UPDATE public.special_orders    SET status = 'ACTIVE' WHERE id = p_doc_id;
ELSE RAISE EXCEPTION 'Unsupported table: %', p_table;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Document % not found or you are not allowed to restore it', p_doc_id;
  END IF;

  DELETE FROM public.archived_docs WHERE id = p_archive_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_document(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_document(TEXT,TEXT,TEXT)               TO authenticated;

-- Backfill: classified docs archived BEFORE this fix have no Archive-page row
INSERT INTO public.archived_docs (id, title, type, archived_date, archived_by)
SELECT 'arc-cd-' || id, title, 'Classified Document', CURRENT_DATE, 'P2'
FROM public.confidential_docs WHERE archived = TRUE
ON CONFLICT (id) DO NOTHING;