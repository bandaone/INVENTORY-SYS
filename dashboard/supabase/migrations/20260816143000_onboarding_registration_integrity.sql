-- Make public self-registration retry-safe and keep login identities globally
-- unique, matching Supabase Auth's email identity model.

alter table public.onboarding_sessions
  add column if not exists registration_request_id uuid;

create unique index if not exists onboarding_sessions_registration_request_unique
  on public.onboarding_sessions (registration_request_id)
  where registration_request_id is not null;

create unique index if not exists staff_normalized_email_global_unique
  on public.staff (lower(btrim(email)))
  where email is not null;

-- Every user has a home store. Owners retain tenant-wide permissions in the
-- application, but still need a concrete operational store for shifts, audit
-- records, and deterministic onboarding. Repair the two legacy-style cases by
-- choosing the tenant's oldest active store before making this invariant hard.
with assignments as (
  select staff.id as staff_id,
         (
           select location.id
           from public.locations as location
           where location.tenant_id = staff.tenant_id
             and location.is_active = true
           order by location.created_at asc, location.id asc
           limit 1
         ) as location_id
  from public.staff as staff
  where staff.location_id is null
)
update public.staff as staff
set location_id = assignments.location_id,
    updated_at = now()
from assignments
where staff.id = assignments.staff_id
  and assignments.location_id is not null;

do $$
begin
  if exists (select 1 from public.staff where location_id is null) then
    raise exception 'Cannot enforce staff store assignment: staff without an active tenant store remain';
  end if;
end
$$;

alter table public.staff
  alter column location_id set not null;

alter table public.staff
  drop constraint if exists staff_operational_roles_require_location;

comment on column public.staff.location_id is
  'Required home-store assignment. Tenant-wide roles may access other stores through application authorization.';

-- subscription_plan_id is the canonical relationship. The plan-assignment
-- trigger copies its code onto tenants, so a hard-coded enum check would make
-- a newly activated plan impossible to select during registration.
alter table public.tenants
  drop constraint if exists tenants_subscription_tier_check;

comment on column public.onboarding_sessions.registration_request_id is
  'Client-generated idempotency key for public tenant registration retries.';
