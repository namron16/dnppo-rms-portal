create or replace function get_email_by_role(p_role text)
returns text
language sql
security definer
as $$
  select u.email
  from auth.users u
  join profiles p on p.id = u.id
  where p.role = p_role
  limit 1;
$$;