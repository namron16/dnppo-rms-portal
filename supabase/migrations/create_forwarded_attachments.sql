-- All attachments belonging to a forwarded document.
-- Stored flat; hierarchy is reconstructed via parent_attachment_id + depth.

create table public.forwarded_attachments (
  id                      uuid        primary key default gen_random_uuid(),
  forwarded_document_id   uuid        not null
                            references public.forwarded_documents(id)
                            on delete cascade,

  -- Original identity (for deduplication / audit)
  original_attachment_id  text,
  parent_attachment_id    text,         -- null = direct child of root document
  depth                   int          not null default 0,

  -- File metadata
  title                   text        not null,
  file_name               text,
  file_size_bytes         bigint,
  mime_type               text,

  -- GDrive reference
  gdrive_file_id          text        not null,
  gdrive_url              text        not null,
  pool_account_id         text        not null,

  created_at              timestamptz not null default now()
);

create index idx_fwd_att_document on public.forwarded_attachments(forwarded_document_id);
create index idx_fwd_att_parent   on public.forwarded_attachments(parent_attachment_id);