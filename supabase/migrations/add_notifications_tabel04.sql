alter table public.admin_notifications
  add column if not exists user_id uuid references auth.users(id);
```
