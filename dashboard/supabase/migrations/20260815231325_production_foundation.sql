-- Canonical subscription, entitlement, invoicing, and payment foundation.
-- Apply after the Supabase identity migration and tenant-isolation containment.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
set local search_path = pg_catalog, public;

create schema if not exists private;
revoke all on schema private from public;

do $revoke_private_schema$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'retail_os_app']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on schema private from %I', role_name);
    end if;
  end loop;
end
$revoke_private_schema$;

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code varchar(50),
  name varchar(80) not null,
  description text,
  price_zmw numeric(12,2) not null,
  currency varchar(3) not null default 'ZMW',
  billing_interval_days integer not null default 30,
  max_locations integer not null,
  max_users integer not null,
  features jsonb not null default '[]'::jsonb,
  entitlements jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscription_plans
  add column if not exists code varchar(50),
  add column if not exists description text,
  add column if not exists currency varchar(3) not null default 'ZMW',
  add column if not exists billing_interval_days integer not null default 30,
  add column if not exists entitlements jsonb not null default '{}'::jsonb,
  add column if not exists version integer not null default 1,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.subscription_plans
set code = case lower(name)
  when 'starter' then 'boutique_starter'
  when 'boutique starter' then 'boutique_starter'
  when 'professional' then 'growth'
  when 'growth' then 'growth'
  when 'enterprise' then 'enterprise_fleet'
  when 'enterprise fleet' then 'enterprise_fleet'
  else 'legacy_' || replace(id::text, '-', '')
end
where code is null or btrim(code) = '';

alter table public.subscription_plans alter column code set not null;
create unique index if not exists subscription_plans_code_unique
  on public.subscription_plans (code);

do $plan_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscription_plans'::regclass
      and conname = 'subscription_plans_price_nonnegative'
  ) then
    alter table public.subscription_plans
      add constraint subscription_plans_price_nonnegative check (price_zmw >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscription_plans'::regclass
      and conname = 'subscription_plans_limits_positive'
  ) then
    alter table public.subscription_plans
      add constraint subscription_plans_limits_positive
      check (max_locations > 0 and max_users > 0 and billing_interval_days > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscription_plans'::regclass
      and conname = 'subscription_plans_currency_format'
  ) then
    alter table public.subscription_plans
      add constraint subscription_plans_currency_format
      check (currency ~ '^[A-Z]{3}$') not valid;
  end if;
end
$plan_constraints$;

insert into public.subscription_plans (
  code, name, description, price_zmw, currency, billing_interval_days,
  max_locations, max_users, features, entitlements
)
values
  (
    'boutique_starter', 'Boutique Starter',
    'Professional controls for a single retail location.',
    1200, 'ZMW', 30, 1, 3,
    '["1 store location", "Up to 3 active users", "Inventory and POS", "Stocktake", "Standard ZRA integration", "Email support"]'::jsonb,
    '{"analytics":"standard","inventory":true,"pos":true,"stocktake":true,"transfers":false,"zra":true,"priority_support":false}'::jsonb
  ),
  (
    'growth', 'Growth',
    'Multi-store operations, transfers, and advanced commercial reporting.',
    3500, 'ZMW', 30, 3, 10,
    '["Up to 3 store locations", "Up to 10 active users", "Store transfers", "Advanced analytics", "Priority ZRA sync", "Priority support"]'::jsonb,
    '{"analytics":"advanced","inventory":true,"pos":true,"stocktake":true,"transfers":true,"zra":true,"priority_support":true}'::jsonb
  ),
  (
    'enterprise_fleet', 'Enterprise Fleet',
    'Governed fleet operations for large retail groups.',
    9500, 'ZMW', 30, 20, 100,
    '["Up to 20 store locations", "Up to 100 active users", "Fleet analytics", "Custom integrations", "Dedicated account management", "White-glove onboarding"]'::jsonb,
    '{"analytics":"enterprise","inventory":true,"pos":true,"stocktake":true,"transfers":true,"zra":true,"priority_support":true,"custom_integrations":true,"dedicated_manager":true}'::jsonb
  )
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_zmw = excluded.price_zmw,
  currency = excluded.currency,
  billing_interval_days = excluded.billing_interval_days,
  max_locations = excluded.max_locations,
  max_users = excluded.max_users,
  features = excluded.features,
  entitlements = excluded.entitlements,
  version = public.subscription_plans.version + 1,
  updated_at = now();

alter table public.tenants
  add column if not exists subscription_plan_id uuid,
  add column if not exists subscription_end_date timestamptz,
  add column if not exists business_timezone varchar(64) not null default 'Africa/Lusaka',
  add column if not exists billing_anchor_day smallint not null default 1;

create index if not exists tenants_subscription_plan_idx
  on public.tenants (subscription_plan_id);

update public.tenants as tenant
set subscription_plan_id = plan.id,
    max_locations = plan.max_locations,
    features = plan.entitlements,
    updated_at = now()
from public.subscription_plans as plan
where plan.code = tenant.subscription_tier
  and tenant.subscription_plan_id is distinct from plan.id;

do $tenant_plan_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenants'::regclass
      and conname = 'tenants_subscription_plan_fkey'
  ) then
    alter table public.tenants
      add constraint tenants_subscription_plan_fkey
      foreign key (subscription_plan_id)
      references public.subscription_plans(id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenants'::regclass
      and conname = 'tenants_billing_anchor_day_range'
  ) then
    alter table public.tenants
      add constraint tenants_billing_anchor_day_range
      check (billing_anchor_day between 1 and 28) not valid;
  end if;
end
$tenant_plan_constraints$;

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  invoice_number varchar(80) not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  subtotal numeric(12,2) not null,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null,
  amount_paid numeric(12,2) not null default 0,
  currency varchar(3) not null default 'ZMW',
  status varchar(24) not null default 'OPEN',
  due_at timestamptz not null,
  paid_at timestamptz,
  voided_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_invoices_number_unique unique (invoice_number),
  constraint subscription_invoices_period_valid check (period_end > period_start),
  constraint subscription_invoices_amounts_valid check (
    subtotal >= 0 and tax_amount >= 0 and total_amount >= 0 and amount_paid >= 0
  ),
  constraint subscription_invoices_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint subscription_invoices_status_valid check (
    status in ('DRAFT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID')
  ),
  constraint subscription_invoices_tenant_period_unique
    unique (tenant_id, plan_id, period_start, period_end)
);

create unique index if not exists subscription_invoices_tenant_id_unique
  on public.subscription_invoices (tenant_id, id);
create index if not exists subscription_invoices_tenant_created_idx
  on public.subscription_invoices (tenant_id, created_at desc);
create index if not exists subscription_invoices_plan_idx
  on public.subscription_invoices (plan_id);
create index if not exists subscription_invoices_status_due_idx
  on public.subscription_invoices (status, due_at)
  where status in ('OPEN', 'PARTIALLY_PAID', 'OVERDUE');

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null,
  provider varchar(24) not null,
  provider_reference varchar(255) not null,
  provider_transaction_id varchar(255),
  amount numeric(12,2) not null,
  currency varchar(3) not null default 'ZMW',
  status varchar(24) not null default 'PENDING',
  payer_msisdn varchar(20),
  failure_code varchar(100),
  failure_message text,
  provider_metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  succeeded_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_payments_provider_valid check (
    provider in ('MTN_MOMO', 'FLUTTERWAVE', 'LEGACY', 'SANDBOX')
  ),
  constraint subscription_payments_status_valid check (
    status in ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
  ),
  constraint subscription_payments_amount_positive check (amount > 0),
  constraint subscription_payments_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint subscription_payments_provider_reference_unique unique (provider, provider_reference),
  constraint subscription_payments_invoice_same_tenant
    foreign key (tenant_id, invoice_id)
    references public.subscription_invoices(tenant_id, id)
);

create unique index if not exists subscription_payments_provider_transaction_unique
  on public.subscription_payments (provider, provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists subscription_payments_tenant_created_idx
  on public.subscription_payments (tenant_id, created_at desc);
create index if not exists subscription_payments_invoice_idx
  on public.subscription_payments (invoice_id);
create index if not exists subscription_payments_pending_idx
  on public.subscription_payments (tenant_id, requested_at desc)
  where status = 'PENDING';
create unique index if not exists subscription_payments_one_pending_per_invoice
  on public.subscription_payments (invoice_id)
  where status = 'PENDING';

create table if not exists private.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider varchar(24) not null,
  provider_event_id varchar(255) not null,
  payment_id uuid references public.subscription_payments(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  event_type varchar(100) not null,
  payload_hash varchar(128) not null,
  payload jsonb not null default '{}'::jsonb,
  processing_status varchar(24) not null default 'RECEIVED',
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_provider_events_reference_unique unique (provider, provider_event_id),
  constraint payment_provider_events_status_valid check (
    processing_status in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')
  )
);

create index if not exists payment_provider_events_payment_idx
  on private.payment_provider_events (payment_id, received_at desc);
create index if not exists payment_provider_events_tenant_idx
  on private.payment_provider_events (tenant_id, received_at desc);

-- Uptime and error-rate values must come from an external availability signal.
-- NULL means "not measured"; fabricated healthy defaults are misleading.
alter table if exists public.platform_health_snapshots
  alter column api_uptime_pct drop not null,
  alter column api_uptime_pct drop default,
  alter column error_rate_pct drop not null,
  alter column error_rate_pct drop default;

-- Preserve the single legacy posted payment as a reconciled invoice/payment.
insert into public.subscription_invoices (
  id, tenant_id, plan_id, invoice_number, period_start, period_end,
  subtotal, total_amount, amount_paid, currency, status, due_at, paid_at, metadata,
  created_at, updated_at
)
select
  event.id,
  event.tenant_id,
  tenant.subscription_plan_id,
  'INV-LEGACY-' || upper(substr(replace(event.id::text, '-', ''), 1, 12)),
  coalesce(event.effective_at, event.created_at),
  coalesce(event.effective_at, event.created_at) + interval '30 days',
  event.amount,
  event.amount,
  event.amount,
  event.currency,
  'PAID',
  coalesce(event.due_at, event.created_at),
  coalesce(event.effective_at, event.created_at),
  jsonb_build_object('legacy_billing_event_id', event.id, 'migration', 'production_foundation'),
  event.created_at,
  event.created_at
from public.billing_events as event
join public.tenants as tenant on tenant.id = event.tenant_id
where event.event_type = 'PAYMENT_RECEIVED'
  and event.status = 'POSTED'
  and event.amount > 0
  and tenant.subscription_plan_id is not null
on conflict (id) do nothing;

insert into public.subscription_payments (
  id, tenant_id, invoice_id, provider, provider_reference, amount, currency,
  status, provider_metadata, requested_at, succeeded_at, created_at, updated_at
)
select
  invoice.id,
  invoice.tenant_id,
  invoice.id,
  'LEGACY',
  'legacy-event-' || invoice.id::text,
  invoice.total_amount,
  invoice.currency,
  'SUCCEEDED',
  jsonb_build_object('migration', 'production_foundation'),
  invoice.created_at,
  invoice.paid_at,
  invoice.created_at,
  invoice.updated_at
from public.subscription_invoices as invoice
where invoice.metadata ? 'legacy_billing_event_id'
on conflict (id) do nothing;

update public.tenants as tenant
set subscription_end_date = greatest(
      coalesce(tenant.subscription_end_date, paid_invoice.period_end),
      paid_invoice.period_end
    ),
    status = 'ACTIVE',
    updated_at = now()
from (
  select tenant_id, max(period_end) as period_end
  from public.subscription_invoices
  where status = 'PAID'
  group by tenant_id
) as paid_invoice
where tenant.id = paid_invoice.tenant_id;

update public.onboarding_sessions as onboarding
set converted_to_paid = true,
    conversion_date = coalesce(onboarding.conversion_date, payment.succeeded_at),
    updated_at = now()
from (
  select tenant_id, min(succeeded_at) as succeeded_at
  from public.subscription_payments
  where status = 'SUCCEEDED'
  group by tenant_id
) as payment
where onboarding.tenant_id = payment.tenant_id;

-- Keep the denormalized location counter correct for old and new application versions.
update public.tenants as tenant
set active_locations_count = (
      select count(*)::integer
      from public.locations as location
      where location.tenant_id = tenant.id and location.is_active
    ),
    updated_at = now()
where active_locations_count is distinct from (
  select count(*)::integer
  from public.locations as location
  where location.tenant_id = tenant.id and location.is_active
);

create or replace function private.assign_tenant_plan()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  selected_plan record;
begin
  select id, code, max_locations, entitlements
  into selected_plan
  from public.subscription_plans
  where (
      id = new.subscription_plan_id
      or (new.subscription_plan_id is null and code = new.subscription_tier)
    )
    and (
      is_active
      or (tg_op = 'UPDATE' and id = old.subscription_plan_id)
    )
  order by (id = new.subscription_plan_id) desc
  limit 1;

  if not found then
    raise exception 'Unknown or inactive subscription plan for tier %', new.subscription_tier
      using errcode = '23514';
  end if;

  new.subscription_plan_id := selected_plan.id;
  new.subscription_tier := selected_plan.code;
  new.max_locations := selected_plan.max_locations;
  new.features := selected_plan.entitlements;
  return new;
end
$function$;

revoke all on function private.assign_tenant_plan() from public;

drop trigger if exists tenants_assign_subscription_plan on public.tenants;
create trigger tenants_assign_subscription_plan
before insert or update of subscription_plan_id, subscription_tier
on public.tenants
for each row execute function private.assign_tenant_plan();

create or replace function private.enforce_location_entitlement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  location_limit integer;
  current_usage integer;
begin
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and old.tenant_id = new.tenant_id then return new; end if;

  perform 1 from public.tenants where id = new.tenant_id for update;
  select plan.max_locations
  into location_limit
  from public.tenants as tenant
  join public.subscription_plans as plan on plan.id = tenant.subscription_plan_id
  where tenant.id = new.tenant_id;

  if location_limit is null then
    raise exception 'Tenant has no active location entitlement' using errcode = '23514';
  end if;

  select count(*)::integer into current_usage
  from public.locations
  where tenant_id = new.tenant_id and is_active and id is distinct from new.id;

  if current_usage >= location_limit then
    raise exception 'Subscription location limit of % reached', location_limit using errcode = '23514';
  end if;
  return new;
end
$function$;

revoke all on function private.enforce_location_entitlement() from public;

drop trigger if exists locations_enforce_subscription_limit on public.locations;
create trigger locations_enforce_subscription_limit
before insert or update of tenant_id, is_active
on public.locations
for each row execute function private.enforce_location_entitlement();

create or replace function private.enforce_staff_entitlement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  user_limit integer;
  current_usage integer;
begin
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and old.tenant_id = new.tenant_id then return new; end if;

  perform 1 from public.tenants where id = new.tenant_id for update;
  select plan.max_users
  into user_limit
  from public.tenants as tenant
  join public.subscription_plans as plan on plan.id = tenant.subscription_plan_id
  where tenant.id = new.tenant_id;

  if user_limit is null then
    raise exception 'Tenant has no active user entitlement' using errcode = '23514';
  end if;

  select count(*)::integer into current_usage
  from public.staff
  where tenant_id = new.tenant_id and is_active and id is distinct from new.id;

  if current_usage >= user_limit then
    raise exception 'Subscription user limit of % reached', user_limit using errcode = '23514';
  end if;
  return new;
end
$function$;

revoke all on function private.enforce_staff_entitlement() from public;

drop trigger if exists staff_enforce_subscription_limit on public.staff;
create trigger staff_enforce_subscription_limit
before insert or update of tenant_id, is_active
on public.staff
for each row execute function private.enforce_staff_entitlement();

create or replace function private.guard_plan_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.max_locations < old.max_locations and exists (
    select 1
    from public.tenants as tenant
    where tenant.subscription_plan_id = old.id
      and (
        select count(*) from public.locations as location
        where location.tenant_id = tenant.id and location.is_active
      ) > new.max_locations
  ) then
    raise exception 'Cannot reduce plan location limit below current tenant usage' using errcode = '23514';
  end if;

  if new.max_users < old.max_users and exists (
    select 1
    from public.tenants as tenant
    where tenant.subscription_plan_id = old.id
      and (
        select count(*) from public.staff as staff
        where staff.tenant_id = tenant.id and staff.is_active
      ) > new.max_users
  ) then
    raise exception 'Cannot reduce plan user limit below current tenant usage' using errcode = '23514';
  end if;

  new.version := case
    when row(new.name, new.description, new.price_zmw, new.currency,
             new.billing_interval_days, new.max_locations, new.max_users,
             new.features, new.entitlements, new.is_active)
      is distinct from
         row(old.name, old.description, old.price_zmw, old.currency,
             old.billing_interval_days, old.max_locations, old.max_users,
             old.features, old.entitlements, old.is_active)
    then old.version + 1
    else old.version
  end;
  new.updated_at := now();
  return new;
end
$function$;

revoke all on function private.guard_plan_capacity() from public;

drop trigger if exists subscription_plans_guard_capacity on public.subscription_plans;
create trigger subscription_plans_guard_capacity
before update on public.subscription_plans
for each row execute function private.guard_plan_capacity();

create or replace function private.sync_plan_to_tenants()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  update public.tenants
  set subscription_tier = new.code,
      max_locations = new.max_locations,
      features = new.entitlements,
      updated_at = now()
  where subscription_plan_id = new.id;
  return new;
end
$function$;

revoke all on function private.sync_plan_to_tenants() from public;

drop trigger if exists subscription_plans_sync_tenants on public.subscription_plans;
create trigger subscription_plans_sync_tenants
after update of code, max_locations, entitlements on public.subscription_plans
for each row execute function private.sync_plan_to_tenants();

create or replace function private.sync_tenant_location_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  affected_tenant uuid;
begin
  affected_tenant := coalesce(new.tenant_id, old.tenant_id);
  update public.tenants
  set active_locations_count = (
        select count(*)::integer from public.locations
        where tenant_id = affected_tenant and is_active
      ),
      updated_at = now()
  where id = affected_tenant;

  if tg_op = 'UPDATE' and old.tenant_id is distinct from new.tenant_id then
    update public.tenants
    set active_locations_count = (
          select count(*)::integer from public.locations
          where tenant_id = old.tenant_id and is_active
        ),
        updated_at = now()
    where id = old.tenant_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

revoke all on function private.sync_tenant_location_count() from public;

drop trigger if exists locations_sync_tenant_count on public.locations;
create trigger locations_sync_tenant_count
after insert or update of tenant_id, is_active or delete
on public.locations
for each row execute function private.sync_tenant_location_count();

alter table public.subscription_plans enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.subscription_payments enable row level security;

drop policy if exists subscription_plans_app_read on public.subscription_plans;
create policy subscription_plans_app_read
  on public.subscription_plans for select to retail_os_app using (is_active);

drop policy if exists subscription_invoices_tenant_app on public.subscription_invoices;
create policy subscription_invoices_tenant_app
  on public.subscription_invoices for select to retail_os_app
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists subscription_payments_tenant_app on public.subscription_payments;
create policy subscription_payments_tenant_app
  on public.subscription_payments for select to retail_os_app
  using (tenant_id = (select public.current_tenant_id()));

revoke all on table public.subscription_plans from public;
revoke all on table public.subscription_invoices from public;
revoke all on table public.subscription_payments from public;
revoke all on table private.payment_provider_events from public;

do $revoke_foundation_data_api$
declare
  role_name text;
  table_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      foreach table_name in array array['subscription_plans', 'subscription_invoices', 'subscription_payments']
      loop
        execute format('revoke all on table public.%I from %I', table_name, role_name);
      end loop;
    end if;
  end loop;
end
$revoke_foundation_data_api$;

grant select on table public.subscription_plans to retail_os_app;
grant select on table public.subscription_invoices to retail_os_app;
grant select on table public.subscription_payments to retail_os_app;

comment on table public.subscription_invoices is
  'Canonical tenant subscription invoices. Billing events are lifecycle audit records, not invoices.';
comment on table public.subscription_payments is
  'Canonical idempotent provider payment attempts linked to subscription invoices.';
comment on table private.payment_provider_events is
  'Private provider event inbox for replay protection and reconciliation.';

commit;
