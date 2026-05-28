import { createHash } from "node:crypto";

import type {
  ArticleSnapshot,
  CollectorEnvelope,
  CollectorFailure,
  EventDraftUpload,
  EvidenceAsset,
  SourceRunReport,
} from "../contracts/collector";

export type StoredCollectorObject = {
  id: string;
};

export type CollectorIngestStore = {
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
  ): Promise<StoredCollectorObject>;
  upsertCollectorFailure(
    input: CollectorEnvelope<CollectorFailure> & { failureId: string },
  ): Promise<StoredCollectorObject>;
};

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
) {
  return store.upsertEventDraft(envelope);
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
  if (!payload.title || !payload.startsAt || !payload.venueName) {
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
