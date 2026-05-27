-- Enable RLS on all four tables
ALTER TABLE public.master_document_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_order_attachments ENABLE ROW LEVEL SECURITY;

-- ── master_document_attachments ───────────────────────────────────────────────

CREATE POLICY "authenticated read master attachments"
  ON public.master_document_attachments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "non-admin insert master attachments"
  ON public.master_document_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role <> 'admin'
    )
  );

CREATE POLICY "non-admin update master attachments"
  ON public.master_document_attachments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role <> 'admin'
    )
  );

CREATE POLICY "non-admin delete master attachments"
  ON public.master_document_attachments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role <> 'admin'
    )
  );

-- ── special_order_attachments ─────────────────────────────────────────────────

CREATE POLICY "authenticated read so attachments"
  ON public.special_order_attachments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "non-admin insert so attachments"
  ON public.special_order_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role <> 'admin'
    )
  );

CREATE POLICY "non-admin update so attachments"
  ON public.special_order_attachments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role <> 'admin'
    )
  );

CREATE POLICY "non-admin delete so attachments"
  ON public.special_order_attachments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role <> 'admin'
    )
  );