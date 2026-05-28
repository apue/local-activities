alter table public.collector_jobs
  add column if not exists preferred_runner text not null default 'vercel_sandbox',
  add column if not exists actual_runner text,
  add column if not exists runner_state text not null default 'sandbox_pending',
  add column if not exists fallback_eligible boolean not null default false,
  add column if not exists fallback_reason text,
  add column if not exists sandbox_run_id text;

alter table public.collector_jobs
  drop constraint if exists collector_jobs_preferred_runner_check,
  add constraint collector_jobs_preferred_runner_check
    check (preferred_runner in ('vercel_sandbox', 'local_collector'));

alter table public.collector_jobs
  drop constraint if exists collector_jobs_actual_runner_check,
  add constraint collector_jobs_actual_runner_check
    check (actual_runner is null or actual_runner in ('vercel_sandbox', 'local_collector'));

alter table public.collector_jobs
  drop constraint if exists collector_jobs_runner_state_check,
  add constraint collector_jobs_runner_state_check
    check (runner_state in ('sandbox_pending', 'sandbox_running', 'sandbox_failed_fallback_eligible', 'local_pending', 'local_claimed', 'local_running', 'fallback_claimed', 'fallback_running', 'completed', 'failed'));

alter table public.collector_jobs
  drop constraint if exists collector_jobs_fallback_reason_check,
  add constraint collector_jobs_fallback_reason_check
    check (fallback_reason is null or fallback_reason in ('captcha_required', 'login_required', 'fetch_blocked', 'fetch_timeout', 'region_network_failed', 'sandbox_runtime_timeout', 'agent_config_missing', 'agent_request_failed', 'agent_response_invalid_schema', 'unsupported'));

update public.collector_jobs
set runner_state = case
  when state in ('completed', 'partial') then 'completed'
  when state = 'failed' then 'failed'
  when state in ('claimed', 'running') then 'local_running'
  else runner_state
end
where runner_state = 'sandbox_pending'
  and preferred_runner = 'local_collector';

create index if not exists collector_jobs_local_claim_idx
  on public.collector_jobs (requested_at)
  where state = 'queued' and (preferred_runner = 'local_collector' or fallback_eligible = true);

alter table public.source_runs
  drop constraint if exists source_runs_failure_reason_check,
  add constraint source_runs_failure_reason_check
    check (failure_reason is null or failure_reason in ('fetch_blocked', 'fetch_timeout', 'region_network_failed', 'sandbox_runtime_timeout', 'login_required', 'captcha_required', 'parser_mismatch', 'source_identity_missing', 'activity_fields_missing', 'image_download_failed', 'ocr_failed', 'vision_failed', 'agent_config_missing', 'agent_request_failed', 'agent_response_invalid_schema', 'not_activity', 'unsupported'));

alter table public.collector_failures
  drop constraint if exists collector_failures_reason_check,
  add constraint collector_failures_reason_check
    check (reason in ('fetch_blocked', 'fetch_timeout', 'region_network_failed', 'sandbox_runtime_timeout', 'login_required', 'captcha_required', 'parser_mismatch', 'source_identity_missing', 'activity_fields_missing', 'image_download_failed', 'ocr_failed', 'vision_failed', 'agent_config_missing', 'agent_request_failed', 'agent_response_invalid_schema', 'not_activity', 'unsupported'));
