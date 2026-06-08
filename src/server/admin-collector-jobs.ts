export type AdminCollectorJobState =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "expired";

export type AdminCollectorJobRunner =
  | "external_capture_worker"
  | "local_collector";

export type AdminCollectorJobRunnerState =
  | "external_pending"
  | "external_running"
  | "local_pending"
  | "local_claimed"
  | "local_running"
  | "completed"
  | "failed";

export type AdminCollectorJobFallbackReason =
  | "captcha_required"
  | "login_required"
  | "fetch_blocked"
  | "fetch_timeout"
  | "region_network_failed"
  | "analysis_config_missing"
  | "analysis_request_failed"
  | "analysis_response_invalid_schema"
  | "unsupported";

export type AdminCollectorSuggestedDisposition =
  | "ready_for_review"
  | "needs_review"
  | "needs_info"
  | "failed"
  | "not_activity";

export type AdminCollectorJobRecord = {
  id: number;
  jobId: string;
  seedUrl: string;
  sourceId?: string;
  state: AdminCollectorJobState;
  requestedAt: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
  collectorId?: string;
  localRunId?: string;
  attemptNumber: number;
  lastHeartbeatAt?: string;
  lastHeartbeatStage?: "capturing" | "extracting" | "uploading";
  suggestedDisposition?: AdminCollectorSuggestedDisposition;
  sourceRunId?: string;
  articleSnapshotIds?: string[];
  eventDraftIds?: string[];
  evidenceAssetIds?: string[];
  failureIds?: string[];
  resultMessage?: string;
  finishedAt?: string;
  preferredRunner: AdminCollectorJobRunner;
  actualRunner?: AdminCollectorJobRunner;
  runnerState: AdminCollectorJobRunnerState;
  fallbackEligible: boolean;
  fallbackReason?: AdminCollectorJobFallbackReason;
};
