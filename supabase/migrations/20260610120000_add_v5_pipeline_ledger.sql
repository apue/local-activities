create table public.pipeline_runs (
  id bigint generated always as identity primary key,
  run_id text not null unique,
  data_class text not null default 'production',
  source_kind text,
  source_id text,
  article_bundle_id text references public.article_bundles(bundle_id) on delete set null,
  case_id text,
  status text not null,
  decision text,
  reason text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_runs_data_class_check
    check (data_class in ('production', 'eval', 'test', 'smoke'))
);

create table public.pipeline_steps (
  id bigint generated always as identity primary key,
  step_id text not null unique,
  run_id text not null references public.pipeline_runs(run_id) on delete cascade,
  data_class text not null default 'production',
  step_order integer not null,
  node_name text not null,
  node_version text,
  status text not null,
  decision text,
  reason text,
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  usage_id text,
  input_artifact_ids text[] not null default '{}',
  output_artifact_ids text[] not null default '{}',
  validation_issues jsonb not null default '[]'::jsonb,
  error_details jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  latency_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_steps_data_class_check
    check (data_class in ('production', 'eval', 'test', 'smoke'))
);

create table public.pipeline_artifacts (
  id bigint generated always as identity primary key,
  artifact_id text not null unique,
  run_id text not null references public.pipeline_runs(run_id) on delete cascade,
  step_id text references public.pipeline_steps(step_id) on delete set null,
  data_class text not null default 'production',
  path text not null,
  kind text not null,
  hash text,
  bucket text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_artifacts_data_class_check
    check (data_class in ('production', 'eval', 'test', 'smoke'))
);

create table public.pipeline_attempts (
  id bigint generated always as identity primary key,
  attempt_id text not null unique,
  run_id text not null references public.pipeline_runs(run_id) on delete cascade,
  step_id text not null references public.pipeline_steps(step_id) on delete cascade,
  data_class text not null default 'production',
  attempt_number integer not null,
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  usage jsonb not null default '{}'::jsonb,
  validator_issues jsonb not null default '[]'::jsonb,
  reason text,
  started_at timestamptz,
  finished_at timestamptz,
  latency_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_attempts_data_class_check
    check (data_class in ('production', 'eval', 'test', 'smoke'))
);

create index pipeline_runs_data_class_started_idx
  on public.pipeline_runs (data_class, started_at desc);

create index pipeline_runs_status_started_idx
  on public.pipeline_runs (status, started_at desc);

create index pipeline_steps_run_order_idx
  on public.pipeline_steps (run_id, step_order);

create index pipeline_steps_data_class_run_idx
  on public.pipeline_steps (data_class, run_id);

create index pipeline_artifacts_run_created_idx
  on public.pipeline_artifacts (run_id, created_at);

create index pipeline_artifacts_data_class_run_idx
  on public.pipeline_artifacts (data_class, run_id);

create index pipeline_attempts_step_attempt_idx
  on public.pipeline_attempts (step_id, attempt_number);

create index pipeline_attempts_run_created_idx
  on public.pipeline_attempts (run_id, created_at);

create index pipeline_attempts_data_class_run_idx
  on public.pipeline_attempts (data_class, run_id);

alter table public.pipeline_runs enable row level security;
alter table public.pipeline_steps enable row level security;
alter table public.pipeline_artifacts enable row level security;
alter table public.pipeline_attempts enable row level security;
