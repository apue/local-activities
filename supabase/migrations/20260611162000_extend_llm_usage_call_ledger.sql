alter table public.llm_usage_ledger
  add column if not exists pipeline_run_id text,
  add column if not exists pipeline_step_id text,
  add column if not exists source_id text,
  add column if not exists source_url text,
  add column if not exists prompt_version text,
  add column if not exists schema_version text,
  add column if not exists params jsonb not null default '{}'::jsonb,
  add column if not exists error_code text,
  add column if not exists request_artifact_path text,
  add column if not exists response_artifact_path text;

create index if not exists llm_usage_agent_filter_idx
  on public.llm_usage_ledger (
    data_class,
    provider,
    model,
    operation,
    status,
    recorded_at desc
  );

create index if not exists llm_usage_article_recorded_idx
  on public.llm_usage_ledger (article_bundle_id, recorded_at desc);

create index if not exists llm_usage_source_recorded_idx
  on public.llm_usage_ledger (source_id, recorded_at desc);
