create table public.forwarded_documents (
  id                  uuid        primary key default gen_random_uuid(),

  -- Participants
  sender_role         text        not null,
  recipient_role      text        not null,

  -- Source document identity
  original_doc_id     text        not null,
  document_type       text        not null check (document_type in (
                        'master_document',
                        'admin_order',
                        'daily_journal',
                        'library'
                      )),
  title               text        not null,
  notes               text,

  -- GDrive file reference (no copy — same IDs as original)
  gdrive_file_id      text        not null,
  gdrive_url          text        not null,
  pool_account_id     text        not null,
  file_name           text,
  file_size_bytes     bigint,
  mime_type           text,

  -- Lifecycle
  status              text        not null default 'pending' check (status in (
                        'pending',
                        'saved',
                        'dismissed'
                      )),
  received_at         timestamptz not null default now(),
  saved_at            timestamptz,
  saved_doc_id        text,         -- ID of the new row created when recipient saves

  created_at          timestamptz not null default now()
);

-- Indexes for inbox queries
create index idx_fwd_docs_recipient  on public.forwarded_documents(recipient_role, status);
create index idx_fwd_docs_sender     on public.forwarded_documents(sender_role);
create index idx_fwd_docs_created    on public.forwarded_documents(created_at desc);