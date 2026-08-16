-- Audited, deterministic repair for the production integrity issues discovered
-- before tenant constraints are validated.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
set local search_path = pg_catalog, public;

-- Repair shifts that reference another tenant's location. The staff record is
-- already bound to the shift tenant and all affected staff have a valid store.
insert into public.audit_trail (
  tenant_id, action_type, actor_role, resource_type, resource_id, changes, metadata
)
select
  shift.tenant_id,
  'SYSTEM_DATA_REPAIR',
  'system',
  'shift',
  shift.id::text,
  jsonb_build_object(
    'location_id', jsonb_build_object('before', shift.location_id, 'after', staff.location_id)
  ),
  jsonb_build_object(
    'repair_key', 'shift_location_same_tenant_20260815',
    'reason', 'Shift referenced a location owned by another tenant'
  )
from public.shifts as shift
join public.locations as foreign_location on foreign_location.id = shift.location_id
join public.staff as staff
  on staff.id = shift.staff_id
 and staff.tenant_id = shift.tenant_id
join public.locations as assigned_location
  on assigned_location.id = staff.location_id
 and assigned_location.tenant_id = shift.tenant_id
where foreign_location.tenant_id <> shift.tenant_id
  and not exists (
    select 1 from public.audit_trail as existing
    where existing.tenant_id = shift.tenant_id
      and existing.resource_type = 'shift'
      and existing.resource_id = shift.id::text
      and existing.metadata ->> 'repair_key' = 'shift_location_same_tenant_20260815'
  );

update public.shifts as shift
set location_id = staff.location_id,
    summary = coalesce(shift.summary, '{}'::jsonb) || jsonb_build_object(
      'location_repaired_at', now(),
      'location_repair', 'staff_assignment'
    )
from public.staff as staff
join public.locations as assigned_location
  on assigned_location.id = staff.location_id
 and assigned_location.tenant_id = staff.tenant_id
cross join public.locations as foreign_location
where staff.id = shift.staff_id
  and staff.tenant_id = shift.tenant_id
  and foreign_location.id = shift.location_id
  and foreign_location.tenant_id <> shift.tenant_id;

-- Close abandoned or superseded shifts. A staff member may retain one recent
-- open shift; every older open shift receives a proper closing report.
create temporary table shift_closure_plan on commit drop as
with open_shifts as (
  select
    shift.*,
    lead(shift.started_at) over (
      partition by shift.tenant_id, shift.staff_id
      order by shift.started_at, shift.id
    ) as next_started_at
  from public.shifts as shift
  where shift.ended_at is null
)
select
  open_shift.id,
  open_shift.tenant_id,
  open_shift.staff_id,
  open_shift.location_id,
  open_shift.started_at,
  greatest(
    open_shift.started_at + interval '1 second',
    least(coalesce(open_shift.next_started_at, now()), now())
  ) as closure_at,
  case
    when open_shift.next_started_at is not null then 'superseded_by_new_shift'
    else 'stale_over_24_hours'
  end as closure_reason
from open_shifts as open_shift
where open_shift.next_started_at is not null
   or open_shift.started_at < now() - interval '24 hours';

insert into public.audit_trail (
  tenant_id, action_type, actor_role, resource_type, resource_id, changes, metadata
)
select
  plan.tenant_id,
  'SYSTEM_SHIFT_CLOSED',
  'system',
  'shift',
  plan.id::text,
  jsonb_build_object('ended_at', jsonb_build_object('before', null, 'after', plan.closure_at)),
  jsonb_build_object(
    'repair_key', 'close_stale_shift_20260815',
    'reason', plan.closure_reason
  )
from shift_closure_plan as plan
where not exists (
  select 1 from public.audit_trail as existing
  where existing.tenant_id = plan.tenant_id
    and existing.resource_type = 'shift'
    and existing.resource_id = plan.id::text
    and existing.metadata ->> 'repair_key' = 'close_stale_shift_20260815'
);

insert into public.shift_closing_reports (
  tenant_id, shift_id, cashier_id, location_id, report_date,
  transactions_count, gross_sales, discount_total, returns_count,
  returns_total, net_sales, opened_at, closed_at, summary
)
select
  plan.tenant_id,
  plan.id,
  plan.staff_id,
  plan.location_id,
  (plan.closure_at at time zone tenant.business_timezone)::date,
  transaction_stats.transactions_count,
  transaction_stats.gross_sales,
  discount_stats.discount_total,
  return_stats.returns_count,
  return_stats.returns_total,
  greatest(transaction_stats.gross_sales - return_stats.returns_total, 0),
  plan.started_at,
  plan.closure_at,
  jsonb_build_object(
    'closed_by', 'operational_integrity_repair',
    'closure_reason', plan.closure_reason,
    'gross_sales', transaction_stats.gross_sales,
    'discount_total', discount_stats.discount_total,
    'returns_total', return_stats.returns_total,
    'net_sales', greatest(transaction_stats.gross_sales - return_stats.returns_total, 0)
  )
from shift_closure_plan as plan
join public.tenants as tenant on tenant.id = plan.tenant_id
cross join lateral (
  select
    count(*)::integer as transactions_count,
    coalesce(sum(transaction.total), 0)::numeric(12,2) as gross_sales
  from public.transactions as transaction
  where transaction.tenant_id = plan.tenant_id
    and transaction.cashier_id = plan.staff_id
    and transaction.location_id is not distinct from plan.location_id
    and transaction.created_at >= plan.started_at
    and transaction.created_at < plan.closure_at
) as transaction_stats
cross join lateral (
  select
    coalesce(sum(item.discount_amount * item.quantity), 0)::numeric(12,2) as discount_total
  from public.transactions as transaction
  join public.transaction_items as item on item.transaction_id = transaction.id
  where transaction.tenant_id = plan.tenant_id
    and transaction.cashier_id = plan.staff_id
    and transaction.location_id is not distinct from plan.location_id
    and transaction.created_at >= plan.started_at
    and transaction.created_at < plan.closure_at
) as discount_stats
cross join lateral (
  select
    count(*)::integer as returns_count,
    coalesce(sum(sales_return.refund_total), 0)::numeric(12,2) as returns_total
  from public.sales_returns as sales_return
  where sales_return.tenant_id = plan.tenant_id
    and sales_return.cashier_id = plan.staff_id
    and sales_return.location_id is not distinct from plan.location_id
    and sales_return.created_at >= plan.started_at
    and sales_return.created_at < plan.closure_at
) as return_stats
where not exists (
  select 1 from public.shift_closing_reports as existing
  where existing.tenant_id = plan.tenant_id and existing.shift_id = plan.id
);

update public.shifts as shift
set ended_at = plan.closure_at,
    transactions_count = report.transactions_count,
    total_sales = report.gross_sales,
    discount_total = report.discount_total,
    returns_count = report.returns_count,
    returns_total = report.returns_total,
    closing_report_id = report.id,
    summary = report.summary
from shift_closure_plan as plan
join public.shift_closing_reports as report
  on report.tenant_id = plan.tenant_id and report.shift_id = plan.id
where shift.id = plan.id and shift.tenant_id = plan.tenant_id and shift.ended_at is null;

insert into public.audit_trail (
  tenant_id, action_type, actor_role, resource_type, resource_id, changes, metadata
)
select
  tenant.id,
  'SYSTEM_TRIAL_EXPIRED',
  'system',
  'tenant',
  tenant.id::text,
  jsonb_build_object('status', jsonb_build_object('before', tenant.status, 'after', 'SUSPENDED')),
  jsonb_build_object('repair_key', 'expire_stale_trials_20260815')
from public.tenants as tenant
join public.onboarding_sessions as onboarding on onboarding.tenant_id = tenant.id
where tenant.status = 'TRIAL'
  and onboarding.trial_end_date < now()
  and not exists (
    select 1 from public.audit_trail as existing
    where existing.tenant_id = tenant.id
      and existing.resource_type = 'tenant'
      and existing.resource_id = tenant.id::text
      and existing.metadata ->> 'repair_key' = 'expire_stale_trials_20260815'
  );

update public.tenants as tenant
set status = 'SUSPENDED', updated_at = now()
from public.onboarding_sessions as onboarding
where onboarding.tenant_id = tenant.id
  and tenant.status = 'TRIAL'
  and onboarding.trial_end_date < now();

create unique index if not exists shifts_one_open_per_staff
  on public.shifts (tenant_id, staff_id)
  where ended_at is null;

-- Validate the containment constraints now that the audit and deterministic
-- repair have confirmed the existing records are consistent.
do $validate_constraints$
declare
  target record;
begin
  for target in
    select * from (values
      ('staff', 'staff_operational_roles_require_location'),
      ('staff', 'staff_auth_version_nonnegative'),
      ('platform_admins', 'platform_admins_failed_login_attempts_nonnegative'),
      ('platform_admins', 'platform_admins_auth_version_nonnegative'),
      ('staff', 'fk_staff_location_same_tenant'),
      ('garments', 'fk_garments_variant_same_tenant'),
      ('garments', 'fk_garments_location_same_tenant'),
      ('transactions', 'fk_transactions_location_same_tenant'),
      ('transactions', 'fk_transactions_cashier_same_tenant'),
      ('stock_movements', 'fk_stock_movements_garment_same_tenant'),
      ('stock_movements', 'fk_stock_movements_from_location_same_tenant'),
      ('stock_movements', 'fk_stock_movements_to_location_same_tenant'),
      ('stock_movements', 'fk_stock_movements_actor_same_tenant'),
      ('stock_movements', 'fk_stock_movements_transaction_same_tenant'),
      ('stocktake_sessions', 'fk_stocktake_sessions_location_same_tenant'),
      ('stocktake_sessions', 'fk_stocktake_sessions_clerk_same_tenant'),
      ('sync_conflicts', 'fk_sync_conflicts_resolver_same_tenant'),
      ('audit_trail', 'fk_audit_trail_actor_same_tenant'),
      ('cash_drawers', 'fk_cash_drawers_location_same_tenant'),
      ('cash_drawers', 'fk_cash_drawers_cashier_same_tenant'),
      ('shifts', 'fk_shifts_staff_same_tenant'),
      ('shifts', 'fk_shifts_location_same_tenant'),
      ('sales_returns', 'fk_sales_returns_shift_same_tenant'),
      ('sales_returns', 'fk_sales_returns_transaction_same_tenant'),
      ('sales_returns', 'fk_sales_returns_cashier_same_tenant'),
      ('sales_returns', 'fk_sales_returns_location_same_tenant'),
      ('shift_closing_reports', 'fk_shift_reports_shift_same_tenant'),
      ('shift_closing_reports', 'fk_shift_reports_cashier_same_tenant'),
      ('shift_closing_reports', 'fk_shift_reports_location_same_tenant'),
      ('platform_access_events', 'fk_platform_access_staff_same_tenant'),
      ('billing_history', 'fk_billing_history_tenant'),
      ('zra_sync_queue', 'zra_sync_queue_tenant_uuid_format'),
      ('tenants', 'tenants_subscription_plan_fkey'),
      ('tenants', 'tenants_billing_anchor_day_range'),
      ('subscription_plans', 'subscription_plans_price_nonnegative'),
      ('subscription_plans', 'subscription_plans_limits_positive'),
      ('subscription_plans', 'subscription_plans_currency_format')
    ) as configured(table_name, constraint_name)
  loop
    if to_regclass(format('public.%I', target.table_name)) is not null
       and exists (
         select 1 from pg_constraint
         where conrelid = to_regclass(format('public.%I', target.table_name))
           and conname = target.constraint_name
           and not convalidated
       ) then
      execute format(
        'alter table public.%I validate constraint %I',
        target.table_name,
        target.constraint_name
      );
    end if;
  end loop;
end
$validate_constraints$;

alter table public.tenants alter column subscription_plan_id set not null;

commit;
