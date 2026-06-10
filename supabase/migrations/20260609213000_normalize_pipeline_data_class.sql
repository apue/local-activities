-- Normalize pipeline data separation around a first-class data_class scope.
-- Existing hosted rows are backfilled from the older mode column when present.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'source_channels',
    'collector_jobs',
    'source_runs',
    'collector_failures',
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
      'alter table public.%I add column if not exists data_class text not null default %L',
      table_name,
      'production'
    );
    execute format(
      'alter table public.%I drop constraint if exists %I',
      table_name,
      table_name || '_data_class_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (data_class in (''production'', ''eval'', ''test'', ''smoke''))',
      table_name,
      table_name || '_data_class_check'
    );
  end loop;

  foreach table_name in array array[
    'evaluation_runs',
    'evaluation_case_results'
  ] loop
    execute format(
      'alter table public.%I add column if not exists data_class text not null default %L',
      table_name,
      'eval'
    );
    execute format(
      'alter table public.%I drop constraint if exists %I',
      table_name,
      table_name || '_data_class_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (data_class in (''production'', ''eval'', ''test'', ''smoke''))',
      table_name,
      table_name || '_data_class_check'
    );
  end loop;
end $$;

update public.article_bundles
set data_class = mode
where mode in ('production', 'eval');

update public.llm_usage_ledger
set data_class = mode
where mode in ('production', 'eval');

update public.processing_ledger
set data_class = mode
where mode in ('production', 'eval');

update public.evaluation_runs
set data_class = 'eval';

update public.evaluation_case_results
set data_class = 'eval';

alter table public.article_bundles
  drop constraint if exists article_bundles_source_url_content_hash_mode_key;

alter table public.article_bundles
  drop constraint if exists article_bundles_source_url_content_hash_data_class_key;

alter table public.article_bundles
  add constraint article_bundles_source_url_content_hash_data_class_key
  unique (source_url, content_hash, data_class);

alter table public.evaluation_case_results
  drop constraint if exists evaluation_case_results_run_id_case_id_key;

alter table public.evaluation_case_results
  drop constraint if exists evaluation_case_results_run_id_case_id_data_class_key;

alter table public.evaluation_case_results
  add constraint evaluation_case_results_run_id_case_id_data_class_key
  unique (run_id, case_id, data_class);

create index if not exists article_bundles_data_class_status_idx
  on public.article_bundles (data_class, status);

create index if not exists processing_ledger_data_class_state_created_idx
  on public.processing_ledger (data_class, state, created_at desc);

create index if not exists event_drafts_data_class_review_created_idx
  on public.event_drafts (data_class, review_state, created_at desc);

create index if not exists canonical_events_data_class_public_idx
  on public.canonical_events (data_class, status, starts_at);

create index if not exists evidence_assets_data_class_asset_id_idx
  on public.evidence_assets (data_class, asset_id);

create index if not exists excluded_articles_data_class_state_created_idx
  on public.excluded_articles (data_class, processing_state, created_at desc);

create index if not exists dedupe_decisions_data_class_draft_idx
  on public.dedupe_decisions (data_class, draft_id);

create index if not exists llm_usage_data_class_recorded_idx
  on public.llm_usage_ledger (data_class, recorded_at desc);

create index if not exists evaluation_runs_data_class_validity_started_idx
  on public.evaluation_runs (data_class, validity, started_at desc);

alter table public.article_bundles
  drop column if exists mode;

alter table public.llm_usage_ledger
  drop column if exists mode;

alter table public.processing_ledger
  drop column if exists mode;

drop policy if exists "published canonical events are publicly readable" on public.canonical_events;

create policy "published production canonical events are publicly readable"
on public.canonical_events
for select
to anon, authenticated
using (
  data_class = 'production'
  and status = 'published'
  and coalesce(public_eligibility, 'public') <> 'not_public'
  and coalesce(event_kind, 'single') not in ('news', 'visit', 'cancellation', 'unsupported')
);

drop policy if exists "event evidence assets are publicly readable" on storage.objects;

create policy "production event evidence assets are publicly readable"
on storage.objects
for select
to public
using (
  bucket_id = 'event-evidence-assets'
  and name like 'production/%'
);
