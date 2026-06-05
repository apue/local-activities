import type { CollectorJobRecord } from "./collector-job-service";
import { extractFirstHttpUrl } from "../shared/seed-url";
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

export type AdminLlmUsageStatus = "succeeded" | "failed";

export type AdminLlmUsageRecord = {
  id: string;
  recordedAt: string;
  operation: string;
  provider: string;
  model: string;
  status: AdminLlmUsageStatus;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  costMicroCny: number;
  latencyMs?: number;
  sourceRunId?: string;
  collectorJobId?: string;
  articleSnapshotId?: string;
  eventDraftId?: string;
  excludedArticleId?: string;
  metadata: Record<string, unknown>;
};

export type AdminLlmUsageModelSummary = {
  provider: string;
  model: string;
  operation: string;
  requestCount: number;
  totalTokens: number;
  costMicroCny: number;
};

export type AdminLlmUsageSummary = {
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
  recent: AdminLlmUsageRecord[];
};

export type AdminStore = {
  createCollectorJob(input: {
    seedUrl: string;
    requestedAt: string;
    preferredRunner: CollectorJobRecord["preferredRunner"];
  }): Promise<CollectorJobRecord>;
  listCollectorJobs(): Promise<CollectorJobRecord[]>;
  listEventDrafts(input: {
    reviewState?: string;
  }): Promise<AdminEventDraftRecord[]>;
  getEventDraft(draftId: string): Promise<AdminEventDraftRecord | null>;
  updateEventDraftReviewState(
    draftId: string,
    reviewState: AdminReviewState,
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
  getLlmUsageSummary(): Promise<AdminLlmUsageSummary>;
  publishEventDraft(input: {
    draft: AdminEventDraftRecord;
    publishedAt: string;
  }): Promise<PublishedAdminEvent>;
};

export async function createAdminCollectorJob(
  input: {
    seedUrl: string;
    preferredRunner?: CollectorJobRecord["preferredRunner"];
  },
  store: AdminStore,
  now = new Date(),
) {
  const extractedSeedUrl = extractFirstHttpUrl(input.seedUrl);
  if (!extractedSeedUrl) {
    throw new Error("invalid_seed_url");
  }

  return store.createCollectorJob({
    seedUrl: extractedSeedUrl,
    requestedAt: now.toISOString(),
    preferredRunner: input.preferredRunner ?? "vercel_sandbox",
  });
}

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

export function listAdminLlmUsageSummary(store: AdminStore) {
  return store.getLlmUsageSummary();
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

export async function rejectAdminEventDraft(draftId: string, store: AdminStore) {
  const draft = await store.updateEventDraftReviewState(draftId, "rejected");
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
