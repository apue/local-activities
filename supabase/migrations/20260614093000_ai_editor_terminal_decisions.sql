alter table public.event_drafts
  drop constraint if exists event_drafts_editor_decision_check;

alter table public.event_drafts
  add constraint event_drafts_editor_decision_check
  check (
    editor_decision is null or
    editor_decision in (
      'publish',
      'discard',
      'merge',
      'update',
      'system_exception',
      'needs_exception'
    )
  );

alter table public.canonical_events
  drop constraint if exists canonical_events_editor_decision_check;

alter table public.canonical_events
  add constraint canonical_events_editor_decision_check
  check (
    editor_decision is null or
    editor_decision in (
      'publish',
      'discard',
      'merge',
      'update',
      'system_exception',
      'needs_exception'
    )
  );

alter table public.event_drafts
  drop constraint if exists event_drafts_actionability_status_check;

alter table public.event_drafts
  add constraint event_drafts_actionability_status_check
  check (
    actionability_status is null or
    actionability_status in (
      'actionable',
      'discarded',
      'merged',
      'updated',
      'system_exception',
      'needs_info',
      'not_actionable',
      'possible_duplicate'
    )
  );

alter table public.canonical_events
  drop constraint if exists canonical_events_actionability_status_check;

alter table public.canonical_events
  add constraint canonical_events_actionability_status_check
  check (
    actionability_status is null or
    actionability_status in (
      'actionable',
      'discarded',
      'merged',
      'updated',
      'system_exception',
      'needs_info',
      'not_actionable',
      'possible_duplicate'
    )
  );

comment on column public.event_drafts.editor_decision is
  'AI Editor terminal decision for this extracted event: publish, discard, merge, update, or system_exception. needs_exception is kept only for legacy rows.';

comment on column public.event_drafts.exception_reason_codes is
  'Machine-readable reason codes for non-publish terminal decisions or system exceptions. Legacy name retained for compatibility.';

comment on column public.canonical_events.editor_decision is
  'AI Editor terminal decision that allowed this canonical event publication.';
