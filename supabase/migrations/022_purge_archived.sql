CREATE OR REPLACE FUNCTION public.purge_archived_document(
  p_table TEXT, p_doc_id TEXT, p_archive_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_rows INT;
BEGIN
  IF p_table = 'confidential_docs' AND NOT EXISTS (
       SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'P2') THEN
    RAISE EXCEPTION 'Only P2 can delete classified documents';
  END IF;

  -- Only ARCHIVED documents can be purged. A live document can never be deleted here.
  IF    p_table = 'master_documents'  THEN DELETE FROM public.master_documents  WHERE id = p_doc_id AND archived = TRUE;
  ELSIF p_table = 'library_items'     THEN DELETE FROM public.library_items     WHERE id = p_doc_id AND archived = TRUE;
  ELSIF p_table = 'confidential_docs' THEN DELETE FROM public.confidential_docs WHERE id = p_doc_id AND archived = TRUE;
  ELSIF p_table = 'daily_journals'    THEN DELETE FROM public.daily_journals    WHERE id = p_doc_id AND archived = TRUE;
  ELSIF p_table = 'special_orders'    THEN DELETE FROM public.special_orders    WHERE id = p_doc_id AND status = 'ARCHIVED';
  ELSE RAISE EXCEPTION 'Unsupported table: %', p_table;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Document % is not archived, does not exist, or you are not allowed to delete it', p_doc_id;
  END IF;

  DELETE FROM public.archived_docs WHERE id = p_archive_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.purge_archived_document(TEXT,TEXT,TEXT) TO authenticated;