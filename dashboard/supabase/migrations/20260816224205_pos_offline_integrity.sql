-- Make POS retries exactly-once, associate every new sale with its shift, and
-- restore the missing sale-side inventory movement audit trail.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
set local search_path = pg_catalog, public;

alter table public.transactions
  add column if not exists client_request_id uuid,
  add column if not exists client_request_fingerprint text,
  add column if not exists client_created_at timestamptz,
  add column if not exists shift_id uuid,
  add column if not exists source_device_id varchar(100);

create unique index if not exists transactions_client_request_unique
  on public.transactions (tenant_id, client_request_id)
  where client_request_id is not null;

create index if not exists transactions_shift_created_idx
  on public.transactions (tenant_id, shift_id, created_at desc)
  where shift_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and conname = 'transactions_client_request_fingerprint_format'
  ) then
    alter table public.transactions
      add constraint transactions_client_request_fingerprint_format
      check (
        client_request_fingerprint is null
        or client_request_fingerprint ~ '^[0-9a-f]{64}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and conname = 'fk_transactions_shift_same_tenant'
  ) then
    alter table public.transactions
      add constraint fk_transactions_shift_same_tenant
      foreign key (tenant_id, shift_id)
      references public.shifts (tenant_id, id)
      not valid;
  end if;
end
$$;

alter table public.transactions
  validate constraint transactions_client_request_fingerprint_format;

alter table public.transactions
  validate constraint fk_transactions_shift_same_tenant;

-- Earlier POS sales changed garments to sold but did not append the matching
-- stock movement. Rebuild only the unambiguous, serialized historical records.
insert into public.stock_movements (
  tenant_id,
  garment_serial,
  movement_type,
  from_location_id,
  to_location_id,
  from_status,
  to_status,
  actor_id,
  device_id,
  transaction_id,
  notes,
  created_at
)
select
  transaction.tenant_id,
  item.garment_serial,
  'SALE',
  transaction.location_id,
  null,
  'in_stock',
  'sold',
  transaction.cashier_id,
  'historical-pos-repair',
  transaction.id,
  'Backfilled from serialized POS transaction ' || transaction.receipt_number,
  transaction.created_at
from public.transaction_items as item
join public.transactions as transaction on transaction.id = item.transaction_id
join public.garments as garment
  on garment.tenant_id = transaction.tenant_id
 and garment.serial = item.garment_serial
where item.garment_serial is not null
  and garment.status = 'sold'
  and not exists (
    select 1
    from public.stock_movements as existing
    where existing.tenant_id = transaction.tenant_id
      and existing.transaction_id = transaction.id
      and existing.garment_serial = item.garment_serial
      and existing.movement_type = 'SALE'
  );

create unique index if not exists stock_movements_sale_once
  on public.stock_movements (tenant_id, transaction_id, garment_serial)
  where movement_type = 'SALE' and transaction_id is not null;

comment on column public.transactions.client_request_id is
  'Client-generated UUID that makes POS retries and offline synchronization exactly-once per tenant.';

comment on column public.transactions.client_request_fingerprint is
  'SHA-256 fingerprint of immutable sale intent; prevents reuse of an idempotency key for a different sale.';

comment on column public.transactions.client_created_at is
  'Device timestamp when the cashier accepted an offline-capable sale.';

comment on column public.transactions.shift_id is
  'Operational shift that accepted the sale, including sales synchronized after a transient outage.';

comment on column public.transactions.source_device_id is
  'Non-secret installation identifier used to diagnose offline POS synchronization.';

commit;
