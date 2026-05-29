import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type CollectorJobRecord,
  type CollectorJobRequestedMode,
  type CollectorJobStore,
} from "./collector-job-service";
import { getSupabaseAdminClient } from "./supabase-admin";

type CollectorJobRow = {
  id: number;
  job_id: string;
  seed_url: string;
  source_id: number | null;
  state: CollectorJobRecord["state"];
  requested_at: string;
  claimed_at: string | null;
  lease_expires_at: string | null;
  collector_id: string | null;
  local_run_id: string | null;
  attempt_number: number;
  requested_mode: CollectorJobRequestedMode | null;
  last_heartbeat_at: string | null;
  last_heartbeat_stage: CollectorJobRecord["lastHeartbeatStage"] | null;
  suggested_disposition: CollectorJobRecord["suggestedDisposition"] | null;
  source_run_id: string | null;
  article_snapshot_ids: string[] | null;
  event_draft_ids: string[] | null;
  evidence_asset_ids: string[] | null;
  failure_ids: string[] | null;
  result_message: string | null;
  finished_at: string | null;
  preferred_runner: CollectorJobRecord["preferredRunner"];
  actual_runner: CollectorJobRecord["actualRunner"] | null;
  runner_state: CollectorJobRecord["runnerState"];
  fallback_eligible: boolean;
  fallback_reason: CollectorJobRecord["fallbackReason"] | null;
  sandbox_run_id: string | null;
};

export function getSupabaseCollectorJobStore(
  client = getSupabaseAdminClient(),
): CollectorJobStore {
  return new SupabaseCollectorJobStore(client);
}

class SupabaseCollectorJobStore implements CollectorJobStore {
  constructor(private readonly client: SupabaseClient) {}

  async createQueuedJob(input: {
    seedUrl: string;
    sourceId?: string;
    requestedMode?: CollectorJobRequestedMode;
    requestedAt: string;
    preferredRunner: CollectorJobRecord["preferredRunner"];
  }) {
    const row = await this.writeOne(
      this.client
        .from("collector_jobs")
        .insert({
          job_id: `job-${randomUUID()}`,
          seed_url: input.seedUrl,
          source_id: input.sourceId ? Number(input.sourceId) : null,
          requested_mode: input.requestedMode ?? null,
          requested_at: input.requestedAt,
          state: "queued",
          preferred_runner: input.preferredRunner,
          runner_state:
            input.preferredRunner === "local_collector"
              ? "local_pending"
              : "sandbox_pending",
          fallback_eligible: false,
        })
        .select("*")
        .single(),
    );

    return toRecord(row);
  }

  async expireStaleLeases(now: string, maxAttempts: number) {
    await this.writeMany(
      this.client
        .from("collector_jobs")
        .update({
          state: "expired",
          runner_state: "failed",
          updated_at: now,
        })
        .in("state", ["claimed", "running"])
        .lte("lease_expires_at", now)
        .gte("attempt_number", maxAttempts),
    );

    await this.writeMany(
      this.client
        .from("collector_jobs")
        .update({
          state: "queued",
          collector_id: null,
          local_run_id: null,
          claimed_at: null,
          lease_expires_at: null,
          last_heartbeat_at: null,
          last_heartbeat_stage: null,
          actual_runner: "vercel_sandbox",
          runner_state: "sandbox_failed_fallback_eligible",
          updated_at: now,
        })
        .in("state", ["claimed", "running"])
        .lte("lease_expires_at", now)
        .eq("fallback_eligible", true)
        .lt("attempt_number", maxAttempts),
    );

    await this.writeMany(
      this.client
        .from("collector_jobs")
        .update({
          state: "queued",
          collector_id: null,
          local_run_id: null,
          claimed_at: null,
          lease_expires_at: null,
          last_heartbeat_at: null,
          last_heartbeat_stage: null,
          actual_runner: null,
          runner_state: "local_pending",
          updated_at: now,
        })
        .in("state", ["claimed", "running"])
        .lte("lease_expires_at", now)
        .eq("fallback_eligible", false)
        .lt("attempt_number", maxAttempts),
    );
  }

  async claimNextQueuedJob(input: {
    collectorId: string;
    claimedAt: string;
    leaseExpiresAt: string;
    runner: CollectorJobRecord["actualRunner"];
  }) {
    const { data, error } = await this.client
      .from("collector_jobs")
      .select("*")
      .eq("state", "queued")
      .or("preferred_runner.eq.local_collector,fallback_eligible.eq.true")
      .order("requested_at", { ascending: true })
      .limit(1)
      .maybeSingle<CollectorJobRow>();

    if (error) throw new Error("collector_job_select_failed");
    if (!data) return null;

    const row = await this.writeMaybeOne(
      this.client
        .from("collector_jobs")
        .update({
          state: "claimed",
          collector_id: input.collectorId,
          claimed_at: input.claimedAt,
          lease_expires_at: input.leaseExpiresAt,
          attempt_number: data.attempt_number + 1,
          actual_runner: input.runner,
          runner_state: data.fallback_eligible
            ? "fallback_claimed"
            : "local_claimed",
          updated_at: input.claimedAt,
        })
        .eq("id", data.id)
        .eq("state", "queued")
        .select("*")
        .maybeSingle<CollectorJobRow>(),
    );

    return row ? toRecord(row) : null;
  }

  async findByJobId(jobId: string) {
    const { data, error } = await this.client
      .from("collector_jobs")
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle<CollectorJobRow>();

    if (error) throw new Error("collector_job_select_failed");
    return data ? toRecord(data) : null;
  }

  async updateHeartbeat(input: {
    jobId: string;
    collectorId: string;
    localRunId: string;
    stage: "capturing" | "extracting" | "uploading";
    message?: string;
    heartbeatAt: string;
    leaseExpiresAt: string;
    runnerState: CollectorJobRecord["runnerState"];
  }) {
    const row = await this.writeMaybeOne(
      this.client
        .from("collector_jobs")
        .update({
          state: "running",
          collector_id: input.collectorId,
          local_run_id: input.localRunId,
          last_heartbeat_at: input.heartbeatAt,
          last_heartbeat_stage: input.stage,
          lease_expires_at: input.leaseExpiresAt,
          result_message: input.message ?? null,
          actual_runner: "local_collector",
          runner_state: input.runnerState,
          updated_at: input.heartbeatAt,
        })
        .eq("job_id", input.jobId)
        .eq("collector_id", input.collectorId)
        .in("state", ["claimed", "running"])
        .select("*")
        .maybeSingle<CollectorJobRow>(),
    );

    return row ? toRecord(row) : null;
  }

  async updateReport(input: {
    jobId: string;
    collectorId: string;
    localRunId: string;
    status: "completed" | "partial" | "failed";
    sourceRunId?: string;
    articleSnapshotIds?: string[];
    eventDraftIds?: string[];
    evidenceAssetIds?: string[];
    failureIds?: string[];
    suggestedDisposition?: CollectorJobRecord["suggestedDisposition"];
    message?: string;
    reportedAt: string;
  }) {
    const row = await this.writeMaybeOne(
      this.client
        .from("collector_jobs")
        .update({
          state: input.status,
          collector_id: input.collectorId,
          local_run_id: input.localRunId,
          source_run_id: input.sourceRunId ?? null,
          article_snapshot_ids: input.articleSnapshotIds ?? [],
          event_draft_ids: input.eventDraftIds ?? [],
          evidence_asset_ids: input.evidenceAssetIds ?? [],
          failure_ids: input.failureIds ?? [],
          suggested_disposition: input.suggestedDisposition ?? null,
          result_message: input.message ?? null,
          finished_at: input.reportedAt,
          runner_state: input.status === "failed" ? "failed" : "completed",
          updated_at: input.reportedAt,
        })
        .eq("job_id", input.jobId)
        .eq("collector_id", input.collectorId)
        .in("state", ["claimed", "running"])
        .select("*")
        .maybeSingle<CollectorJobRow>(),
    );

    return row ? toRecord(row) : null;
  }

  async updateSandboxStarted(input: {
    jobId: string;
    sandboxRunId: string;
    startedAt: string;
    collectorId: string;
    localRunId: string;
    leaseExpiresAt: string;
  }) {
    const { data, error } = await this.client
      .from("collector_jobs")
      .select("id,attempt_number")
      .eq("job_id", input.jobId)
      .eq("state", "queued")
      .eq("preferred_runner", "vercel_sandbox")
      .maybeSingle<{ id: number; attempt_number: number }>();

    if (error) throw new Error("collector_job_select_failed");
    if (!data) return null;

    const row = await this.writeMaybeOne(
      this.client
        .from("collector_jobs")
        .update({
          state: "running",
          actual_runner: "vercel_sandbox",
          runner_state: "sandbox_running",
          sandbox_run_id: input.sandboxRunId,
          collector_id: input.collectorId,
          local_run_id: input.localRunId,
          claimed_at: input.startedAt,
          lease_expires_at: input.leaseExpiresAt,
          attempt_number: data.attempt_number + 1,
          updated_at: input.startedAt,
        })
        .eq("id", data.id)
        .eq("state", "queued")
        .select("*")
        .maybeSingle<CollectorJobRow>(),
    );

    return row ? toRecord(row) : null;
  }

  async updateSandboxFailure(input: {
    jobId: string;
    reason: CollectorJobRecord["fallbackReason"];
    message: string;
    failedAt: string;
    fallbackEligible: boolean;
    sandboxRunId?: string;
  }) {
    const row = await this.writeMaybeOne(
      this.client
        .from("collector_jobs")
        .update({
          state: input.fallbackEligible ? "queued" : "failed",
          actual_runner: "vercel_sandbox",
          runner_state: input.fallbackEligible
            ? "sandbox_failed_fallback_eligible"
            : "failed",
          fallback_eligible: input.fallbackEligible,
          fallback_reason: input.reason,
          sandbox_run_id: input.sandboxRunId ?? null,
          result_message: input.message,
          collector_id: null,
          local_run_id: null,
          claimed_at: null,
          lease_expires_at: null,
          last_heartbeat_at: null,
          last_heartbeat_stage: null,
          finished_at: input.fallbackEligible ? null : input.failedAt,
          updated_at: input.failedAt,
        })
        .eq("job_id", input.jobId)
        .select("*")
        .maybeSingle<CollectorJobRow>(),
    );

    return row ? toRecord(row) : null;
  }

  private async writeOne<T>(
    request: PromiseLike<{ data: T | null; error: unknown }>,
  ) {
    const { data, error } = await request;
    if (error || !data) throw new Error("collector_job_write_failed");
    return data;
  }

  private async writeMaybeOne<T>(
    request: PromiseLike<{ data: T | null; error: unknown }>,
  ) {
    const { data, error } = await request;
    if (error) throw new Error("collector_job_write_failed");
    return data;
  }

  private async writeMany(request: PromiseLike<{ error: unknown }>) {
    const { error } = await request;
    if (error) throw new Error("collector_job_write_failed");
  }
}

function toRecord(row: CollectorJobRow): CollectorJobRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    seedUrl: row.seed_url,
    sourceId: row.source_id == null ? undefined : String(row.source_id),
    state: row.state,
    requestedAt: row.requested_at,
    claimedAt: row.claimed_at ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    collectorId: row.collector_id ?? undefined,
    localRunId: row.local_run_id ?? undefined,
    attemptNumber: row.attempt_number,
    requestedMode: row.requested_mode ?? undefined,
    lastHeartbeatAt: row.last_heartbeat_at ?? undefined,
    lastHeartbeatStage: row.last_heartbeat_stage ?? undefined,
    suggestedDisposition: row.suggested_disposition ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    articleSnapshotIds: row.article_snapshot_ids ?? undefined,
    eventDraftIds: row.event_draft_ids ?? undefined,
    evidenceAssetIds: row.evidence_asset_ids ?? undefined,
    failureIds: row.failure_ids ?? undefined,
    resultMessage: row.result_message ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    preferredRunner: row.preferred_runner,
    actualRunner: row.actual_runner ?? undefined,
    runnerState: row.runner_state,
    fallbackEligible: row.fallback_eligible,
    fallbackReason: row.fallback_reason ?? undefined,
    sandboxRunId: row.sandbox_run_id ?? undefined,
  };
}
