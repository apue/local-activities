alter table public.event_drafts
  add column if not exists schedule_text text;

alter table public.canonical_events
  add column if not exists schedule_text text;

alter table public.canonical_events
  alter column organizer drop not null;

alter table public.canonical_events
  alter column reservation_status set default 'unknown';
