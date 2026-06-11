create table public.admin_feedback_ledger (
  id bigint generated always as identity primary key,
  feedback_id text not null unique,
  data_class text not null default 'production',
  feedback_type text not null,
  pipeline_run_id text references public.pipeline_runs(run_id) on delete set null,
  article_bundle_id text references public.article_bundles(bundle_id) on delete set null,
  draft_id text references public.event_drafts(draft_id) on delete set null,
  event_id text references public.canonical_events(event_id) on delete set null,
  field_name text,
  old_value jsonb,
  corrected_value jsonb,
  reason text,
  created_by text not null,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_feedback_ledger_data_class_check
    check (data_class in ('production', 'eval', 'test', 'smoke')),
  constraint admin_feedback_ledger_feedback_type_check
    check (feedback_type in ('not_event', 'not_public', 'should_publish', 'missing_event', 'wrong_time', 'wrong_location', 'missing_registration', 'missing_qr', 'duplicate_event', 'bad_summary', 'bad_category_or_tags', 'other')),
  constraint admin_feedback_ledger_status_check
    check (status in ('open', 'triaged', 'resolved', 'dismissed'))
);

create index admin_feedback_ledger_data_class_created_idx
  on public.admin_feedback_ledger (data_class, created_at desc);

create index admin_feedback_ledger_draft_created_idx
  on public.admin_feedback_ledger (draft_id, created_at desc);

create index admin_feedback_ledger_event_created_idx
  on public.admin_feedback_ledger (event_id, created_at desc);

create index admin_feedback_ledger_article_created_idx
  on public.admin_feedback_ledger (article_bundle_id, created_at desc);

create index admin_feedback_ledger_run_created_idx
  on public.admin_feedback_ledger (pipeline_run_id, created_at desc);

create index admin_feedback_ledger_status_created_idx
  on public.admin_feedback_ledger (status, created_at desc);

create or replace function public.validate_admin_feedback_data_class()
returns trigger
language plpgsql
as $$
begin
  if new.pipeline_run_id is not null and not exists (
    select 1
    from public.pipeline_runs
    where run_id = new.pipeline_run_id
      and data_class = new.data_class
  ) then
    raise exception 'admin_feedback_data_class_mismatch:pipeline_run_id:%', new.pipeline_run_id;
  end if;

  if new.article_bundle_id is not null and not exists (
    select 1
    from public.article_bundles
    where bundle_id = new.article_bundle_id
      and data_class = new.data_class
  ) then
    raise exception 'admin_feedback_data_class_mismatch:article_bundle_id:%', new.article_bundle_id;
  end if;

  if new.draft_id is not null and not exists (
    select 1
    from public.event_drafts
    where draft_id = new.draft_id
      and data_class = new.data_class
  ) then
    raise exception 'admin_feedback_data_class_mismatch:draft_id:%', new.draft_id;
  end if;

  if new.event_id is not null and not exists (
    select 1
    from public.canonical_events
    where event_id = new.event_id
      and data_class = new.data_class
  ) then
    raise exception 'admin_feedback_data_class_mismatch:event_id:%', new.event_id;
  end if;

  return new;
end;
$$;

create trigger admin_feedback_ledger_validate_data_class
before insert or update on public.admin_feedback_ledger
for each row execute function public.validate_admin_feedback_data_class();

create trigger admin_feedback_ledger_set_updated_at
before update on public.admin_feedback_ledger
for each row execute function public.set_updated_at();

alter table public.admin_feedback_ledger enable row level security;
