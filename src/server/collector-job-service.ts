import type {
  CollectorJobFallbackReason,
  CollectorJobRunner,
  CollectorJobRunnerState,
  CollectorJobState,
  SuggestedDisposition,
} from "../contracts/collector-job";

export type CollectorJobRequestedMode =
  | "auto"
  | "text_only"
  | "image_heavy_debug";

export type CollectorJobRecord = {
  id: number;
  jobId: string;
  seedUrl: string;
  sourceId?: string;
  state: CollectorJobState;
  requestedAt: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
  collectorId?: string;
  localRunId?: string;
  attemptNumber: number;
  requestedMode?: CollectorJobRequestedMode;
  lastHeartbeatAt?: string;
  lastHeartbeatStage?: "capturing" | "extracting" | "uploading";
  suggestedDisposition?: SuggestedDisposition;
  sourceRunId?: string;
  articleSnapshotIds?: string[];
  eventDraftIds?: string[];
  evidenceAssetIds?: string[];
  failureIds?: string[];
  resultMessage?: string;
  finishedAt?: string;
  preferredRunner: CollectorJobRunner;
  actualRunner?: CollectorJobRunner;
  runnerState: CollectorJobRunnerState;
  fallbackEligible: boolean;
  fallbackReason?: CollectorJobFallbackReason;
  sandboxRunId?: string;
};

export type CollectorJobStore = {
  createQueuedJob(input: {
    seedUrl: string;
    sourceId?: string;
    requestedMode?: CollectorJobRequestedMode;
    requestedAt: string;
    preferredRunner: CollectorJobRunner;
  }): Promise<CollectorJobRecord>;
  expireStaleLeases(now: string, maxAttempts: number): Promise<void>;
  claimNextQueuedJob(input: {
    collectorId: string;
    claimedAt: string;
    leaseExpiresAt: string;
    runner: CollectorJobRunner;
  }): Promise<CollectorJobRecord | null>;
  findByJobId(jobId: string): Promise<CollectorJobRecord | null>;
  updateHeartbeat(input: {
    jobId: string;
    collectorId: string;
    localRunId: string;
    stage: "capturing" | "extracting" | "uploading";
    message?: string;
    heartbeatAt: string;
    leaseExpiresAt: string;
    runnerState: CollectorJobRunnerState;
  }): Promise<CollectorJobRecord | null>;
  updateReport(input: {
    jobId: string;
    collectorId: string;
    localRunId: string;
    status: "completed" | "partial" | "failed";
    sourceRunId?: string;
    articleSnapshotIds?: string[];
    eventDraftIds?: string[];
    evidenceAssetIds?: string[];
    failureIds?: string[];
    suggestedDisposition?: SuggestedDisposition;
    message?: string;
    reportedAt: string;
  }): Promise<CollectorJobRecord | null>;
  updateSandboxStarted(input: {
    jobId: string;
    sandboxRunId: string;
    startedAt: string;
  }): Promise<CollectorJobRecord | null>;
  updateSandboxFailure(input: {
    jobId: string;
    reason: CollectorJobFallbackReason;
    message: string;
    failedAt: string;
    fallbackEligible: boolean;
    sandboxRunId?: string;
  }): Promise<CollectorJobRecord | null>;
};

export type ClaimCollectorJobResult =
  | {
      kind: "claimed";
      job: CollectorJobRecord;
    }
  | {
      kind: "none";
      retryAfterSeconds: number;
    };

export type MutateCollectorJobResult =
  | {
      kind: "updated";
      job: CollectorJobRecord;
    }
  | {
      kind: "not_found";
      error: "collector_job_not_found";
    }
  | {
      kind: "forbidden";
      error:
        | "collector_lease_mismatch"
        | "collector_job_not_active"
        | "collector_run_mismatch";
    }
  | {
      kind: "expired";
      error: "collector_lease_expired";
    };

const DEFAULT_LEASE_SECONDS = 600;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const MAX_ATTEMPTS_BEFORE_EXPIRE = 3;
const TERMINAL_STATES = new Set<CollectorJobState>([
  "completed",
  "partial",
  "failed",
  "cancelled",
  "expired",
]);
const FALLBACK_ELIGIBLE_REASONS = new Set<CollectorJobFallbackReason>([
  "captcha_required",
  "login_required",
  "fetch_blocked",
  "fetch_timeout",
  "region_network_failed",
  "sandbox_runtime_timeout",
]);

export async function createQueuedCollectorJob(
  input: {
    seedUrl: string;
    sourceId?: string;
    requestedMode?: CollectorJobRequestedMode;
    preferredRunner?: CollectorJobRunner;
  },
  store: CollectorJobStore,
  now = new Date(),
) {
  const preferredRunner = input.preferredRunner ?? "vercel_sandbox";
  return store.createQueuedJob({
    ...input,
    preferredRunner,
    requestedAt: now.toISOString(),
  });
}

export async function claimCollectorJob(
  input: {
    collectorId: string;
  },
  store: CollectorJobStore,
  now = new Date(),
): Promise<ClaimCollectorJobResult> {
  const nowIso = now.toISOString();
  await store.expireStaleLeases(nowIso, MAX_ATTEMPTS_BEFORE_EXPIRE);

  const job = await store.claimNextQueuedJob({
    collectorId: input.collectorId,
    claimedAt: nowIso,
    leaseExpiresAt: addSeconds(now, DEFAULT_LEASE_SECONDS).toISOString(),
    runner: "local_collector",
  });

  if (!job) {
    return {
      kind: "none",
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    };
  }

  return {
    kind: "claimed",
    job,
  };
}

export async function routeSandboxCollectorJobFailure(
  jobId: string,
  input: {
    reason: CollectorJobFallbackReason;
    message: string;
    sandboxRunId?: string;
  },
  store: CollectorJobStore,
  now = new Date(),
): Promise<MutateCollectorJobResult> {
  const job = await store.updateSandboxFailure({
    jobId,
    reason: input.reason,
    message: input.message,
    sandboxRunId: input.sandboxRunId,
    failedAt: now.toISOString(),
    fallbackEligible: FALLBACK_ELIGIBLE_REASONS.has(input.reason),
  });

  if (!job) {
    return {
      kind: "not_found",
      error: "collector_job_not_found",
    };
  }

  return {
    kind: "updated",
    job,
  };
}

export async function heartbeatCollectorJob(
  jobId: string,
  input: {
    collectorId: string;
    localRunId: string;
    stage: "capturing" | "extracting" | "uploading";
    message?: string;
    extendLeaseSeconds?: number;
  },
  store: CollectorJobStore,
  now = new Date(),
): Promise<MutateCollectorJobResult> {
  const existing = await store.findByJobId(jobId);
  const ownership = validateActiveOwnership(existing, input.collectorId, now);
  if (ownership) return ownership;
  const runnerState =
    existing?.fallbackEligible === true ? "fallback_running" : "local_running";

  const job = await store.updateHeartbeat({
    jobId,
    collectorId: input.collectorId,
    localRunId: input.localRunId,
    stage: input.stage,
    message: input.message,
    heartbeatAt: now.toISOString(),
    leaseExpiresAt: addSeconds(
      now,
      input.extendLeaseSeconds ?? DEFAULT_LEASE_SECONDS,
    ).toISOString(),
    runnerState,
  });

  if (!job) {
    return {
      kind: "not_found",
      error: "collector_job_not_found",
    };
  }

  return {
    kind: "updated",
    job,
  };
}

export async function startSandboxCollectorJob(
  jobId: string,
  input: {
    sandboxRunId: string;
  },
  store: CollectorJobStore,
  now = new Date(),
): Promise<MutateCollectorJobResult> {
  const job = await store.updateSandboxStarted({
    jobId,
    sandboxRunId: input.sandboxRunId,
    startedAt: now.toISOString(),
  });

  if (!job) {
    return {
      kind: "not_found",
      error: "collector_job_not_found",
    };
  }

  return {
    kind: "updated",
    job,
  };
}

export async function reportCollectorJob(
  jobId: string,
  input: {
    collectorId: string;
    localRunId: string;
    status: "completed" | "partial" | "failed";
    sourceRunId?: string;
    articleSnapshotIds?: string[];
    eventDraftIds?: string[];
    evidenceAssetIds?: string[];
    failureIds?: string[];
    suggestedDisposition?: SuggestedDisposition;
    message?: string;
  },
  store: CollectorJobStore,
  now = new Date(),
): Promise<MutateCollectorJobResult> {
  const existing = await store.findByJobId(jobId);

  if (existing && TERMINAL_STATES.has(existing.state)) {
    if (
      existing.collectorId === input.collectorId &&
      existing.localRunId === input.localRunId &&
      existing.state === input.status
    ) {
      return {
        kind: "updated",
        job: existing,
      };
    }

    return {
      kind: "forbidden",
      error: "collector_job_not_active",
    };
  }

  const ownership = validateActiveOwnership(existing, input.collectorId, now);
  if (ownership) return ownership;

  if (existing?.localRunId && existing.localRunId !== input.localRunId) {
    return {
      kind: "forbidden",
      error: "collector_run_mismatch",
    };
  }

  const job = await store.updateReport({
    ...input,
    jobId,
    reportedAt: now.toISOString(),
  });

  if (!job) {
    return {
      kind: "not_found",
      error: "collector_job_not_found",
    };
  }

  return {
    kind: "updated",
    job,
  };
}

function validateActiveOwnership(
  job: CollectorJobRecord | null,
  collectorId: string,
  now: Date,
): MutateCollectorJobResult | null {
  if (!job) {
    return {
      kind: "not_found",
      error: "collector_job_not_found",
    };
  }

  if (job.collectorId !== collectorId) {
    return {
      kind: "forbidden",
      error: "collector_lease_mismatch",
    };
  }

  if (job.state !== "claimed" && job.state !== "running") {
    return {
      kind: "forbidden",
      error: "collector_job_not_active",
    };
  }

  if (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= now.getTime()) {
    return {
      kind: "expired",
      error: "collector_lease_expired",
    };
  }

  return null;
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1_000);
}
