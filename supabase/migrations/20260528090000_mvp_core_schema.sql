create table if not exists public.sources (
  id bigint generated always as identity primary key,
  source_key text not null unique,
  name text,
  homepage_url text,
  seed_url text,
  platform text not null default 'unknown',
  health_status text not null default 'checking'
    check (health_status in ('checking', 'healthy', 'attention_needed', 'unsupported', 'paused')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failure_count integer not null default 0 check (consecutive_failure_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collector_jobs (
  id bigint generated always as identity primary key,
  job_id text not null unique,
  seed_url text not null,
  source_id bigint references public.sources(id) on delete set null,
  state text not null default 'queued'
    check (state in ('queued', 'claimed', 'running', 'completed', 'partial', 'failed', 'cancelled', 'expired')),
  requested_mode text
    check (requested_mode is null or requested_mode in ('auto', 'text_only', 'image_heavy_debug')),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  collector_id text,
  local_run_id text,
  attempt_number integer not null default 0 check (attempt_number >= 0),
  last_heartbeat_at timestamptz,
  last_heartbeat_stage text
    check (last_heartbeat_stage is null or last_heartbeat_stage in ('capturing', 'extracting', 'uploading')),
  suggested_disposition text
    check (suggested_disposition is null or suggested_disposition in ('ready_for_review', 'needs_review', 'needs_info', 'failed', 'not_activity')),
  result_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_runs (
  id bigint generated always as identity primary key,
  collector_id text not null,
  run_id text not null,
  source_id bigint references public.sources(id) on delete set null,
  collector_job_id bigint references public.collector_jobs(id) on delete set null,
  seed_url text,
  status text not null check (status in ('success', 'partial', 'failed')),
  started_at timestamptz not null,
  finished_at timestamptz,
  checked_url_count integer not null default 0 check (checked_url_count >= 0),
  article_count integer not null default 0 check (article_count >= 0),
  draft_count integer not null default 0 check (draft_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  failure_reason text
    check (failure_reason is null or failure_reason in ('fetch_blocked', 'fetch_timeout', 'login_required', 'captcha_required', 'parser_mismatch', 'source_identity_missing', 'activity_fields_missing', 'image_download_failed', 'ocr_failed', 'vision_failed', 'not_activity', 'unsupported')),
  diagnostics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (collector_id, run_id)
);

create table if not exists public.source_posts (
  id bigint generated always as identity primary key,
  source_id bigint references public.sources(id) on delete set null,
  source_run_id bigint references public.source_runs(id) on delete set null,
  canonical_url text not null,
  final_url text,
  title text,
  author_name text,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  content_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.article_snapshots (
  id bigint generated always as identity primary key,
  source_id bigint references public.sources(id) on delete set null,
  source_run_id bigint references public.source_runs(id) on delete set null,
  source_post_id bigint references public.source_posts(id) on delete set null,
  canonical_url text not null,
  final_url text not null,
  title text,
  author_name text,
  published_at timestamptz,
  captured_at timestamptz not null,
  language_hints text[] not null default '{}',
  capture_mode text not null
    check (capture_mode in ('text_complete', 'text_with_qr_registration', 'image_dominant', 'image_with_qr_registration', 'not_activity', 'unsupported')),
  visible_text text,
  text_hash text,
  screenshot_asset_id text,
  evidence_asset_ids text[] not null default '{}',
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (canonical_url, content_hash)
);

create table if not exists public.evidence_assets (
  id bigint generated always as identity primary key,
  asset_id text not null unique,
  article_snapshot_id bigint references public.article_snapshots(id) on delete set null,
  article_url text not null,
  role text not null
    check (role in ('cover', 'poster', 'qr', 'registration', 'screenshot', 'article_image', 'ocr_text', 'vision_summary')),
  media_type text not null check (media_type in ('image', 'text', 'html_summary')),
  source_url text,
  storage_path text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  content_hash text not null,
  text_content text,
  extracted_by text check (extracted_by is null or extracted_by in ('dom', 'ocr', 'vision', 'manual')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  unique (article_url, role, content_hash)
);

create table if not exists public.event_drafts (
  id bigint generated always as identity primary key,
  draft_id text not null unique,
  source_id bigint references public.sources(id) on delete set null,
  source_run_id bigint references public.source_runs(id) on delete set null,
  article_snapshot_id bigint references public.article_snapshots(id) on delete set null,
  article_url text not null,
  extraction_attempt_id text not null,
  capture_mode text not null
    check (capture_mode in ('text_complete', 'text_with_qr_registration', 'image_dominant', 'image_with_qr_registration', 'not_activity', 'unsupported')),
  title text,
  original_title text,
  organizer text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Asia/Shanghai' check (timezone = 'Asia/Shanghai'),
  venue_name text,
  venue_address text,
  city text not null default 'Beijing' check (city = 'Beijing'),
  reservation_status text
    check (reservation_status is null or reservation_status in ('required', 'not_required', 'unknown')),
  registration_action text,
  registration_url text,
  summary text,
  entry_notes text,
  signals text[] not null default '{}',
  evidence_asset_ids text[] not null default '{}',
  field_evidence jsonb not null default '{}'::jsonb,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  review_state text not null default 'needs_review'
    check (review_state in ('needs_review', 'needs_info', 'possible_duplicate', 'ready_for_review', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_url, extraction_attempt_id)
);

create table if not exists public.canonical_events (
  id bigint generated always as identity primary key,
  event_id text not null unique,
  title text not null,
  organizer text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'Asia/Shanghai' check (timezone = 'Asia/Shanghai'),
  city text not null default 'Beijing' check (city = 'Beijing'),
  venue_name text,
  venue_address text,
  reservation_status text not null check (reservation_status in ('required', 'not_required', 'unknown')),
  registration_action text,
  registration_url text,
  source_url text not null,
  summary text,
  entry_notes text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'cancelled', 'withdrawn')),
  review_state text not null default 'needs_review'
    check (review_state in ('needs_review', 'needs_info', 'possible_duplicate', 'approved', 'rejected')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_mentions (
  id bigint generated always as identity primary key,
  canonical_event_id bigint not null references public.canonical_events(id) on delete cascade,
  event_draft_id bigint references public.event_drafts(id) on delete set null,
  article_snapshot_id bigint references public.article_snapshots(id) on delete set null,
  source_id bigint references public.sources(id) on delete set null,
  match_score numeric check (match_score is null or (match_score >= 0 and match_score <= 1)),
  match_reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.event_revisions (
  id bigint generated always as identity primary key,
  canonical_event_id bigint not null references public.canonical_events(id) on delete cascade,
  event_draft_id bigint references public.event_drafts(id) on delete set null,
  revision_type text not null check (revision_type in ('correction', 'update', 'cancellation', 'withdrawal')),
  proposed_changes jsonb not null,
  review_state text not null default 'needs_review'
    check (review_state in ('needs_review', 'approved', 'rejected')),
  source_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.collector_failures (
  id bigint generated always as identity primary key,
  failure_id text not null unique,
  source_id bigint references public.sources(id) on delete set null,
  source_run_id bigint references public.source_runs(id) on delete set null,
  article_url text,
  stage text not null
    check (stage in ('source_discovery', 'page_fetch', 'dom_parse', 'image_capture', 'ocr', 'vision_extraction', 'draft_extraction', 'upload')),
  reason text not null
    check (reason in ('fetch_blocked', 'fetch_timeout', 'login_required', 'captcha_required', 'parser_mismatch', 'source_identity_missing', 'activity_fields_missing', 'image_download_failed', 'ocr_failed', 'vision_failed', 'not_activity', 'unsupported')),
  message text not null,
  retryable boolean not null,
  screenshot_asset_id text,
  diagnostics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sources_health_status_idx on public.sources (health_status, updated_at desc);
create index if not exists collector_jobs_source_id_idx on public.collector_jobs (source_id);
create index if not exists collector_jobs_queued_idx on public.collector_jobs (requested_at)
  where state = 'queued';
create index if not exists collector_jobs_lease_idx on public.collector_jobs (lease_expires_at)
  where state in ('claimed', 'running');
create index if not exists source_runs_source_id_idx on public.source_runs (source_id, started_at desc);
create index if not exists source_runs_collector_job_id_idx on public.source_runs (collector_job_id);
create index if not exists source_posts_source_id_idx on public.source_posts (source_id, discovered_at desc);
create index if not exists source_posts_source_run_id_idx on public.source_posts (source_run_id);
create unique index if not exists source_posts_canonical_url_content_hash_idx
  on public.source_posts (canonical_url, coalesce(content_hash, ''));
create index if not exists article_snapshots_source_run_id_idx on public.article_snapshots (source_run_id);
create index if not exists article_snapshots_source_id_idx on public.article_snapshots (source_id, captured_at desc);
create index if not exists article_snapshots_source_post_id_idx on public.article_snapshots (source_post_id);
create index if not exists evidence_assets_article_snapshot_id_idx on public.evidence_assets (article_snapshot_id);
create index if not exists event_drafts_source_run_id_idx on public.event_drafts (source_run_id);
create index if not exists event_drafts_article_snapshot_id_idx on public.event_drafts (article_snapshot_id);
create index if not exists event_drafts_review_state_idx on public.event_drafts (created_at)
  where review_state in ('needs_review', 'needs_info', 'possible_duplicate', 'ready_for_review');
create index if not exists canonical_events_public_upcoming_idx on public.canonical_events (starts_at)
  where status = 'published';
create index if not exists event_mentions_canonical_event_id_idx on public.event_mentions (canonical_event_id);
create index if not exists event_mentions_event_draft_id_idx on public.event_mentions (event_draft_id);
create index if not exists event_mentions_article_snapshot_id_idx on public.event_mentions (article_snapshot_id);
create index if not exists event_mentions_source_id_idx on public.event_mentions (source_id);
create index if not exists event_revisions_canonical_event_id_idx on public.event_revisions (canonical_event_id);
create index if not exists event_revisions_event_draft_id_idx on public.event_revisions (event_draft_id);
create index if not exists collector_failures_source_run_id_idx on public.collector_failures (source_run_id);
create index if not exists collector_failures_source_id_idx on public.collector_failures (source_id, created_at desc);
