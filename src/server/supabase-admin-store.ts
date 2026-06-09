import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminCollectorJobRecord } from "./admin-collector-jobs";
import type {
  AdminExcludedArticleRecord,
  AdminEventDraftPatch,
  AdminEventDraftRecord,
  AdminEvaluationCaseResultRecord,
  AdminEvaluationRunRecord,
  AdminLlmUsageRange,
  AdminLlmUsageRecord,
  AdminLlmUsageSummary,
  AdminDataClass,
  AdminProcessingLedgerRecord,
  AdminProcessingLedgerState,
  AdminReviewState,
  AdminStore,
  PublishedAdminEvent,
} from "./admin-service";
import { resolveEvidenceAssetImageUrls } from "./evidence-asset-image-urls";
import { getSupabaseAdminClient } from "./supabase-admin";

type CollectorJobRow = {
  id: number;
  job_id: string;
  seed_url: string;
  state: AdminCollectorJobRecord["state"];
  requested_at: string;
  claimed_at: string | null;
  lease_expires_at: string | null;
  collector_id: string | null;
  capture_run_id: string | null;
  attempt_number: number;
  last_heartbeat_at: string | null;
  last_heartbeat_stage: AdminCollectorJobRecord["lastHeartbeatStage"] | null;
  suggested_disposition: AdminCollectorJobRecord["suggestedDisposition"] | null;
  source_run_id: string | null;
  article_bundle_ids: string[] | null;
  event_draft_ids: string[] | null;
  evidence_asset_ids: string[] | null;
  failure_ids: string[] | null;
  result_message: string | null;
  finished_at: string | null;
  preferred_runner: string;
  actual_runner: string | null;
  runner_state: string;
  fallback_eligible: boolean;
  fallback_reason: AdminCollectorJobRecord["fallbackReason"] | null;
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
  registration_qr_image_url?: string | null;
  registration_qr_image_alt?: string | null;
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

type ProcessingLedgerRow = {
  ledger_id: string;
  article_bundle_id: string | null;
  source_url: string;
  content_hash: string | null;
  state: AdminProcessingLedgerState;
  decision: string | null;
  reason: string | null;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  usage_id: string | null;
  draft_id: string | null;
  canonical_event_id: string | null;
  excluded_article_id: string | null;
  data_class: AdminDataClass;
  error_details: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type EvaluationRunRow = {
  run_id: string;
  provider: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  parameters: Record<string, unknown> | null;
  corpus_version: string;
  status: AdminEvaluationRunRecord["status"];
  validity: AdminEvaluationRunRecord["validity"] | null;
  invalidated_reason: string | null;
  invalidated_at: string | null;
  started_at: string;
  completed_at: string | null;
  case_count: number;
  pass_count: number;
  fail_count: number;
  summary: Record<string, unknown> | null;
  artifact_bucket: string | null;
  artifact_path: string | null;
  created_at: string;
};

type EvaluationCaseResultRow = {
  result_id: string;
  run_id: string;
  case_id: string;
  article_bundle_id: string | null;
  expected_action: string | null;
  actual_action: string | null;
  passed: boolean;
  scores: Record<string, unknown> | null;
  errors: unknown[] | null;
  usage_id: string | null;
  artifact_path: string | null;
  created_at: string;
};

type LlmUsageRow = {
  usage_id: string;
  recorded_at: string;
  operation: string;
  provider: string;
  model: string;
  status: AdminLlmUsageRecord["status"];
  data_class: AdminLlmUsageRecord["dataClass"] | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
  cost_micro_cny: number;
  latency_ms: number | null;
  source_run_id: string | null;
  collector_job_id: string | null;
  article_bundle_id: string | null;
  event_draft_id: string | null;
  excluded_article_id: string | null;
  evaluation_run_id: string | null;
  metadata: Record<string, unknown> | null;
};

const LLM_USAGE_COLUMNS = [
  "usage_id",
  "recorded_at",
  "operation",
  "provider",
  "model",
  "status",
  "data_class",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "cached_input_tokens",
  "reasoning_output_tokens",
  "cost_micro_cny",
  "latency_ms",
  "source_run_id",
  "collector_job_id",
  "article_bundle_id",
  "event_draft_id",
  "excluded_article_id",
  "evaluation_run_id",
  "metadata",
].join(",");

export function getSupabaseAdminStore(
  client = getSupabaseAdminClient(),
): AdminStore {
  return new SupabaseAdminStore(client);
}

class SupabaseAdminStore implements AdminStore {
  constructor(private readonly client: SupabaseClient) {}

  async listCollectorJobs(): Promise<AdminCollectorJobRecord[]> {
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
      .eq("data_class", "production")
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
      .eq("data_class", "production")
      .eq("draft_id", draftId)
      .maybeSingle<EventDraftRow>();

    if (error) throw new Error("admin_draft_read_failed");
    return data ? toDraftRecord(data) : null;
  }

  async updateEventDraftReviewState(
    draftId: string,
    reviewState: AdminReviewState,
    options?: { reason?: string },
  ): Promise<AdminEventDraftRecord | null> {
    const updatePayload: Record<string, unknown> = {
      review_state: reviewState,
      updated_at: new Date().toISOString(),
    };
    if (reviewState === "rejected") {
      updatePayload.processing_state = "rejected";
    }
    if (options?.reason) {
      updatePayload.operator_override_reason = options.reason;
    }

    const { data, error } = await this.client
      .from("event_drafts")
      .update(updatePayload)
      .eq("data_class", "production")
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
      .eq("data_class", "production")
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
      .select("*")
      .eq("data_class", "production");

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
      .eq("data_class", "production")
      .eq("excluded_article_id", excludedArticleId)
      .select("*")
      .maybeSingle<ExcludedArticleRow>();

    if (error) throw new Error("admin_excluded_article_promote_failed");
    return data ? toExcludedArticleRecord(data) : null;
  }

  async listProcessingLedger(input: {
    state?: AdminProcessingLedgerState;
    dataClass?: AdminDataClass;
  }): Promise<AdminProcessingLedgerRecord[]> {
    let query = this.client
      .from("processing_ledger")
      .select("*")
      .eq("data_class", input.dataClass ?? "production");

    if (input.state) {
      query = query.eq("state", input.state);
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error("admin_processing_ledger_list_failed");
    return ((data ?? []) as ProcessingLedgerRow[]).map(
      toProcessingLedgerRecord,
    );
  }

  async listEvaluationRuns(input: {
    status?: AdminEvaluationRunRecord["status"];
    validity?: AdminEvaluationRunRecord["validity"];
  }): Promise<AdminEvaluationRunRecord[]> {
    let runQuery = this.client
      .from("evaluation_runs")
      .select("*")
      .eq("data_class", "eval");

    if (input.status) {
      runQuery = runQuery.eq("status", input.status);
    }
    runQuery = runQuery.eq("validity", input.validity ?? "valid");

    const { data: runData, error: runError } = await runQuery
      .order("started_at", { ascending: false })
      .limit(50);
    if (runError) throw new Error("admin_evaluation_run_list_failed");

    const runRows = (runData ?? []) as EvaluationRunRow[];
    const runIds = runRows.map((run) => run.run_id);
    if (runIds.length === 0) return [];

    const { data: caseData, error: caseError } = await this.client
      .from("evaluation_case_results")
      .select("*")
      .eq("data_class", "eval")
      .in("run_id", runIds)
      .order("created_at", { ascending: true })
      .limit(1_000);
    if (caseError) throw new Error("admin_evaluation_case_list_failed");

    const casesByRun = new Map<string, AdminEvaluationCaseResultRecord[]>();
    for (const row of (caseData ?? []) as EvaluationCaseResultRow[]) {
      const record = toEvaluationCaseResultRecord(row);
      casesByRun.set(record.runId, [
        ...(casesByRun.get(record.runId) ?? []),
        record,
      ]);
    }

    return runRows.map((row) =>
      toEvaluationRunRecord(row, casesByRun.get(row.run_id) ?? []),
    );
  }

  async getLlmUsageSummary(input: {
    startsAt?: string;
    range: AdminLlmUsageRange;
  }): Promise<AdminLlmUsageSummary> {
    const rows: LlmUsageRow[] = [];
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      let query = this.client
        .from("llm_usage_ledger")
        .select(LLM_USAGE_COLUMNS);

      if (input.startsAt) {
        query = query.gte("recorded_at", input.startsAt);
      }

      const { data, error } = await query
        .order("recorded_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error("admin_llm_usage_list_failed");
      const page = (data ?? []) as unknown as LlmUsageRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }

    const records = rows.map(toLlmUsageRecord);
    return summarizeLlmUsage(records, input.range);
  }

  async publishEventDraft(input: {
    draft: AdminEventDraftRecord;
    publishedAt: string;
  }): Promise<PublishedAdminEvent> {
    const imageUrls = await resolveEvidenceAssetImageUrls(this.client, {
      dataClass: "production",
      posterAssetId: input.draft.posterAssetId,
      registrationQrAssetId: input.draft.registrationQrAssetId,
      posterImageUrl: input.draft.posterImageUrl,
      posterImageAlt: input.draft.posterImageAlt,
      posterImageSourceUrl: input.draft.posterImageSourceUrl,
      registrationQrImageUrl: input.draft.registrationQrImageUrl,
      registrationQrImageAlt: input.draft.registrationQrImageAlt,
    });
    const eventId = `event-${randomUUID()}`;
    const eventRow = {
      event_id: eventId,
      data_class: "production",
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
      poster_image_url: imageUrls.posterImageUrl ?? null,
      poster_image_alt: imageUrls.posterImageAlt ?? null,
      poster_image_source_url: imageUrls.posterImageSourceUrl ?? null,
      registration_qr_image_url: imageUrls.registrationQrImageUrl ?? null,
      registration_qr_image_alt: imageUrls.registrationQrImageAlt ?? null,
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
        .eq("data_class", "production")
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

function summarizeLlmUsage(
  records: AdminLlmUsageRecord[],
  range: AdminLlmUsageRange,
): AdminLlmUsageSummary {
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
  const byEnvironment = new Map<
    string,
    AdminLlmUsageSummary["byEnvironment"][number]
  >();
  const byRun = new Map<string, AdminLlmUsageSummary["byRun"][number]>();

  for (const record of records) {
    totals.requestCount += 1;
    if (record.status === "succeeded") totals.successCount += 1;
    if (record.status === "failed") totals.errorCount += 1;
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.totalTokens += record.totalTokens;
    totals.costMicroCny += record.costMicroCny;

    const workload = llmUsageWorkload(record);
    const environment = llmUsageEnvironment(record);
    const key = `${record.provider}\u0000${record.model}\u0000${record.operation}\u0000${workload}\u0000${environment}`;
    const summary =
      byModel.get(key) ??
      {
        provider: record.provider,
        model: record.model,
        operation: record.operation,
        workload,
        environment,
        requestCount: 0,
        totalTokens: 0,
        costMicroCny: 0,
      };
    summary.requestCount += 1;
    summary.totalTokens += record.totalTokens;
    summary.costMicroCny += record.costMicroCny;
    byModel.set(key, summary);

    const environmentSummary =
      byEnvironment.get(environment) ??
      {
        environment,
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        totalTokens: 0,
        costMicroCny: 0,
        latestRecordedAt: record.recordedAt,
      };
    environmentSummary.requestCount += 1;
    if (record.status === "succeeded") environmentSummary.successCount += 1;
    if (record.status === "failed") environmentSummary.errorCount += 1;
    environmentSummary.totalTokens += record.totalTokens;
    environmentSummary.costMicroCny += record.costMicroCny;
    if (
      !environmentSummary.latestRecordedAt ||
      record.recordedAt > environmentSummary.latestRecordedAt
    ) {
      environmentSummary.latestRecordedAt = record.recordedAt;
    }
    byEnvironment.set(environment, environmentSummary);

    const runId = llmUsageRunId(record);
    const runKey = `${runId}\u0000${environment}`;
    const runSummary =
      byRun.get(runKey) ??
      {
        runId,
        environment,
        requestCount: 0,
        totalTokens: 0,
        costMicroCny: 0,
        latestRecordedAt: record.recordedAt,
      };
    runSummary.requestCount += 1;
    runSummary.totalTokens += record.totalTokens;
    runSummary.costMicroCny += record.costMicroCny;
    if (
      !runSummary.latestRecordedAt ||
      record.recordedAt > runSummary.latestRecordedAt
    ) {
      runSummary.latestRecordedAt = record.recordedAt;
    }
    byRun.set(runKey, runSummary);
  }

  return {
    range,
    latestRecordedAt: records[0]?.recordedAt,
    totals,
    byModel: Array.from(byModel.values()),
    byEnvironment: Array.from(byEnvironment.values()),
    byRun: Array.from(byRun.values()).slice(0, 100),
    recent: records.slice(0, 500),
  };
}

function llmUsageWorkload(record: AdminLlmUsageRecord) {
  const workload = record.metadata.workload;
  return typeof workload === "string" && workload ? workload : record.operation;
}

function llmUsageEnvironment(record: AdminLlmUsageRecord) {
  const environment = record.metadata.environment;
  if (typeof environment === "string" && environment) return environment;
  if (record.dataClass === "eval") {
    return `eval:${record.evaluationRunId ?? "unknown"}`;
  }
  return record.dataClass ?? "unknown";
}

function llmUsageRunId(record: AdminLlmUsageRecord) {
  return (
    record.evaluationRunId ??
    record.sourceRunId ??
    record.collectorJobId ??
    "unknown"
  );
}

function toLlmUsageRecord(row: LlmUsageRow): AdminLlmUsageRecord {
  return {
    id: row.usage_id,
    recordedAt: row.recorded_at,
    operation: row.operation,
    provider: row.provider,
    model: row.model,
    status: row.status,
    dataClass: row.data_class ?? undefined,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    cachedInputTokens: row.cached_input_tokens,
    reasoningOutputTokens: row.reasoning_output_tokens,
    costMicroCny: row.cost_micro_cny,
    latencyMs: row.latency_ms ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    collectorJobId: row.collector_job_id ?? undefined,
    articleBundleId: row.article_bundle_id ?? undefined,
    eventDraftId: row.event_draft_id ?? undefined,
    excludedArticleId: row.excluded_article_id ?? undefined,
    evaluationRunId: row.evaluation_run_id ?? undefined,
    metadata: sanitizeLlmMetadata(row.metadata ?? {}),
  };
}

function sanitizeLlmMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveMetadataKey(key)) continue;
    sanitized[key] = sanitizeJsonValue(value);
  }
  return sanitized;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }
  if (value && typeof value === "object") {
    return sanitizeLlmMetadata(value as Record<string, unknown>);
  }
  if (typeof value === "string") {
    return redactSensitiveUrlParams(value);
  }
  return value;
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

function redactSensitiveUrlParams(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
  }

  let redacted = false;
  for (const key of parsed.searchParams.keys()) {
    if (isSensitiveMetadataKey(key)) {
      parsed.searchParams.set(key, "[redacted]");
      redacted = true;
    }
  }
  return redacted ? parsed.toString() : value;
}

function withoutOptionalPosterColumns(payload: Record<string, unknown>) {
  const {
    poster_image_url: _posterImageUrl,
    poster_image_alt: _posterImageAlt,
    poster_image_source_url: _posterImageSourceUrl,
    registration_qr_image_url: _registrationQrImageUrl,
    registration_qr_image_alt: _registrationQrImageAlt,
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
    message.includes("poster_image_source_url") ||
    message.includes("registration_qr_image_url") ||
    message.includes("registration_qr_image_alt")
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

function toProcessingLedgerRecord(
  row: ProcessingLedgerRow,
): AdminProcessingLedgerRecord {
  return {
    id: row.ledger_id,
    articleBundleId: row.article_bundle_id ?? undefined,
    sourceUrl: row.source_url,
    contentHash: row.content_hash ?? undefined,
    state: row.state,
    decision: row.decision ?? undefined,
    reason: row.reason ?? undefined,
    confidence: row.confidence ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    promptVersion: row.prompt_version ?? undefined,
    schemaVersion: row.schema_version ?? undefined,
    usageId: row.usage_id ?? undefined,
    draftId: row.draft_id ?? undefined,
    canonicalEventId: row.canonical_event_id ?? undefined,
    excludedArticleId: row.excluded_article_id ?? undefined,
    dataClass: row.data_class,
    errorDetails: row.error_details
      ? sanitizeJsonObject(row.error_details)
      : undefined,
    metadata: sanitizeJsonObject(row.metadata ?? {}),
    createdAt: row.created_at,
  };
}

function toEvaluationRunRecord(
  row: EvaluationRunRow,
  caseResults: AdminEvaluationCaseResultRecord[],
): AdminEvaluationRunRecord {
  return {
    runId: row.run_id,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    schemaVersion: row.schema_version,
    parameters: sanitizeJsonObject(row.parameters ?? {}),
    corpusVersion: row.corpus_version,
    status: row.status,
    validity: row.validity ?? "valid",
    invalidatedReason: row.invalidated_reason ?? undefined,
    invalidatedAt: row.invalidated_at ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    caseCount: row.case_count,
    passCount: row.pass_count,
    failCount: row.fail_count,
    summary: sanitizeJsonObject(row.summary ?? {}),
    artifactBucket: row.artifact_bucket ?? undefined,
    artifactPath: row.artifact_path ?? undefined,
    caseResults,
    createdAt: row.created_at,
  };
}

function toEvaluationCaseResultRecord(
  row: EvaluationCaseResultRow,
): AdminEvaluationCaseResultRecord {
  return {
    id: row.result_id,
    runId: row.run_id,
    caseId: row.case_id,
    articleBundleId: row.article_bundle_id ?? undefined,
    expectedAction: row.expected_action ?? undefined,
    actualAction: row.actual_action ?? undefined,
    passed: row.passed,
    scores: sanitizeJsonObject(row.scores ?? {}),
    errors: Array.isArray(row.errors)
      ? row.errors.map(sanitizeJsonValue)
      : [],
    usageId: row.usage_id ?? undefined,
    artifactPath: row.artifact_path ?? undefined,
    createdAt: row.created_at,
  };
}

function sanitizeJsonObject(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeLlmMetadata(input);
}

function toJobRecord(row: CollectorJobRow): AdminCollectorJobRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    seedUrl: row.seed_url,
    state: row.state,
    requestedAt: row.requested_at,
    claimedAt: row.claimed_at ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    collectorId: row.collector_id ?? undefined,
    captureRunId: row.capture_run_id ?? undefined,
    attemptNumber: row.attempt_number,
    lastHeartbeatAt: row.last_heartbeat_at ?? undefined,
    lastHeartbeatStage: row.last_heartbeat_stage ?? undefined,
    suggestedDisposition: row.suggested_disposition ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    articleBundleIds: row.article_bundle_ids ?? [],
    eventDraftIds: row.event_draft_ids ?? [],
    evidenceAssetIds: row.evidence_asset_ids ?? [],
    failureIds: row.failure_ids ?? [],
    resultMessage: row.result_message ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    preferredRunner: normalizeJobRunner(row.preferred_runner),
    actualRunner: row.actual_runner
      ? normalizeJobRunner(row.actual_runner)
      : undefined,
    runnerState: normalizeJobRunnerState(row.runner_state, row.state),
    fallbackEligible: false,
    fallbackReason: row.fallback_reason ?? undefined,
  };
}

function normalizeJobRunner(
  value: string,
): AdminCollectorJobRecord["preferredRunner"] {
  return "external_capture_worker";
}

function normalizeJobRunnerState(
  value: string,
  state: AdminCollectorJobRecord["state"],
): AdminCollectorJobRecord["runnerState"] {
  if (
    value === "external_pending" ||
    value === "external_running" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  if (state === "queued") return "external_pending";
  if (state === "claimed" || state === "running") return "external_running";
  if (state === "completed" || state === "partial") return "completed";
  return "failed";
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
    registrationQrImageUrl: row.registration_qr_image_url ?? undefined,
    registrationQrImageAlt: row.registration_qr_image_alt ?? undefined,
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
