alter table public.event_drafts
  add column if not exists registration_qr_image_url text,
  add column if not exists registration_qr_image_alt text;

alter table public.canonical_events
  add column if not exists registration_qr_image_url text,
  add column if not exists registration_qr_image_alt text;
