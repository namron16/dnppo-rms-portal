-- Add new roles to profiles table constraint
-- This allows PPSMU and WCPD roles to be stored in the profiles table

alter table public.profiles 
drop constraint "profiles_role_check";

alter table public.profiles 
add constraint "profiles_role_check" check (role in (
  'admin','PD','DPDA','DPDO',
  'P1','P2','P3','P4','P5','P6','P7','P8','P9','P10',
  'PPSMU','WCPD'
));
