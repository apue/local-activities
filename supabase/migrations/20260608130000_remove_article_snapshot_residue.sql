-- Remove pre-reset article snapshot residue from hosted projects that already
-- applied the reset baseline before the bundle-only cleanup.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'collector_jobs'
      and column_name = 'article_snapshot_ids'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'collector_jobs'
      and column_name = 'article_bundle_ids'
  ) then
    alter table public.collector_jobs
      rename column article_snapshot_ids to article_bundle_ids;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'collector_jobs'
      and column_name = 'local_run_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'collector_jobs'
      and column_name = 'capture_run_id'
  ) then
    alter table public.collector_jobs
      rename column local_run_id to capture_run_id;
  end if;
end $$;

alter table if exists public.llm_usage_ledger
  drop column if exists article_snapshot_id;

drop table if exists public.article_snapshots cascade;
