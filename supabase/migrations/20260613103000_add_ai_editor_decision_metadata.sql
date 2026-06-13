alter table public.event_drafts
  add column if not exists editor_decision text,
  add column if not exists editor_reason text,
  add column if not exists exception_reason_codes text[] not null default '{}',
  add column if not exists actionability_status text,
  add column if not exists editor_version text;

alter table public.canonical_events
  add column if not exists editor_decision text,
  add column if not exists editor_reason text,
  add column if not exists exception_reason_codes text[] not null default '{}',
  add column if not exists actionability_status text,
  add column if not exists editor_version text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_drafts_editor_decision_check'
  ) then
    alter table public.event_drafts
      add constraint event_drafts_editor_decision_check
      check (editor_decision is null or editor_decision in ('publish', 'needs_exception'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'canonical_events_editor_decision_check'
  ) then
    alter table public.canonical_events
      add constraint canonical_events_editor_decision_check
      check (editor_decision is null or editor_decision in ('publish', 'needs_exception'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_drafts_actionability_status_check'
  ) then
    alter table public.event_drafts
      add constraint event_drafts_actionability_status_check
      check (
        actionability_status is null or
        actionability_status in ('actionable', 'needs_info', 'not_actionable', 'possible_duplicate')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'canonical_events_actionability_status_check'
  ) then
    alter table public.canonical_events
      add constraint canonical_events_actionability_status_check
      check (
        actionability_status is null or
        actionability_status in ('actionable', 'needs_info', 'not_actionable', 'possible_duplicate')
      );
  end if;
end $$;

create index if not exists event_drafts_data_class_editor_exception_idx
  on public.event_drafts(data_class, editor_decision, actionability_status, created_at desc);

create index if not exists event_drafts_exception_reason_codes_idx
  on public.event_drafts using gin(exception_reason_codes);

comment on column public.event_drafts.editor_decision is
  'AI Editor policy decision for this extracted event draft.';
comment on column public.event_drafts.exception_reason_codes is
  'Machine-readable exception reasons when AI Editor does not publish.';
comment on column public.canonical_events.editor_decision is
  'AI Editor policy decision that allowed this canonical event publication.';
