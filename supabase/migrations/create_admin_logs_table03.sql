-- If admin_logs currently stores a text role, migrate to UUID reference.
-- Run this only if admin_logs already exists with a text admin_id column.

alter table public.admin_logs
  add column if not exists user_id uuid references auth.users(id);

-- After data migration (Step 7 will populate user_id), you can drop the old column:
-- alter table public.admin_logs drop column admin_id;
```

If `admin_logs` does not yet exist:

```sql
create table public.admin_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  role        text not null,   -- denormalized for fast querying
  action      text not null,
  description text not null,
  created_at  timestamptz not null default now()
);

create index on public.admin_logs(user_id);
create index on public.admin_logs(created_at desc);