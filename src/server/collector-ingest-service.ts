import { createHash } from "node:crypto";

import type {
  ArticleSnapshot,
  CollectorEnvelope,
  CollectorFailure,
  EventDraftUpload,
  EvidenceAsset,
  SourceCandidate,
  SourceRunReport,
} from "../contracts/collector";

export type StoredCollectorObject = {
  id: string;
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
  upsertCollectorFailure(
    input: CollectorEnvelope<CollectorFailure> & { failureId: string },
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

export function createStableCollectorObjectId(prefix: string, parts: string[]) {
  const hash = createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 24);

  return `${prefix}-${hash}`;
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
    hasBlockingSignal(payload)
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

function hasMinimumPublishFields(payload: EventDraftUpload) {
  return Boolean(
    payload.title &&
      payload.startsAt &&
      payload.articleUrl &&
      (payload.venueName || payload.venueAddress),
  );
}
