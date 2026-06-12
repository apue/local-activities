-- Track which evaluation run produced eval-scoped pipeline rows.
-- Production rows keep eval_run_id null; eval rows may be tied to a run for preview/replay.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'article_bundles',
    'evidence_assets',
    'event_drafts',
    'canonical_events',
    'excluded_articles',
    'llm_usage_ledger',
    'processing_ledger',
    'dedupe_decisions'
  ] loop
    execute format(
      'alter table public.%I add column if not exists eval_run_id text',
      table_name
    );
    execute format(
      'alter table public.%I drop constraint if exists %I',
      table_name,
      table_name || '_eval_run_scope_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (data_class = ''eval'' or eval_run_id is null)',
      table_name,
      table_name || '_eval_run_scope_check'
    );
  end loop;
end $$;

create index if not exists canonical_events_eval_preview_idx
  on public.canonical_events (data_class, eval_run_id, status, starts_at desc)
  where data_class = 'eval';

create index if not exists event_drafts_eval_run_review_idx
  on public.event_drafts (data_class, eval_run_id, review_state, created_at desc)
  where data_class = 'eval';

create index if not exists processing_ledger_eval_run_created_idx
  on public.processing_ledger (data_class, eval_run_id, created_at desc)
  where data_class = 'eval';

create index if not exists llm_usage_ledger_eval_run_recorded_idx
  on public.llm_usage_ledger (data_class, eval_run_id, recorded_at desc)
  where data_class = 'eval';
