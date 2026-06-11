create table public.prompt_model_configs (
  id bigint generated always as identity primary key,
  config_id text not null unique,
  data_class text not null default 'production',
  operation text not null,
  stage text not null default 'candidate',
  provider text not null,
  model text not null,
  prompt_version text not null,
  prompt_text text not null,
  schema_version text not null,
  params jsonb not null default '{}'::jsonb,
  budget_policy jsonb not null default '{}'::jsonb,
  created_reason text not null,
  created_by text not null,
  activation_eval_run_id text,
  activation_reason text,
  activated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompt_model_configs_data_class_check
    check (data_class in ('production', 'eval', 'test', 'smoke')),
  constraint prompt_model_configs_operation_check
    check (operation in ('cheap_triage', 'full_extract', 'editor_pass', 'judge_eval', 'eval')),
  constraint prompt_model_configs_stage_check
    check (stage in ('active', 'candidate', 'archived')),
  constraint prompt_model_configs_params_object_check
    check (jsonb_typeof(params) = 'object'),
  constraint prompt_model_configs_budget_policy_object_check
    check (jsonb_typeof(budget_policy) = 'object'),
  constraint prompt_model_configs_prompt_text_required_check
    check (length(btrim(prompt_text)) > 0),
  constraint prompt_model_configs_schema_version_required_check
    check (length(btrim(schema_version)) > 0),
  constraint prompt_model_configs_activation_metadata_check
    check (
      stage <> 'active'
      or (
        activation_eval_run_id is not null
        and length(btrim(activation_eval_run_id)) > 0
        and activation_reason is not null
        and length(btrim(activation_reason)) > 0
        and activated_at is not null
      )
    )
);

create unique index prompt_model_configs_active_unique_idx
  on public.prompt_model_configs (data_class, operation)
  where stage = 'active';

create index prompt_model_configs_scope_stage_created_idx
  on public.prompt_model_configs (data_class, operation, stage, created_at desc);

create index prompt_model_configs_activation_eval_idx
  on public.prompt_model_configs (activation_eval_run_id, activated_at desc);

create trigger prompt_model_configs_set_updated_at
before update on public.prompt_model_configs
for each row execute function public.set_updated_at();

create or replace function public.activate_prompt_model_config(
  p_config_id text,
  p_data_class text,
  p_operation text,
  p_eval_run_id text,
  p_activation_reason text,
  p_activated_at timestamptz default now()
)
returns public.prompt_model_configs
language plpgsql
as $$
declare
  activated public.prompt_model_configs;
begin
  perform 1
  from public.prompt_model_configs
  where config_id = p_config_id
    and data_class = p_data_class
    and operation = p_operation
  for update;

  if not found then
    raise exception 'prompt_model_config_not_found:%', p_config_id;
  end if;

  update public.prompt_model_configs
  set stage = 'archived'
  where data_class = p_data_class
    and operation = p_operation
    and stage = 'active'
    and config_id <> p_config_id;

  update public.prompt_model_configs
  set
    stage = 'active',
    activation_eval_run_id = p_eval_run_id,
    activation_reason = p_activation_reason,
    activated_at = p_activated_at
  where config_id = p_config_id
    and data_class = p_data_class
    and operation = p_operation
  returning * into activated;

  return activated;
end;
$$;

alter table public.prompt_model_configs enable row level security;
