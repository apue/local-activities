create table if not exists public.excluded_articles (
  id bigint generated always as identity primary key,
  excluded_article_id text not null unique,
  source_id bigint references public.sources(id) on delete set null,
  source_run_id bigint references public.source_runs(id) on delete set null,
  article_snapshot_id bigint references public.article_snapshots(id) on delete set null,
  article_url text not null,
  triage_attempt_id text not null,
  triage_decision text not null
    check (triage_decision in ('official_visit', 'non_public_news', 'internal_or_private', 'not_event', 'unsupported')),
  triage_action text not null default 'exclude'
    check (triage_action = 'exclude'),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  public_signals text[] not null default '{}',
  exclusion_signals text[] not null default '{}',
  exclusion_reason text not null,
  evidence_asset_ids text[] not null default '{}',
  prompt_version text not null,
  schema_version text not null,
  provider text not null,
  model text not null,
  processing_state text not null default 'excluded'
    check (processing_state in ('excluded', 'promoted_to_extraction')),
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_url, triage_attempt_id)
);

alter table public.event_drafts
  add column if not exists triage_decision text
    check (triage_decision is null or triage_decision in ('public_activity', 'possible_public_activity', 'official_visit', 'non_public_news', 'internal_or_private', 'not_event', 'unsupported')),
  add column if not exists triage_action text
    check (triage_action is null or triage_action in ('extract', 'review', 'exclude')),
  add column if not exists triage_confidence numeric
    check (triage_confidence is null or (triage_confidence >= 0 and triage_confidence <= 1)),
  add column if not exists public_signals text[] not null default '{}',
  add column if not exists exclusion_signals text[] not null default '{}',
  add column if not exists public_eligibility text
    check (public_eligibility is null or public_eligibility in ('public', 'not_public', 'unclear')),
  add column if not exists event_kind text
    check (event_kind is null or event_kind in ('single', 'multi_day', 'long_running', 'recurring', 'news', 'visit', 'cancellation', 'unsupported')),
  add column if not exists schedule_kind text
    check (schedule_kind is null or schedule_kind in ('single', 'multi_day', 'long_running', 'recurring', 'unsupported')),
  add column if not exists recurrence_rule text,
  add column if not exists occurrence_starts_at timestamptz[],
  add column if not exists poster_asset_id text,
  add column if not exists qr_asset_id text,
  add column if not exists registration_qr_asset_id text,
  add column if not exists hard_blockers jsonb not null default '[]'::jsonb,
  add column if not exists soft_blockers jsonb not null default '[]'::jsonb,
  add column if not exists operator_override_reason text,
  add column if not exists resolution_decision text
    check (resolution_decision is null or resolution_decision in ('new_event', 'same_event', 'update_existing', 'cancel_existing', 'withdraw_existing', 'not_public_activity', 'insufficient_info')),
  add column if not exists canonical_event_id bigint references public.canonical_events(id) on delete set null,
  add column if not exists processing_state text not null default 'draft'
    check (processing_state in ('draft', 'ready_for_policy', 'blocked', 'auto_published', 'published', 'rejected'));

alter table public.canonical_events
  add column if not exists triage_decision text
    check (triage_decision is null or triage_decision in ('public_activity', 'possible_public_activity', 'official_visit', 'non_public_news', 'internal_or_private', 'not_event', 'unsupported')),
  add column if not exists public_eligibility text
    check (public_eligibility is null or public_eligibility in ('public', 'not_public', 'unclear')),
  add column if not exists event_kind text
    check (event_kind is null or event_kind in ('single', 'multi_day', 'long_running', 'recurring', 'news', 'visit', 'cancellation', 'unsupported')),
  add column if not exists schedule_kind text
    check (schedule_kind is null or schedule_kind in ('single', 'multi_day', 'long_running', 'recurring', 'unsupported')),
  add column if not exists recurrence_rule text,
  add column if not exists occurrence_starts_at timestamptz[],
  add column if not exists poster_asset_id text,
  add column if not exists qr_asset_id text,
  add column if not exists registration_qr_asset_id text,
  add column if not exists hard_blockers jsonb not null default '[]'::jsonb,
  add column if not exists soft_blockers jsonb not null default '[]'::jsonb,
  add column if not exists operator_override_reason text,
  add column if not exists resolution_decision text
    check (resolution_decision is null or resolution_decision in ('new_event', 'same_event', 'update_existing', 'cancel_existing', 'withdraw_existing', 'not_public_activity', 'insufficient_info'));

create index if not exists excluded_articles_processing_state_idx
  on public.excluded_articles (processing_state, created_at desc);
create index if not exists excluded_articles_source_run_id_idx
  on public.excluded_articles (source_run_id);
create index if not exists excluded_articles_article_snapshot_id_idx
  on public.excluded_articles (article_snapshot_id);
create index if not exists event_drafts_triage_decision_idx
  on public.event_drafts (triage_decision, created_at desc);
create index if not exists event_drafts_processing_state_idx
  on public.event_drafts (processing_state, created_at desc);
create index if not exists event_drafts_schedule_kind_idx
  on public.event_drafts (schedule_kind, starts_at);
create index if not exists event_drafts_canonical_event_id_idx
  on public.event_drafts (canonical_event_id);
create index if not exists canonical_events_schedule_kind_idx
  on public.canonical_events (schedule_kind, starts_at);
