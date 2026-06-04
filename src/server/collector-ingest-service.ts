import { createHash } from "node:crypto";

import type {
  ArticleSnapshot,
  CollectorEnvelope,
  CollectorFailure,
  EventDraftUpload,
  ExcludedArticleUpload,
  EvidenceAsset,
  LlmUsageEventUpload,
  SourceCandidate,
  SourceRunReport,
} from "../contracts/collector";

export type StoredCollectorObject = {
  id: string;
};

export type NormalizedLlmUsagePayload = Omit<
  LlmUsageEventUpload,
  | "usageId"
  | "recordedAt"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "cachedInputTokens"
  | "reasoningOutputTokens"
  | "costMicroCny"
  | "sourceRunId"
  | "metadata"
> & {
  usageId: string;
  recordedAt: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  costMicroCny: number;
  sourceRunId: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type NormalizedLlmUsageEnvelope = Omit<
  CollectorEnvelope<LlmUsageEventUpload>,
  "payload"
> & {
  payload: NormalizedLlmUsagePayload;
};

export type CollectorIngestStore = {
  upsertSourceCandidate(
    input: CollectorEnvelope<SourceCandidate>,
  ): Promise<StoredCollectorObject>;
  upsertSourceRun(
    input: CollectorEnvelope<SourceRunReport>,
  ): Promise<StoredCollectorObject>;
  upsertArticleSnapshot(
    input: CollectorEnvelope<ArticleSnapshot>,
  ): Promise<StoredCollectorObject>;
  upsertEvidenceAsset(
    input: CollectorEnvelope<EvidenceAsset>,
  ): Promise<StoredCollectorObject>;
  upsertEventDraft(
    input: CollectorEnvelope<EventDraftUpload>,
    options?: { reviewState: DraftBackendRouting["reviewState"] },
  ): Promise<StoredCollectorObject>;
  upsertExcludedArticle?(
    input: CollectorEnvelope<ExcludedArticleUpload>,
  ): Promise<StoredCollectorObject>;
  upsertCollectorFailure(
    input: CollectorEnvelope<CollectorFailure> & { failureId: string },
  ): Promise<StoredCollectorObject>;
  insertLlmUsage?(
    input: NormalizedLlmUsageEnvelope,
  ): Promise<StoredCollectorObject>;
  publishEventDraft?(
    input: {
      payload: EventDraftUpload;
      publishedAt: string;
    },
  ): Promise<StoredCollectorObject>;
};

export type DraftBackendRouting = {
  reviewState: "needs_review" | "needs_info" | "ready_for_review" | "approved";
  autoPublished: boolean;
};

export type DraftBackendPolicy = {
  autoPublishEnabled?: boolean;
  autoPublishConfidenceThreshold?: number;
  now?: Date;
};

export async function ingestSourceCandidate(
  envelope: CollectorEnvelope<SourceCandidate>,
  store: CollectorIngestStore,
) {
  return store.upsertSourceCandidate(envelope);
}

export async function ingestSourceRun(
  envelope: CollectorEnvelope<SourceRunReport>,
  store: CollectorIngestStore,
) {
  return store.upsertSourceRun(envelope);
}

export async function ingestArticleSnapshot(
  envelope: CollectorEnvelope<ArticleSnapshot>,
  store: CollectorIngestStore,
) {
  return store.upsertArticleSnapshot(envelope);
}

export async function ingestEvidenceAsset(
  envelope: CollectorEnvelope<EvidenceAsset>,
  store: CollectorIngestStore,
) {
  return store.upsertEvidenceAsset(envelope);
}

export async function ingestEventDraft(
  envelope: CollectorEnvelope<EventDraftUpload>,
  store: CollectorIngestStore,
  policy: DraftBackendPolicy = {},
) {
  const routing = computeDraftBackendRouting(envelope.payload, policy);
  const draft = await store.upsertEventDraft(envelope, {
    reviewState: routing.reviewState,
  });
  if (!routing.autoPublished || !store.publishEventDraft) {
    return {
      ...draft,
      reviewState: routing.reviewState,
      autoPublished: false,
    };
  }

  const event = await store.publishEventDraft({
    payload: envelope.payload,
    publishedAt: (policy.now ?? new Date()).toISOString(),
  });
  return {
    ...draft,
    reviewState: "approved" as const,
    autoPublished: true,
    publishedEventId: event.id,
  };
}

export async function ingestExcludedArticle(
  envelope: CollectorEnvelope<ExcludedArticleUpload>,
  store: CollectorIngestStore,
) {
  if (!store.upsertExcludedArticle) {
    throw new Error("excluded_article_store_not_configured");
  }
  return store.upsertExcludedArticle(envelope);
}

export async function ingestCollectorFailure(
  envelope: CollectorEnvelope<CollectorFailure>,
  store: CollectorIngestStore,
) {
  return store.upsertCollectorFailure({
    ...envelope,
    failureId: createStableCollectorObjectId("failure", [
      envelope.collectorId,
      envelope.runId,
      envelope.payload.stage,
      envelope.payload.reason,
      envelope.payload.articleUrl ?? "",
    ]),
  });
}

export async function ingestLlmUsage(
  envelope: CollectorEnvelope<LlmUsageEventUpload>,
  store: CollectorIngestStore,
) {
  if (!store.insertLlmUsage) {
    throw new Error("llm_usage_store_not_configured");
  }
  return store.insertLlmUsage(normalizeLlmUsageEnvelope(envelope));
}

export function createStableCollectorObjectId(prefix: string, parts: string[]) {
  const hash = createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 24);

  return `${prefix}-${hash}`;
}

export function normalizeLlmUsageEnvelope(
  envelope: CollectorEnvelope<LlmUsageEventUpload>,
): NormalizedLlmUsageEnvelope {
  const payload = envelope.payload;
  const totalTokens =
    payload.totalTokens ?? (payload.inputTokens ?? 0) + (payload.outputTokens ?? 0);
  const normalizedPayload: NormalizedLlmUsagePayload = {
    ...payload,
    usageId:
      payload.usageId ??
      createStableCollectorObjectId("usage", [
        envelope.collectorId,
        envelope.runId,
        envelope.observedAt,
        payload.operation,
        payload.provider,
        payload.model,
        payload.status,
        payload.sourceRunId ?? "",
        payload.articleSnapshotId ?? "",
        payload.eventDraftId ?? "",
        payload.excludedArticleId ?? "",
      ]),
    recordedAt: payload.recordedAt ?? envelope.observedAt,
    inputTokens: payload.inputTokens ?? 0,
    outputTokens: payload.outputTokens ?? 0,
    totalTokens,
    cachedInputTokens: payload.cachedInputTokens ?? 0,
    reasoningOutputTokens: payload.reasoningOutputTokens ?? 0,
    costMicroCny: payload.costMicroCny ?? 0,
    sourceRunId: payload.sourceRunId ?? envelope.runId,
    metadata: payload.metadata ?? {},
  };

  return {
    ...envelope,
    payload: normalizedPayload,
  };
}

export function computeDraftReviewState(payload: EventDraftUpload) {
  if (!hasMinimumPublishFields(payload)) {
    return "needs_info" as const;
  }

  if (
    payload.signals.includes("possible_duplicate") ||
    payload.signals.includes("image_dominant") ||
    payload.signals.includes("qr_registration") ||
    payload.confidence < 0.75
  ) {
    return "needs_review" as const;
  }

  return "ready_for_review" as const;
}

export function computeDraftBackendRouting(
  payload: EventDraftUpload,
  policy: DraftBackendPolicy = {},
): DraftBackendRouting {
  const reviewState = computeDraftReviewState(payload);
  if (
    !policy.autoPublishEnabled ||
    !hasMinimumPublishFields(payload) ||
    hasBlockingSignal(payload) ||
    hasTriageReviewRequirement(payload) ||
    hasPublishBlockers(payload)
  ) {
    return {
      reviewState,
      autoPublished: false,
    };
  }

  return {
    reviewState: "approved",
    autoPublished: true,
  };
}

function hasBlockingSignal(payload: EventDraftUpload) {
  return payload.signals.some((signal) =>
    ["missing_required_public_field", "possible_duplicate"].includes(signal),
  );
}

function hasTriageReviewRequirement(payload: EventDraftUpload) {
  return payload.triageDecision === "possible_public_activity";
}

function hasPublishBlockers(payload: EventDraftUpload) {
  return Boolean(payload.hardBlockers?.length || payload.softBlockers?.length);
}

function hasMinimumPublishFields(payload: EventDraftUpload) {
  return Boolean(
    payload.title &&
      payload.startsAt &&
      payload.articleUrl &&
      (payload.venueName || payload.venueAddress),
  );
}
