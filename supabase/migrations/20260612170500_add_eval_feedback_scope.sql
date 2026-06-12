alter table public.admin_feedback_ledger
  add column if not exists eval_run_id text references public.evaluation_runs(run_id) on delete set null,
  add column if not exists case_id text;

alter table public.admin_feedback_ledger
  drop constraint if exists admin_feedback_ledger_eval_case_scope_check;

alter table public.admin_feedback_ledger
  add constraint admin_feedback_ledger_eval_case_scope_check
  check (case_id is null or eval_run_id is not null);

create index if not exists admin_feedback_ledger_eval_run_created_idx
  on public.admin_feedback_ledger (data_class, eval_run_id, created_at desc)
  where eval_run_id is not null;

create index if not exists admin_feedback_ledger_eval_case_created_idx
  on public.admin_feedback_ledger (data_class, eval_run_id, case_id, created_at desc)
  where eval_run_id is not null and case_id is not null;

create or replace function public.validate_admin_feedback_data_class()
returns trigger
language plpgsql
as $$
begin
  if new.eval_run_id is not null and not exists (
    select 1
    from public.evaluation_runs
    where run_id = new.eval_run_id
      and data_class = new.data_class
  ) then
    raise exception 'admin_feedback_data_class_mismatch:eval_run_id:%', new.eval_run_id;
  end if;

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
