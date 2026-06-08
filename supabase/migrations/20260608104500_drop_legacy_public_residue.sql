-- Remove public schema objects from the pre-reset pipeline that are not part of
-- the reset architecture.

drop table if exists public.event_mentions cascade;
drop table if exists public.event_revisions cascade;
drop table if exists public.source_posts cascade;
drop table if exists public.sources cascade;

drop function if exists public.llm_usage_ledger_no_delete() cascade;
drop function if exists public.llm_usage_ledger_no_update() cascade;
