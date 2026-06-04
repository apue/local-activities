import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AdminExcludedArticleRecord,
  AdminEventDraftPatch,
  AdminEventDraftRecord,
  AdminLlmUsageRecord,
  AdminLlmUsageSummary,
  AdminReviewState,
  AdminStore,
  PublishedAdminEvent,
} from "./admin-service";
import type { CollectorJobRecord } from "./collector-job-service";
import { getSupabaseAdminClient } from "./supabase-admin";

type CollectorJobRow = {
  id: number;
  job_id: string;
  seed_url: string;
  state: CollectorJobRecord["state"];
  requested_at: string;
  claimed_at: string | null;
  lease_expires_at: string | null;
  collector_id: string | null;
  local_run_id: string | null;
  attempt_number: number;
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

type EventDraftRow = {
  id: number;
  draft_id: string;
  article_url: string;
  title: string | null;
  original_title: string | null;
  organizer: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: "Asia/Shanghai";
  city: "Beijing";
  venue_name: string | null;
  venue_address: string | null;
  reservation_status: "required" | "not_required" | "unknown" | null;
  registration_action: string | null;
  registration_url: string | null;
  schedule_text?: string | null;
  poster_image_url?: string | null;
  poster_image_alt?: string | null;
  poster_image_source_url?: string | null;
  summary: string | null;
  entry_notes: string | null;
  triage_decision: AdminEventDraftRecord["triageDecision"] | null;
  triage_action: AdminEventDraftRecord["triageAction"] | null;
  triage_confidence: number | null;
  public_signals: string[] | null;
  exclusion_signals: string[] | null;
  public_eligibility: AdminEventDraftRecord["publicEligibility"] | null;
  event_kind: AdminEventDraftRecord["eventKind"] | null;
  schedule_kind: AdminEventDraftRecord["scheduleKind"] | null;
  recurrence_rule: string | null;
  occurrence_starts_at: string[] | null;
  poster_asset_id: string | null;
  qr_asset_id: string | null;
  registration_qr_asset_id: string | null;
  hard_blockers: AdminEventDraftRecord["hardBlockers"] | null;
  soft_blockers: AdminEventDraftRecord["softBlockers"] | null;
  operator_override_reason: string | null;
  resolution_decision: AdminEventDraftRecord["resolutionDecision"] | null;
  canonical_event_id: string | number | null;
  processing_state: AdminEventDraftRecord["processingState"] | null;
  confidence: number;
  review_state: AdminReviewState;
  evidence_asset_ids: string[];
  field_evidence: Record<string, string[]>;
};

type ExcludedArticleRow = {
  excluded_article_id: string;
  article_url: string;
  triage_decision: string;
  triage_action: "exclude";
  confidence: number;
  public_signals: string[] | null;
  exclusion_signals: string[] | null;
  exclusion_reason: string;
  evidence_asset_ids: string[] | null;
  prompt_version: string;
  schema_version: string;
  provider: string;
  model: string;
  processing_state: AdminExcludedArticleRecord["processingState"];
  promoted_at: string | null;
  created_at: string | null;
};

type LlmUsageRow = {
  usage_id: string;
  recorded_at: string;
  operation: string;
  provider: string;
  model: string;
  status: AdminLlmUsageRecord["status"];
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
  cost_micro_cny: number;
  latency_ms: number | null;
  source_run_id: string | null;
  collector_job_id: string | null;
  article_snapshot_id: string | null;
  event_draft_id: string | null;
  excluded_article_id: string | null;
  metadata: Record<string, unknown> | null;
};

export function getSupabaseAdminStore(
  client = getSupabaseAdminClient(),
): AdminStore {
  return new SupabaseAdminStore(client);
}

class SupabaseAdminStore implements AdminStore {
  constructor(private readonly client: SupabaseClient) {}

  async createCollectorJob(input: {
    seedUrl: string;
    requestedAt: string;
    preferredRunner: CollectorJobRecord["preferredRunner"];
  }): Promise<CollectorJobRecord> {
    const row = await this.writeOne<CollectorJobRow>(
      this.client
        .from("collector_jobs")
        .insert({
          job_id: `job-${randomUUID()}`,
          seed_url: input.seedUrl,
          state: "queued",
          requested_at: input.requestedAt,
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

    return toJobRecord(row);
  }

  async listCollectorJobs(): Promise<CollectorJobRecord[]> {
    const { data, error } = await this.client
      .from("collector_jobs")
      .select("*")
      .order("requested_at", { ascending: false })
      .limit(100);

    if (error) throw new Error("admin_job_list_failed");
    return ((data ?? []) as CollectorJobRow[]).map(toJobRecord);
  }

  async listEventDrafts(input: {
    reviewState?: string;
  }): Promise<AdminEventDraftRecord[]> {
    let query = this.client
      .from("event_drafts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (input.reviewState) {
      query = query.eq("review_state", input.reviewState);
    }

    const { data, error } = await query;
    if (error) throw new Error("admin_draft_list_failed");
    return ((data ?? []) as EventDraftRow[]).map(toDraftRecord);
  }

  async getEventDraft(draftId: string): Promise<AdminEventDraftRecord | null> {
    const { data, error } = await this.client
      .from("event_drafts")
      .select("*")
      .eq("draft_id", draftId)
      .maybeSingle<EventDraftRow>();

    if (error) throw new Error("admin_draft_read_failed");
    return data ? toDraftRecord(data) : null;
  }

  async updateEventDraftReviewState(
    draftId: string,
    reviewState: AdminReviewState,
  ): Promise<AdminEventDraftRecord | null> {
    const { data, error } = await this.client
      .from("event_drafts")
      .update({
        review_state: reviewState,
        updated_at: new Date().toISOString(),
      })
      .eq("draft_id", draftId)
      .select("*")
      .maybeSingle<EventDraftRow>();

    if (error) throw new Error("admin_draft_update_failed");
    return data ? toDraftRecord(data) : null;
  }

  async updateEventDraftFields(
    draftId: string,
    patch: AdminEventDraftPatch,
  ): Promise<AdminEventDraftRecord | null> {
    const { data, error } = await this.client
      .from("event_drafts")
      .update({
        ...toDraftPatchRow(patch),
        updated_at: new Date().toISOString(),
      })
      .eq("draft_id", draftId)
      .select("*")
      .maybeSingle<EventDraftRow>();

    if (error) throw new Error("admin_draft_update_failed");
    return data ? toDraftRecord(data) : null;
  }

  async listExcludedArticles(input: {
    processingState?: AdminExcludedArticleRecord["processingState"];
  }): Promise<AdminExcludedArticleRecord[]> {
    let query = this.client
      .from("excluded_articles")
      .select("*");

    if (input.processingState) {
      query = query.eq("processing_state", input.processingState);
    }

    query = query.order("created_at", { ascending: false }).limit(100);

    const { data, error } = await query;
    if (error) throw new Error("admin_excluded_article_list_failed");
    return ((data ?? []) as ExcludedArticleRow[]).map(toExcludedArticleRecord);
  }

  async promoteExcludedArticle(
    excludedArticleId: string,
    promotedAt: string,
  ): Promise<AdminExcludedArticleRecord | null> {
    const { data, error } = await this.client
      .from("excluded_articles")
      .update({
        processing_state: "promoted_to_extraction",
        promoted_at: promotedAt,
        updated_at: promotedAt,
      })
      .eq("excluded_article_id", excludedArticleId)
      .select("*")
      .maybeSingle<ExcludedArticleRow>();

    if (error) throw new Error("admin_excluded_article_promote_failed");
    return data ? toExcludedArticleRecord(data) : null;
  }

  async getLlmUsageSummary(): Promise<AdminLlmUsageSummary> {
    const { data, error } = await this.client
      .from("llm_usage_ledger")
      .select(
        [
          "usage_id",
          "recorded_at",
          "operation",
          "provider",
          "model",
          "status",
          "input_tokens",
          "output_tokens",
          "total_tokens",
          "cached_input_tokens",
          "reasoning_output_tokens",
          "cost_micro_cny",
          "latency_ms",
          "source_run_id",
          "collector_job_id",
          "article_snapshot_id",
          "event_draft_id",
          "excluded_article_id",
          "metadata",
        ].join(","),
      )
      .order("recorded_at", { ascending: false })
      .limit(500);

    if (error) throw new Error("admin_llm_usage_list_failed");
    const recent = ((data ?? []) as unknown as LlmUsageRow[]).map(
      toLlmUsageRecord,
    );
    return summarizeLlmUsage(recent);
  }

  async publishEventDraft(input: {
    draft: AdminEventDraftRecord;
    publishedAt: string;
  }): Promise<PublishedAdminEvent> {
    const eventId = `event-${randomUUID()}`;
    const eventRow = {
      event_id: eventId,
      title: input.draft.title,
      organizer: input.draft.organizer ?? null,
      starts_at: input.draft.startsAt,
      ends_at: input.draft.endsAt ?? null,
      timezone: input.draft.timezone,
      city: input.draft.city,
      venue_name: input.draft.venueName ?? null,
      venue_address: input.draft.venueAddress ?? null,
      reservation_status: input.draft.reservationStatus ?? "unknown",
      registration_action: input.draft.registrationAction ?? null,
      registration_url: input.draft.registrationUrl ?? null,
      source_url: input.draft.articleUrl,
      schedule_text: input.draft.scheduleText ?? null,
      triage_decision: input.draft.triageDecision ?? null,
      public_eligibility: input.draft.publicEligibility ?? null,
      event_kind: input.draft.eventKind ?? null,
      schedule_kind: input.draft.scheduleKind ?? null,
      recurrence_rule: input.draft.recurrenceRule ?? null,
      occurrence_starts_at: input.draft.occurrenceStartsAt ?? null,
      poster_asset_id: input.draft.posterAssetId ?? null,
      qr_asset_id: input.draft.qrAssetId ?? null,
      registration_qr_asset_id: input.draft.registrationQrAssetId ?? null,
      hard_blockers: input.draft.hardBlockers ?? [],
      soft_blockers: input.draft.softBlockers ?? [],
      operator_override_reason: input.draft.operatorOverrideReason ?? null,
      resolution_decision: input.draft.resolutionDecision ?? null,
      poster_image_url: input.draft.posterImageUrl ?? null,
      poster_image_alt: input.draft.posterImageAlt ?? null,
      poster_image_source_url: input.draft.posterImageSourceUrl ?? null,
      summary: input.draft.summary ?? null,
      entry_notes: input.draft.entryNotes ?? null,
      status: "published",
      review_state: "approved",
      published_at: input.publishedAt,
    };
    const event = await this.writeOne<{
      id: number;
      event_id: string;
      title: string;
      status: "published";
      published_at: string;
    }>(
      this.client
        .from("canonical_events")
        .insert(eventRow)
        .select("id,event_id,title,status,published_at")
        .single(),
      {
        retryWithoutOptionalPosterColumns: (rowPayload) =>
          this.client
            .from("canonical_events")
            .insert(rowPayload)
            .select("id,event_id,title,status,published_at")
            .single(),
        originalPayload: eventRow,
      },
    );

    await this.writeMany(
      this.client
        .from("event_drafts")
        .update({
          review_state: "approved",
          updated_at: input.publishedAt,
        })
        .eq("draft_id", input.draft.id),
    );

    return {
      id: event.event_id,
      title: event.title,
      status: event.status,
      publishedAt: event.published_at,
    };
  }

  private async writeOne<T>(
    request: PromiseLike<{ data: T | null; error: unknown }>,
    options?: {
      originalPayload: Record<string, unknown>;
      retryWithoutOptionalPosterColumns: (
        payload: Record<string, unknown>,
      ) => PromiseLike<{ data: T | null; error: unknown }>;
    },
  ) {
    let { data, error } = await request;
    if (
      error &&
      options &&
      isMissingOptionalPosterColumnError(error)
    ) {
      ({ data, error } = await options.retryWithoutOptionalPosterColumns(
        withoutOptionalPosterColumns(options.originalPayload),
      ));
    }
    if (error || !data) throw new Error("admin_write_failed");
    return data;
  }

  private async writeMany(request: PromiseLike<{ error: unknown }>) {
    const { error } = await request;
    if (error) throw new Error("admin_write_failed");
  }
}

function summarizeLlmUsage(recent: AdminLlmUsageRecord[]): AdminLlmUsageSummary {
  const totals: AdminLlmUsageSummary["totals"] = {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costMicroCny: 0,
  };
  const byModel = new Map<string, AdminLlmUsageSummary["byModel"][number]>();

  for (const record of recent) {
    totals.requestCount += 1;
    if (record.status === "succeeded") totals.successCount += 1;
    if (record.status === "failed") totals.errorCount += 1;
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.totalTokens += record.totalTokens;
    totals.costMicroCny += record.costMicroCny;

    const key = `${record.provider}\u0000${record.model}\u0000${record.operation}`;
    const summary =
      byModel.get(key) ??
      {
        provider: record.provider,
        model: record.model,
        operation: record.operation,
        requestCount: 0,
        totalTokens: 0,
        costMicroCny: 0,
      };
    summary.requestCount += 1;
    summary.totalTokens += record.totalTokens;
    summary.costMicroCny += record.costMicroCny;
    byModel.set(key, summary);
  }

  return {
    totals,
    byModel: Array.from(byModel.values()),
    recent,
  };
}

function toLlmUsageRecord(row: LlmUsageRow): AdminLlmUsageRecord {
  return {
    id: row.usage_id,
    recordedAt: row.recorded_at,
    operation: row.operation,
    provider: row.provider,
    model: row.model,
    status: row.status,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    cachedInputTokens: row.cached_input_tokens,
    reasoningOutputTokens: row.reasoning_output_tokens,
    costMicroCny: row.cost_micro_cny,
    latencyMs: row.latency_ms ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    collectorJobId: row.collector_job_id ?? undefined,
    articleSnapshotId: row.article_snapshot_id ?? undefined,
    eventDraftId: row.event_draft_id ?? undefined,
    excludedArticleId: row.excluded_article_id ?? undefined,
    metadata: sanitizeLlmMetadata(row.metadata ?? {}),
  };
}

function sanitizeLlmMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveMetadataKey(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function isSensitiveMetadataKey(key: string) {
  const normalized = key.toLowerCase();
  return [
    "prompt",
    "response",
    "html",
    "image",
    "api_key",
    "apikey",
    "header",
    "cookie",
    "token",
    "secret",
  ].some((fragment) => normalized.includes(fragment));
}

function withoutOptionalPosterColumns(payload: Record<string, unknown>) {
  const {
    poster_image_url: _posterImageUrl,
    poster_image_alt: _posterImageAlt,
    poster_image_source_url: _posterImageSourceUrl,
    ...rest
  } = payload;
  return rest;
}

function isMissingOptionalPosterColumnError(error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : String(error ?? "");
  return (
    message.includes("poster_image_url") ||
    message.includes("poster_image_alt") ||
    message.includes("poster_image_source_url")
  );
}

function toDraftPatchRow(patch: AdminEventDraftPatch) {
  return {
    title: patch.title,
    starts_at: patch.startsAt,
    ends_at: patch.endsAt,
    venue_name: patch.venueName,
    venue_address: patch.venueAddress,
    schedule_text: patch.scheduleText,
    schedule_kind: patch.scheduleKind,
    recurrence_rule: patch.recurrenceRule,
    occurrence_starts_at: patch.occurrenceStartsAt,
    registration_url: patch.registrationUrl,
    registration_qr_asset_id: patch.registrationQrAssetId,
    summary: patch.summary,
    entry_notes: patch.entryNotes,
  };
}

function toExcludedArticleRecord(
  row: ExcludedArticleRow,
): AdminExcludedArticleRecord {
  return {
    id: row.excluded_article_id,
    articleUrl: row.article_url,
    triageDecision: row.triage_decision,
    triageAction: row.triage_action,
    confidence: row.confidence,
    publicSignals: row.public_signals ?? [],
    exclusionSignals: row.exclusion_signals ?? [],
    exclusionReason: row.exclusion_reason,
    evidenceAssetIds: row.evidence_asset_ids ?? [],
    promptVersion: row.prompt_version,
    schemaVersion: row.schema_version,
    provider: row.provider,
    model: row.model,
    processingState: row.processing_state,
    promotedAt: row.promoted_at ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

function toJobRecord(row: CollectorJobRow): CollectorJobRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    seedUrl: row.seed_url,
    state: row.state,
    requestedAt: row.requested_at,
    claimedAt: row.claimed_at ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    collectorId: row.collector_id ?? undefined,
    localRunId: row.local_run_id ?? undefined,
    attemptNumber: row.attempt_number,
    lastHeartbeatAt: row.last_heartbeat_at ?? undefined,
    lastHeartbeatStage: row.last_heartbeat_stage ?? undefined,
    suggestedDisposition: row.suggested_disposition ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    articleSnapshotIds: row.article_snapshot_ids ?? [],
    eventDraftIds: row.event_draft_ids ?? [],
    evidenceAssetIds: row.evidence_asset_ids ?? [],
    failureIds: row.failure_ids ?? [],
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

function toDraftRecord(row: EventDraftRow): AdminEventDraftRecord {
  return {
    id: row.draft_id,
    articleUrl: row.article_url,
    title: row.title ?? undefined,
    originalTitle: row.original_title ?? undefined,
    organizer: row.organizer ?? undefined,
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    timezone: row.timezone,
    city: row.city,
    venueName: row.venue_name ?? undefined,
    venueAddress: row.venue_address ?? undefined,
    reservationStatus: row.reservation_status ?? undefined,
    registrationAction: row.registration_action ?? undefined,
    registrationUrl: row.registration_url ?? undefined,
    scheduleText: row.schedule_text ?? undefined,
    posterImageUrl: row.poster_image_url ?? undefined,
    posterImageAlt: row.poster_image_alt ?? undefined,
    posterImageSourceUrl: row.poster_image_source_url ?? undefined,
    summary: row.summary ?? undefined,
    entryNotes: row.entry_notes ?? undefined,
    triageDecision: row.triage_decision ?? undefined,
    triageAction: row.triage_action ?? undefined,
    triageConfidence: row.triage_confidence ?? undefined,
    publicSignals: row.public_signals ?? undefined,
    exclusionSignals: row.exclusion_signals ?? undefined,
    publicEligibility: row.public_eligibility ?? undefined,
    eventKind: row.event_kind ?? undefined,
    scheduleKind: row.schedule_kind ?? undefined,
    recurrenceRule: row.recurrence_rule ?? undefined,
    occurrenceStartsAt: row.occurrence_starts_at ?? undefined,
    posterAssetId: row.poster_asset_id ?? undefined,
    qrAssetId: row.qr_asset_id ?? undefined,
    registrationQrAssetId: row.registration_qr_asset_id ?? undefined,
    hardBlockers: row.hard_blockers ?? undefined,
    softBlockers: row.soft_blockers ?? undefined,
    operatorOverrideReason: row.operator_override_reason ?? undefined,
    resolutionDecision: row.resolution_decision ?? undefined,
    canonicalEventId:
      row.canonical_event_id === null || row.canonical_event_id === undefined
        ? undefined
        : String(row.canonical_event_id),
    processingState: row.processing_state ?? undefined,
    confidence: row.confidence,
    reviewState: row.review_state,
    evidenceAssetIds: row.evidence_asset_ids,
    fieldEvidence: row.field_evidence,
  };
}
