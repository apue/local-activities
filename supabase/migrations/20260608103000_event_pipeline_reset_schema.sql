-- Event Pipeline Reset schema.
-- This migration is intentionally the new baseline for the capture worker ->
-- Supabase Storage -> Supabase Edge Function -> Supabase DB pipeline.

create extension if not exists pgcrypto;

drop table if exists public.evaluation_case_results cascade;
drop table if exists public.evaluation_runs cascade;
drop table if exists public.dedupe_decisions cascade;
drop table if exists public.processing_ledger cascade;
drop table if exists public.llm_usage_ledger cascade;
drop table if exists public.excluded_articles cascade;
drop table if exists public.event_drafts cascade;
drop table if exists public.canonical_events cascade;
drop table if exists public.evidence_assets cascade;
drop table if exists public.article_bundles cascade;
drop table if exists public.article_snapshots cascade;
drop table if exists public.collector_failures cascade;
drop table if exists public.source_runs cascade;
drop table if exists public.collector_jobs cascade;
drop table if exists public.source_channels cascade;

create table public.source_channels (
  id bigint generated always as identity primary key,
  source_id text not null default ('source-' || gen_random_uuid()::text),
  source_provider text not null default 'wechat2rss',
  source_name text,
  source_url text,
  external_id text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'login_required', 'captcha_required', 'unsupported')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_failure_reason text,
  diagnostics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id),
  unique (source_provider, external_id)
);

create table public.collector_jobs (
  id bigint generated always as identity primary key,
  job_id text not null default ('job-' || gen_random_uuid()::text),
  seed_url text not null,
  state text not null default 'queued'
    check (state in ('queued', 'claimed', 'running', 'completed', 'partial', 'failed', 'cancelled', 'expired')),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  collector_id text,
  local_run_id text,
  attempt_number integer not null default 0,
  last_heartbeat_at timestamptz,
  last_heartbeat_stage text check (last_heartbeat_stage in ('capturing', 'extracting', 'uploading')),
  suggested_disposition text
    check (suggested_disposition in ('ready_for_review', 'needs_review', 'needs_info', 'failed', 'not_activity')),
  source_run_id text,
  article_snapshot_ids text[] not null default '{}'::text[],
  event_draft_ids text[] not null default '{}'::text[],
  evidence_asset_ids text[] not null default '{}'::text[],
  failure_ids text[] not null default '{}'::text[],
  result_message text,
  finished_at timestamptz,
  preferred_runner text not null default 'external_capture_worker',
  actual_runner text,
  runner_state text not null default 'external_pending',
  fallback_eligible boolean not null default false,
  fallback_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id)
);

create table public.source_runs (
  id bigint generated always as identity primary key,
  run_id text not null default ('run-' || gen_random_uuid()::text),
  source_id text,
  seed_url text,
  status text not null check (status in ('success', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checked_url_count integer not null default 0,
  article_count integer not null default 0,
  draft_count integer not null default 0,
  failure_count integer not null default 0,
  failure_reason text,
  diagnostics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id)
);

create table public.collector_failures (
  id bigint generated always as identity primary key,
  failure_id text not null default ('failure-' || gen_random_uuid()::text),
  source_id text,
  article_url text,
  stage text not null
    check (stage in ('source_discovery', 'page_fetch', 'dom_parse', 'image_capture', 'bundle_validation', 'analysis')),
  reason text not null,
  message text not null,
  retryable boolean not null default false,
  screenshot_asset_id text,
  diagnostics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (failure_id)
);

create table public.article_bundles (
  id bigint generated always as identity primary key,
  bundle_id text not null,
  bundle_version text not null default 'article-bundle-v1',
  source_provider text not null default 'wechat2rss',
  source_id text,
  source_name text,
  source_url text not null,
  canonical_url text not null,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  content_hash text not null,
  storage_bucket text not null default 'article-bundles',
  storage_prefix text not null,
  image_count integer not null default 0,
  link_count integer not null default 0,
  diagnostics jsonb not null default '[]'::jsonb,
  mode text not null default 'production' check (mode in ('production', 'eval')),
  status text not null default 'captured'
    check (status in ('captured', 'analysis_started', 'processed', 'failed', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bundle_id),
  unique (source_url, content_hash, mode)
);

create table public.article_snapshots (
  id bigint generated always as identity primary key,
  snapshot_id text not null default ('snapshot-' || gen_random_uuid()::text),
  source_id text,
  source_name text,
  canonical_url text not null,
  final_url text,
  title text,
  author_name text,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  language_hints text[] not null default '{}'::text[],
  capture_mode text,
  visible_text text,
  text_hash text,
  screenshot_asset_id text,
  evidence_asset_ids text[] not null default '{}'::text[],
  content_hash text,
  bundle_id text references public.article_bundles(bundle_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (snapshot_id)
);

create table public.evidence_assets (
  id bigint generated always as identity primary key,
  asset_id text not null,
  article_url text not null,
  bundle_id text references public.article_bundles(bundle_id) on delete set null,
  role text not null
    check (role in ('cover', 'poster', 'qr', 'registration', 'screenshot', 'article_image', 'ocr_text', 'visual_analysis_summary')),
  media_type text not null check (media_type in ('image', 'text', 'html_summary')),
  source_url text,
  storage_bucket text not null default 'event-evidence-assets',
  storage_path text,
  public_url text,
  width integer,
  height integer,
  content_hash text not null,
  text_content text,
  extracted_by text check (extracted_by in ('dom', 'ocr', 'vision', 'manual')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id)
);

create table public.event_drafts (
  id bigint generated always as identity primary key,
  draft_id text not null,
  article_url text not null,
  bundle_id text references public.article_bundles(bundle_id) on delete set null,
  title text,
  original_title text,
  organizer text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Asia/Shanghai',
  city text not null default 'Beijing',
  venue_name text,
  venue_address text,
  reservation_status text check (reservation_status in ('required', 'not_required', 'unknown')),
  registration_action text,
  registration_url text,
  schedule_text text,
  poster_image_url text,
  poster_image_alt text,
  poster_image_source_url text,
  registration_qr_image_url text,
  registration_qr_image_alt text,
  summary text,
  entry_notes text,
  triage_decision text
    check (triage_decision in ('public_activity', 'possible_public_activity', 'official_visit', 'non_public_news', 'internal_or_private', 'not_event', 'unsupported')),
  triage_action text check (triage_action in ('extract', 'exclude', 'review')),
  triage_confidence numeric check (triage_confidence is null or (triage_confidence >= 0 and triage_confidence <= 1)),
  public_signals text[] not null default '{}'::text[],
  exclusion_signals text[] not null default '{}'::text[],
  public_eligibility text check (public_eligibility in ('public', 'not_public', 'unclear')),
  event_kind text
    check (event_kind in ('single', 'multi_day', 'long_running', 'recurring', 'news', 'visit', 'cancellation', 'unsupported')),
  schedule_kind text check (schedule_kind in ('single', 'multi_day', 'long_running', 'recurring', 'unsupported')),
  recurrence_rule text,
  occurrence_starts_at text[] not null default '{}'::text[],
  poster_asset_id text,
  qr_asset_id text,
  registration_qr_asset_id text,
  hard_blockers jsonb not null default '[]'::jsonb,
  soft_blockers jsonb not null default '[]'::jsonb,
  operator_override_reason text,
  resolution_decision text
    check (resolution_decision in ('new_event', 'same_event', 'update_existing', 'cancel_existing', 'withdraw_existing', 'not_public_activity', 'insufficient_info')),
  canonical_event_id text,
  processing_state text not null default 'draft'
    check (processing_state in ('draft', 'ready_for_policy', 'blocked', 'auto_published', 'published', 'rejected')),
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  review_state text not null default 'needs_review'
    check (review_state in ('needs_review', 'needs_info', 'possible_duplicate', 'ready_for_review', 'approved', 'rejected')),
  evidence_asset_ids text[] not null default '{}'::text[],
  field_evidence jsonb not null default '{}'::jsonb,
  prompt_version text,
  schema_version text,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (draft_id)
);

create table public.canonical_events (
  id bigint generated always as identity primary key,
  event_id text not null,
  title text not null,
  organizer text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'Asia/Shanghai',
  city text not null default 'Beijing',
  venue_name text,
  venue_address text,
  reservation_status text not null default 'unknown'
    check (reservation_status in ('required', 'not_required', 'unknown')),
  registration_action text,
  registration_url text,
  source_url text not null,
  schedule_text text,
  triage_decision text,
  public_eligibility text check (public_eligibility in ('public', 'not_public', 'unclear')),
  event_kind text
    check (event_kind in ('single', 'multi_day', 'long_running', 'recurring', 'news', 'visit', 'cancellation', 'unsupported')),
  schedule_kind text check (schedule_kind in ('single', 'multi_day', 'long_running', 'recurring', 'unsupported')),
  recurrence_rule text,
  occurrence_starts_at text[] not null default '{}'::text[],
  poster_asset_id text,
  qr_asset_id text,
  registration_qr_asset_id text,
  hard_blockers jsonb not null default '[]'::jsonb,
  soft_blockers jsonb not null default '[]'::jsonb,
  operator_override_reason text,
  resolution_decision text
    check (resolution_decision in ('new_event', 'same_event', 'update_existing', 'cancel_existing', 'withdraw_existing', 'not_public_activity', 'insufficient_info')),
  poster_image_url text,
  poster_image_alt text,
  poster_image_source_url text,
  registration_qr_image_url text,
  registration_qr_image_alt text,
  summary text,
  entry_notes text,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled', 'withdrawn')),
  review_state text not null default 'needs_review'
    check (review_state in ('needs_review', 'needs_info', 'possible_duplicate', 'approved', 'rejected')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id)
);

create table public.excluded_articles (
  id bigint generated always as identity primary key,
  excluded_article_id text not null,
  article_url text not null,
  bundle_id text references public.article_bundles(bundle_id) on delete set null,
  triage_decision text not null,
  triage_action text not null default 'exclude' check (triage_action = 'exclude'),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  public_signals text[] not null default '{}'::text[],
  exclusion_signals text[] not null default '{}'::text[],
  exclusion_reason text not null,
  evidence_asset_ids text[] not null default '{}'::text[],
  prompt_version text not null,
  schema_version text not null,
  provider text not null,
  model text not null,
  processing_state text not null default 'excluded'
    check (processing_state in ('excluded', 'promoted_to_extraction')),
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (excluded_article_id)
);

create table public.llm_usage_ledger (
  id bigint generated always as identity primary key,
  usage_id text not null,
  recorded_at timestamptz not null default now(),
  operation text not null,
  provider text not null,
  model text not null,
  status text not null check (status in ('succeeded', 'failed')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  reasoning_output_tokens integer not null default 0,
  cost_micro_cny bigint not null default 0,
  latency_ms integer,
  source_run_id text,
  collector_job_id text,
  article_snapshot_id text,
  event_draft_id text,
  excluded_article_id text,
  article_bundle_id text references public.article_bundles(bundle_id) on delete set null,
  evaluation_run_id text,
  mode text not null default 'production' check (mode in ('production', 'eval')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (usage_id)
);

create table public.processing_ledger (
  id bigint generated always as identity primary key,
  ledger_id text not null default ('ledger-' || gen_random_uuid()::text),
  article_bundle_id text references public.article_bundles(bundle_id) on delete set null,
  source_url text not null,
  content_hash text,
  state text not null
    check (state in ('captured', 'analysis_started', 'published', 'needs_review', 'needs_info', 'excluded', 'duplicate', 'failed')),
  decision text,
  reason text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  usage_id text,
  draft_id text,
  canonical_event_id text,
  excluded_article_id text,
  mode text not null default 'production' check (mode in ('production', 'eval')),
  error_details jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (ledger_id)
);

create table public.dedupe_decisions (
  id bigint generated always as identity primary key,
  dedupe_id text not null default ('dedupe-' || gen_random_uuid()::text),
  article_bundle_id text references public.article_bundles(bundle_id) on delete set null,
  draft_id text,
  canonical_event_id text,
  decision text not null
    check (decision in ('new_event', 'same_event', 'update_existing', 'cancel_existing', 'withdraw_existing', 'insufficient_info')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  candidate_count integer not null default 0,
  candidates jsonb not null default '[]'::jsonb,
  reasoning text,
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  created_at timestamptz not null default now(),
  unique (dedupe_id)
);

create table public.evaluation_runs (
  id bigint generated always as identity primary key,
  run_id text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  schema_version text not null,
  parameters jsonb not null default '{}'::jsonb,
  corpus_version text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  case_count integer not null default 0,
  pass_count integer not null default 0,
  fail_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  artifact_bucket text not null default 'eval-artifacts',
  artifact_path text,
  created_at timestamptz not null default now(),
  unique (run_id)
);

create table public.evaluation_case_results (
  id bigint generated always as identity primary key,
  result_id text not null default ('eval-result-' || gen_random_uuid()::text),
  run_id text not null references public.evaluation_runs(run_id) on delete cascade,
  case_id text not null,
  article_bundle_id text references public.article_bundles(bundle_id) on delete set null,
  expected_action text,
  actual_action text,
  passed boolean not null default false,
  scores jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  usage_id text,
  artifact_path text,
  created_at timestamptz not null default now(),
  unique (run_id, case_id),
  unique (result_id)
);

create index article_bundles_source_url_idx on public.article_bundles (source_url);
create index article_bundles_content_hash_idx on public.article_bundles (content_hash);
create index article_bundles_mode_status_idx on public.article_bundles (mode, status);
create index processing_ledger_bundle_idx on public.processing_ledger (article_bundle_id);
create index processing_ledger_state_created_idx on public.processing_ledger (state, created_at desc);
create index event_drafts_review_created_idx on public.event_drafts (review_state, created_at desc);
create index event_drafts_article_url_idx on public.event_drafts (article_url);
create index canonical_events_public_idx on public.canonical_events (status, starts_at);
create index canonical_events_source_url_idx on public.canonical_events (source_url);
create index evidence_assets_asset_id_idx on public.evidence_assets (asset_id);
create index evidence_assets_article_url_idx on public.evidence_assets (article_url);
create index excluded_articles_state_created_idx on public.excluded_articles (processing_state, created_at desc);
create index llm_usage_recorded_idx on public.llm_usage_ledger (recorded_at desc);
create index llm_usage_mode_idx on public.llm_usage_ledger (mode, operation);
create index dedupe_decisions_draft_idx on public.dedupe_decisions (draft_id);
create index evaluation_case_results_run_idx on public.evaluation_case_results (run_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger source_channels_set_updated_at
before update on public.source_channels
for each row execute function public.set_updated_at();

create trigger collector_jobs_set_updated_at
before update on public.collector_jobs
for each row execute function public.set_updated_at();

create trigger source_runs_set_updated_at
before update on public.source_runs
for each row execute function public.set_updated_at();

create trigger article_bundles_set_updated_at
before update on public.article_bundles
for each row execute function public.set_updated_at();

create trigger evidence_assets_set_updated_at
before update on public.evidence_assets
for each row execute function public.set_updated_at();

create trigger event_drafts_set_updated_at
before update on public.event_drafts
for each row execute function public.set_updated_at();

create trigger canonical_events_set_updated_at
before update on public.canonical_events
for each row execute function public.set_updated_at();

create trigger excluded_articles_set_updated_at
before update on public.excluded_articles
for each row execute function public.set_updated_at();

alter table public.source_channels enable row level security;
alter table public.collector_jobs enable row level security;
alter table public.source_runs enable row level security;
alter table public.collector_failures enable row level security;
alter table public.article_bundles enable row level security;
alter table public.article_snapshots enable row level security;
alter table public.evidence_assets enable row level security;
alter table public.event_drafts enable row level security;
alter table public.canonical_events enable row level security;
alter table public.excluded_articles enable row level security;
alter table public.llm_usage_ledger enable row level security;
alter table public.processing_ledger enable row level security;
alter table public.dedupe_decisions enable row level security;
alter table public.evaluation_runs enable row level security;
alter table public.evaluation_case_results enable row level security;

create policy "published canonical events are publicly readable"
on public.canonical_events
for select
to anon, authenticated
using (
  status = 'published'
  and coalesce(public_eligibility, 'public') <> 'not_public'
  and coalesce(event_kind, 'single') not in ('news', 'visit', 'cancellation', 'unsupported')
);

grant usage on schema public to anon, authenticated;
grant select on public.canonical_events to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('article-bundles', 'article-bundles', false, 52428800, array['application/json', 'text/html', 'text/plain', 'image/png', 'image/jpeg', 'image/webp', 'application/zip']),
  ('event-evidence-assets', 'event-evidence-assets', true, 20971520, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'application/json']),
  ('eval-artifacts', 'eval-artifacts', false, 52428800, array['application/json', 'text/plain', 'text/html', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

drop policy if exists "event evidence assets are publicly readable" on storage.objects;
drop policy if exists "service role can manage event pipeline storage" on storage.objects;

create policy "event evidence assets are publicly readable"
on storage.objects
for select
to public
using (bucket_id = 'event-evidence-assets');

create policy "service role can manage event pipeline storage"
on storage.objects
for all
to service_role
using (bucket_id in ('article-bundles', 'event-evidence-assets', 'eval-artifacts'))
with check (bucket_id in ('article-bundles', 'event-evidence-assets', 'eval-artifacts'));
