-- Resolve database-linter findings that affect tenant-scale performance and
-- function safety. Run after the containment and integrity migrations.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
set local search_path = pg_catalog, public;

-- Legacy helpers pre-date the hardened migration chain. Pin their lookup path
-- so an attacker cannot shadow an unqualified object in another schema.
do $harden_legacy_function_paths$
declare
  function_signature regprocedure;
begin
  foreach function_signature in array array[
    to_regprocedure('public.set_tenant_context(uuid)'),
    to_regprocedure('public.set_tenant_context(text)'),
    to_regprocedure('public.generate_serial()')
  ]
  loop
    if function_signature is not null then
      execute format(
        'alter function %s set search_path = pg_catalog',
        function_signature
      );
    end if;
  end loop;
end
$harden_legacy_function_paths$;

-- PostgreSQL does not automatically index referencing columns. Create a
-- covering index for every public-schema foreign key that does not already
-- have one. Composite keys are processed first so their left-most prefix can
-- satisfy compatible single-column keys without adding redundant indexes.
do $index_uncovered_foreign_keys$
declare
  foreign_key record;
  index_name text;
begin
  for foreign_key in
    select
      constraint_row.oid as constraint_oid,
      constraint_row.conrelid as table_oid,
      constraint_row.conname as constraint_name,
      relation.relname as table_name,
      namespace.nspname as schema_name,
      constraint_row.conkey as column_numbers,
      string_agg(format('%I', attribute.attname), ', ' order by key_column.ordinality) as column_list
    from pg_constraint as constraint_row
    join pg_class as relation
      on relation.oid = constraint_row.conrelid
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    cross join lateral unnest(constraint_row.conkey)
      with ordinality as key_column(attribute_number, ordinality)
    join pg_attribute as attribute
      on attribute.attrelid = constraint_row.conrelid
     and attribute.attnum = key_column.attribute_number
    where constraint_row.contype = 'f'
      and namespace.nspname = 'public'
    group by
      constraint_row.oid,
      constraint_row.conrelid,
      constraint_row.conname,
      relation.relname,
      namespace.nspname,
      constraint_row.conkey
    order by cardinality(constraint_row.conkey) desc, relation.relname, constraint_row.conname
  loop
    if exists (
      select 1
      from pg_index as index_row
      where index_row.indrelid = foreign_key.table_oid
        and index_row.indisvalid
        and index_row.indisready
        and index_row.indpred is null
        and (index_row.indkey::smallint[])[0:cardinality(foreign_key.column_numbers) - 1]
          = foreign_key.column_numbers
    ) then
      continue;
    end if;

    index_name := format(
      'idx_fk_%s_%s',
      left(foreign_key.table_name, 36),
      left(md5(foreign_key.constraint_name), 12)
    );

    execute format(
      'create index if not exists %I on %I.%I (%s)',
      index_name,
      foreign_key.schema_name,
      foreign_key.table_name,
      foreign_key.column_list
    );
  end loop;
end
$index_uncovered_foreign_keys$;

commit;
