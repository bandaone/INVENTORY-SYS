alter table if exists public.staff
  add column if not exists auth_user_id uuid;

alter table if exists public.platform_admins
  add column if not exists auth_user_id uuid;

create unique index if not exists staff_auth_user_id_unique
  on public.staff (auth_user_id)
  where auth_user_id is not null;

create unique index if not exists platform_admins_auth_user_id_unique
  on public.platform_admins (auth_user_id)
  where auth_user_id is not null;

comment on column public.staff.auth_user_id is
  'Supabase Auth user ID. Authorization remains in server-controlled staff columns.';

comment on column public.platform_admins.auth_user_id is
  'Supabase Auth user ID. Platform authorization remains server-controlled.';
