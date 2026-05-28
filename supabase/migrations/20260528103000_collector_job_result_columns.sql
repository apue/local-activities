alter table public.collector_jobs
  add column if not exists source_run_id text,
  add column if not exists article_snapshot_ids text[] not null default '{}',
  add column if not exists event_draft_ids text[] not null default '{}',
  add column if not exists evidence_asset_ids text[] not null default '{}',
  add column if not exists failure_ids text[] not null default '{}',
  add column if not exists finished_at timestamptz;

create index if not exists collector_jobs_finished_at_idx
  on public.collector_jobs (finished_at desc)
  where state in ('completed', 'partial', 'failed');
