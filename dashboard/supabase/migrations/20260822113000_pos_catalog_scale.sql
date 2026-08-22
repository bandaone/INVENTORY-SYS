-- Keep POS catalog lookup and keyset pagination predictable as stores grow to
-- tens of thousands of serialized garments.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
set local search_path = pg_catalog, public, extensions;

create extension if not exists pg_trgm with schema extensions;

create index if not exists garments_pos_stock_idx
  on public.garments (tenant_id, location_id, variant_id)
  include (barcode_token)
  where status = 'in_stock';

create index if not exists garments_pos_barcode_idx
  on public.garments (tenant_id, location_id, lower(barcode_token))
  where status = 'in_stock' and barcode_token is not null;

create index if not exists garments_pos_source_code_idx
  on public.garments (tenant_id, location_id, lower(source_code))
  where status = 'in_stock' and source_code is not null;

create index if not exists garments_pos_search_trgm_idx
  on public.garments using gin (lower(search_text) extensions.gin_trgm_ops)
  where status = 'in_stock' and search_text is not null;

create index if not exists variants_pos_page_idx
  on public.variants (tenant_id, lower(name), id);

create index if not exists variants_pos_search_trgm_idx
  on public.variants using gin (lower(search_text) extensions.gin_trgm_ops)
  where search_text is not null;

commit;
