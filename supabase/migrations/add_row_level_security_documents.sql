-- ============================================================
-- Row Level Security — DNPPO RMS Document Tables
-- ============================================================
-- Rules:
--   • All authenticated roles EXCEPT 'admin' can:
--       SELECT, INSERT, UPDATE, DELETE on all document tables
--   • 'admin' role is intentionally excluded from all document
--       tables (admin manages users/logs only, not documents)
--   • No tag-based visibility — all non-admin roles see everything
-- ============================================================
-- Tables covered:
--   public.master_documents
--   public.special_orders
--   public.daily_journals
--   public.library_items
--   public.classified_documents
-- ============================================================
-- Helper note:
--   The reusable condition below is inlined per policy since
--   Postgres RLS does not support shared policy functions
--   without a security-definer wrapper. For clarity, each
--   policy is self-contained.
--
--   "non-admin authenticated user" =
--     exists (
--       select 1 from public.profiles
--       where id = auth.uid()
--       and role <> 'admin'
--     )
-- ============================================================


-- ============================================================
-- Drop old policies before recreating
-- (safe to run on a fresh DB — IF EXISTS prevents errors)
-- ============================================================

-- master_documents
drop policy if exists "full access roles read master"   on public.master_documents;
drop policy if exists "tagged viewer read master"        on public.master_documents;
drop policy if exists "P1 insert master"                 on public.master_documents;
drop policy if exists "P1 update master"                 on public.master_documents;

-- special_orders (drop any pre-existing policies)
drop policy if exists "all roles read special orders"    on public.special_orders;
drop policy if exists "all roles write special orders"   on public.special_orders;

-- daily_journals
drop policy if exists "all roles read daily journals"    on public.daily_journals;
drop policy if exists "all roles write daily journals"   on public.daily_journals;

-- library_items
drop policy if exists "all roles read library items"     on public.library_items;
drop policy if exists "all roles write library items"    on public.library_items;

-- classified_documents
drop policy if exists "all roles read classified"        on public.confidential_docs;
drop policy if exists "all roles write classified"       on public.confidential_docs;


-- ============================================================
-- 1. MASTER DOCUMENTS
-- ============================================================

alter table public.master_documents enable row level security;

-- SELECT: all roles except admin
create policy "non-admin read master"
  on public.master_documents for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- INSERT: all roles except admin
create policy "non-admin insert master"
  on public.master_documents for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- UPDATE: all roles except admin
create policy "non-admin update master"
  on public.master_documents for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- DELETE: all roles except admin
create policy "non-admin delete master"
  on public.master_documents for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );


-- ============================================================
-- 2. SPECIAL ORDERS
-- ============================================================

alter table public.special_orders enable row level security;

-- SELECT: all roles except admin
create policy "non-admin read special orders"
  on public.special_orders for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- INSERT: all roles except admin
create policy "non-admin insert special orders"
  on public.special_orders for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- UPDATE: all roles except admin
create policy "non-admin update special orders"
  on public.special_orders for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- DELETE: all roles except admin
create policy "non-admin delete special orders"
  on public.special_orders for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );


-- ============================================================
-- 3. DAILY JOURNALS
-- ============================================================

alter table public.daily_journals enable row level security;

-- SELECT: all roles except admin
create policy "non-admin read daily journals"
  on public.daily_journals for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- INSERT: all roles except admin
create policy "non-admin insert daily journals"
  on public.daily_journals for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- UPDATE: all roles except admin
create policy "non-admin update daily journals"
  on public.daily_journals for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- DELETE: all roles except admin
create policy "non-admin delete daily journals"
  on public.daily_journals for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );


-- ============================================================
-- 4. LIBRARY ITEMS
-- ============================================================

alter table public.library_items enable row level security;

-- SELECT: all roles except admin
create policy "non-admin read library items"
  on public.library_items for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- INSERT: all roles except admin
create policy "non-admin insert library items"
  on public.library_items for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- UPDATE: all roles except admin
create policy "non-admin update library items"
  on public.library_items for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- DELETE: all roles except admin
create policy "non-admin delete library items"
  on public.library_items for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );


-- ============================================================
-- 5. CLASSIFIED DOCUMENTS
-- ============================================================

alter table public.confidential_docs enable row level security;

-- SELECT: all roles except admin
create policy "non-admin read classified"
  on public.confidential_docs for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- INSERT: all roles except admin
create policy "non-admin insert classified"
  on public.confidential_docs for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- UPDATE: all roles except admin
create policy "non-admin update classified"
  on public.confidential_docs for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );

-- DELETE: all roles except admin
create policy "non-admin delete classified"
  on public.confidential_docs for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role <> 'admin'
    )
  );





select schemaname, tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in (
    'master_documents',
    'special_orders',
    'daily_journals',
    'library_items',
    'classified_documents'
  )
order by tablename, cmd;

Expected: 4 policies per table (select, insert, update, delete)
          = 20 policies total