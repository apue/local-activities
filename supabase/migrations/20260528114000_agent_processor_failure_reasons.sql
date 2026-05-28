alter table public.source_runs
  drop constraint if exists source_runs_failure_reason_check;

alter table public.source_runs
  add constraint source_runs_failure_reason_check
  check (
    failure_reason is null
    or failure_reason in (
      'fetch_blocked',
      'fetch_timeout',
      'login_required',
      'captcha_required',
      'parser_mismatch',
      'source_identity_missing',
      'activity_fields_missing',
      'image_download_failed',
      'ocr_failed',
      'vision_failed',
      'agent_config_missing',
      'agent_request_failed',
      'agent_response_invalid_schema',
      'not_activity',
      'unsupported'
    )
  );

alter table public.collector_failures
  drop constraint if exists collector_failures_stage_check;

alter table public.collector_failures
  add constraint collector_failures_stage_check
  check (
    stage in (
      'source_discovery',
      'page_fetch',
      'dom_parse',
      'image_capture',
      'ocr',
      'vision_extraction',
      'agent_extraction',
      'draft_extraction',
      'upload'
    )
  );

alter table public.collector_failures
  drop constraint if exists collector_failures_reason_check;

alter table public.collector_failures
  add constraint collector_failures_reason_check
  check (
    reason in (
      'fetch_blocked',
      'fetch_timeout',
      'login_required',
      'captcha_required',
      'parser_mismatch',
      'source_identity_missing',
      'activity_fields_missing',
      'image_download_failed',
      'ocr_failed',
      'vision_failed',
      'agent_config_missing',
      'agent_request_failed',
      'agent_response_invalid_schema',
      'not_activity',
      'unsupported'
    )
  );
