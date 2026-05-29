alter table public.event_drafts
  add column if not exists poster_image_url text,
  add column if not exists poster_image_alt text,
  add column if not exists poster_image_source_url text;

alter table public.canonical_events
  add column if not exists poster_image_url text,
  add column if not exists poster_image_alt text,
  add column if not exists poster_image_source_url text;
