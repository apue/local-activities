import type { AdminCollectorJobRecord } from "./admin-collector-jobs";
import { computePublishDecision, type PublishDecision } from "./publish-policy";

export type AdminReviewState =
  | "needs_review"
  | "needs_info"
  | "possible_duplicate"
  | "ready_for_review"
  | "approved"
  | "rejected";

export type AdminPublishBlocker = {
  code: string;
  message: string;
  evidenceAssetIds?: string[];
};

export type AdminEventDraftRecord = {
  id: string;
  articleUrl: string;
  title?: string;
  originalTitle?: string;
  organizer?: string;
  startsAt?: string;
  endsAt?: string;
  timezone: "Asia/Shanghai";
  city: "Beijing";
  venueName?: string;
  venueAddress?: string;
  reservationStatus?: "required" | "not_required" | "unknown";
  registrationAction?: string;
  registrationUrl?: string;
  scheduleText?: string;
  posterImageUrl?: string;
  posterImageAlt?: string;
  posterImageSourceUrl?: string;
  registrationQrImageUrl?: string;
  registrationQrImageAlt?: string;
  summary?: string;
  entryNotes?: string;
  triageDecision?:
    | "public_activity"
    | "possible_public_activity"
    | "official_visit"
    | "non_public_news"
    | "internal_or_private"
    | "not_event"
    | "unsupported";
  triageAction?: "extract" | "exclude" | "review";
  triageConfidence?: number;
  publicSignals?: string[];
  exclusionSignals?: string[];
  publicEligibility?: "public" | "not_public" | "unclear";
  eventKind?:
    | "single"
    | "multi_day"
    | "long_running"
    | "recurring"
    | "news"
    | "visit"
    | "cancellation"
    | "unsupported";
  scheduleKind?:
    | "single"
    | "multi_day"
    | "long_running"
    | "recurring"
    | "unsupported";
  recurrenceRule?: string;
  occurrenceStartsAt?: string[];
  posterAssetId?: string;
  qrAssetId?: string;
  registrationQrAssetId?: string;
  hardBlockers?: AdminPublishBlocker[];
  softBlockers?: AdminPublishBlocker[];
  operatorOverrideReason?: string;
  publishDecision?: PublishDecision;
  resolutionDecision?:
    | "new_event"
    | "same_event"
    | "update_existing"
    | "cancel_existing"
    | "withdraw_existing"
    | "not_public_activity"
    | "insufficient_info";
  canonicalEventId?: string;
  processingState?:
    | "draft"
    | "ready_for_policy"
    | "blocked"
    | "auto_published"
    | "published"
    | "rejected";
  confidence: number;
  reviewState: AdminReviewState;
  evidenceAssetIds: string[];
  fieldEvidence: Record<string, string[]>;
};

export class AdminDraftPublishBlockedError extends Error {
  publishDecision: PublishDecision;

  constructor(publishDecision: PublishDecision) {
    super("draft_not_publishable");
    this.name = "AdminDraftPublishBlockedError";
    this.publishDecision = publishDecision;
  }
}

export type AdminEventDraftPatch = Partial<
  Omit<
    Pick<
      AdminEventDraftRecord,
      | "title"
      | "startsAt"
      | "endsAt"
      | "venueName"
      | "venueAddress"
      | "scheduleText"
      | "scheduleKind"
      | "recurrenceRule"
      | "occurrenceStartsAt"
      | "registrationUrl"
      | "registrationQrAssetId"
      | "summary"
      | "entryNotes"
    >,
    "endsAt"
  >
> & {
  endsAt?: string | null;
};

export type PublishedAdminEvent = {
  id: string;
  title: string;
  status: "published";
  publishedAt: string;
};

export type AdminExcludedArticleRecord = {
  id: string;
  articleUrl: string;
  triageDecision: string;
  triageAction: "exclude";
  confidence: number;
  publicSignals: string[];
  exclusionSignals: string[];
  exclusionReason: string;
  evidenceAssetIds: string[];
  promptVersion: string;
  schemaVersion: string;
  provider: string;
  model: string;
  processingState: "excluded" | "promoted_to_extraction";
  promotedAt?: string;
  createdAt?: string;
};

export type AdminProcessingLedgerState =
  | "captured"
  | "analysis_started"
  | "published"
  | "needs_review"
  | "needs_info"
  | "excluded"
  | "duplicate"
  | "failed";

export type AdminProcessingLedgerMode = "production" | "eval";

export type AdminProcessingLedgerRecord = {
  id: string;
  articleBundleId?: string;
  sourceUrl: string;
  contentHash?: string;
  state: AdminProcessingLedgerState;
  decision?: string;
  reason?: string;
  confidence?: number;
  provider?: string;
  model?: string;
  promptVersion?: string;
  schemaVersion?: string;
  usageId?: string;
  draftId?: string;
  canonicalEventId?: string;
  excludedArticleId?: string;
  mode: AdminProcessingLedgerMode;
  errorDetails?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AdminEvaluationCaseResultRecord = {
  id: string;
  runId: string;
  caseId: string;
  articleBundleId?: string;
  expectedAction?: string;
  actualAction?: string;
  passed: boolean;
  scores: Record<string, unknown>;
  errors: unknown[];
  usageId?: string;
  artifactPath?: string;
  createdAt: string;
};

export type AdminEvaluationRunRecord = {
  runId: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  parameters: Record<string, unknown>;
  corpusVersion: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  caseCount: number;
  passCount: number;
  failCount: number;
  summary: Record<string, unknown>;
  artifactBucket?: string;
  artifactPath?: string;
  caseResults: AdminEvaluationCaseResultRecord[];
  createdAt: string;
};

export type AdminLlmUsageStatus = "succeeded" | "failed";

export type AdminLlmUsageRecord = {
  id: string;
  recordedAt: string;
  operation: string;
  provider: string;
  model: string;
  status: AdminLlmUsageStatus;
  mode?: "production" | "eval";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  costMicroCny: number;
  latencyMs?: number;
  sourceRunId?: string;
  collectorJobId?: string;
  articleBundleId?: string;
  eventDraftId?: string;
  excludedArticleId?: string;
  evaluationRunId?: string;
  metadata: Record<string, unknown>;
};

export type AdminLlmUsageModelSummary = {
  provider: string;
  model: string;
  operation: string;
  workload: string;
  environment: string;
  requestCount: number;
  totalTokens: number;
  costMicroCny: number;
};

export type AdminLlmUsageEnvironmentSummary = {
  environment: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  totalTokens: number;
  costMicroCny: number;
  latestRecordedAt?: string;
};

export type AdminLlmUsageRunSummary = {
  runId: string;
  environment: string;
  requestCount: number;
  totalTokens: number;
  costMicroCny: number;
  latestRecordedAt?: string;
};

export type AdminLlmUsageRangeKey = "today" | "7d" | "all";

export type AdminLlmUsageRange = {
  key: AdminLlmUsageRangeKey;
  label: string;
  startsAt?: string;
};

export type AdminLlmUsageSummary = {
  range: AdminLlmUsageRange;
  latestRecordedAt?: string;
  totals: {
    requestCount: number;
    successCount: number;
    errorCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costMicroCny: number;
  };
  byModel: AdminLlmUsageModelSummary[];
  byEnvironment: AdminLlmUsageEnvironmentSummary[];
  byRun: AdminLlmUsageRunSummary[];
  recent: AdminLlmUsageRecord[];
};

export type AdminStore = {
  listCollectorJobs(): Promise<AdminCollectorJobRecord[]>;
  listEventDrafts(input: {
    reviewState?: string;
  }): Promise<AdminEventDraftRecord[]>;
  getEventDraft(draftId: string): Promise<AdminEventDraftRecord | null>;
  updateEventDraftReviewState(
    draftId: string,
    reviewState: AdminReviewState,
    options?: { reason?: string },
  ): Promise<AdminEventDraftRecord | null>;
  updateEventDraftFields(
    draftId: string,
    patch: AdminEventDraftPatch,
  ): Promise<AdminEventDraftRecord | null>;
  listExcludedArticles(input: {
    processingState?: AdminExcludedArticleRecord["processingState"];
  }): Promise<AdminExcludedArticleRecord[]>;
  promoteExcludedArticle(
    excludedArticleId: string,
    promotedAt: string,
  ): Promise<AdminExcludedArticleRecord | null>;
  listProcessingLedger(input: {
    state?: AdminProcessingLedgerState;
    mode?: AdminProcessingLedgerMode;
  }): Promise<AdminProcessingLedgerRecord[]>;
  listEvaluationRuns(input: {
    status?: AdminEvaluationRunRecord["status"];
  }): Promise<AdminEvaluationRunRecord[]>;
  getLlmUsageSummary(input: {
    startsAt?: string;
    range: AdminLlmUsageRange;
  }): Promise<AdminLlmUsageSummary>;
  publishEventDraft(input: {
    draft: AdminEventDraftRecord;
    publishedAt: string;
  }): Promise<PublishedAdminEvent>;
};

export function listAdminCollectorJobs(store: AdminStore) {
  return store.listCollectorJobs();
}

export async function listAdminEventDrafts(
  input: { reviewState?: string },
  store: AdminStore,
) {
  const drafts = await store.listEventDrafts(input);
  return drafts.map(withPublishDecision);
}

export function listAdminExcludedArticles(
  input: { processingState?: AdminExcludedArticleRecord["processingState"] },
  store: AdminStore,
) {
  return store.listExcludedArticles(input);
}

export function listAdminProcessingLedger(
  input: {
    state?: AdminProcessingLedgerState;
    mode?: AdminProcessingLedgerMode;
  },
  store: AdminStore,
) {
  return store.listProcessingLedger(input);
}

export function listAdminEvaluationRuns(
  input: { status?: AdminEvaluationRunRecord["status"] },
  store: AdminStore,
) {
  return store.listEvaluationRuns(input);
}

export function listAdminLlmUsageSummary(
  input: { range?: AdminLlmUsageRangeKey } = {},
  store: AdminStore,
  now = new Date(),
) {
  const range = resolveAdminLlmUsageRange(input.range ?? "today", now);
  return store.getLlmUsageSummary({
    startsAt: range.startsAt,
    range,
  });
}

export async function promoteAdminExcludedArticle(
  excludedArticleId: string,
  store: AdminStore,
  now = new Date(),
) {
  const article = await store.promoteExcludedArticle(
    excludedArticleId,
    now.toISOString(),
  );
  if (!article) throw new Error("excluded_article_not_found");
  return article;
}

export async function getAdminEventDraftDetail(
  draftId: string,
  store: AdminStore,
) {
  const draft = await store.getEventDraft(draftId);
  if (!draft) throw new Error("draft_not_found");
  return withPublishDecision(draft);
}

export async function patchAdminEventDraft(
  draftId: string,
  patch: AdminEventDraftPatch,
  store: AdminStore,
) {
  const draft = await store.updateEventDraftFields(draftId, patch);
  if (!draft) throw new Error("draft_not_found");
  return withPublishDecision(draft);
}

export async function markAdminEventDraftNeedsInfo(
  draftId: string,
  store: AdminStore,
) {
  const draft = await store.updateEventDraftReviewState(draftId, "needs_info");
  if (!draft) throw new Error("draft_not_found");
  return withPublishDecision(draft);
}

export async function rejectAdminEventDraft(
  draftId: string,
  store: AdminStore,
  options: { reason: string },
) {
  const reason = options.reason.trim();
  const draft = await store.updateEventDraftReviewState(
    draftId,
    "rejected",
    { reason },
  );
  if (!draft) throw new Error("draft_not_found");
  return withPublishDecision(draft);
}

export async function publishAdminEventDraft(
  draftId: string,
  store: AdminStore,
  now = new Date(),
  options: { operatorOverrideReason?: string } = {},
) {
  const draft = await store.getEventDraft(draftId);
  if (!draft) throw new Error("draft_not_found");
  const decision = computePublishDecision(draft, options);
  if (!decision.canPublish) throw new AdminDraftPublishBlockedError(decision);

  return store.publishEventDraft({
    draft: {
      ...draft,
      hardBlockers: decision.hardBlockers,
      softBlockers: decision.softBlockers,
      operatorOverrideReason:
        options.operatorOverrideReason ?? draft.operatorOverrideReason,
    },
    publishedAt: now.toISOString(),
  });
}

function withPublishDecision(draft: AdminEventDraftRecord): AdminEventDraftRecord {
  return {
    ...draft,
    publishDecision: computePublishDecision(draft),
  };
}

export function resolveAdminLlmUsageRange(
  key: AdminLlmUsageRangeKey,
  now = new Date(),
): AdminLlmUsageRange {
  if (key === "all") {
    return { key, label: "All" };
  }
  if (key === "7d") {
    return {
      key,
      label: "Last 7 days",
      startsAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  return {
    key: "today",
    label: "Today",
    startsAt: startOfShanghaiDay(now).toISOString(),
  };
}

function startOfShanghaiDay(now: Date) {
  const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
  const shanghaiDate = new Date(now.getTime() + shanghaiOffsetMs);
  return new Date(
    Date.UTC(
      shanghaiDate.getUTCFullYear(),
      shanghaiDate.getUTCMonth(),
      shanghaiDate.getUTCDate(),
    ) - shanghaiOffsetMs,
  );
}
