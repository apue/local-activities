import type { CollectorJobRecord } from "./collector-job-service";
import { extractFirstHttpUrl } from "../shared/seed-url";

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
  summary?: string;
  entryNotes?: string;
  triageDecision?:
    | "possible_public_activity"
    | "not_public_activity"
    | "needs_extraction"
    | "unknown";
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

export type PublishedAdminEvent = {
  id: string;
  title: string;
  status: "published";
  publishedAt: string;
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

export function listAdminEventDrafts(
  input: { reviewState?: string },
  store: AdminStore,
) {
  return store.listEventDrafts(input);
}

export async function getAdminEventDraftDetail(
  draftId: string,
  store: AdminStore,
) {
  const draft = await store.getEventDraft(draftId);
  if (!draft) throw new Error("draft_not_found");
  return draft;
}

export async function markAdminEventDraftNeedsInfo(
  draftId: string,
  store: AdminStore,
) {
  const draft = await store.updateEventDraftReviewState(draftId, "needs_info");
  if (!draft) throw new Error("draft_not_found");
  return draft;
}

export async function rejectAdminEventDraft(draftId: string, store: AdminStore) {
  const draft = await store.updateEventDraftReviewState(draftId, "rejected");
  if (!draft) throw new Error("draft_not_found");
  return draft;
}

export async function publishAdminEventDraft(
  draftId: string,
  store: AdminStore,
  now = new Date(),
) {
  const draft = await store.getEventDraft(draftId);
  if (!draft) throw new Error("draft_not_found");
  if (!isDraftPublishable(draft)) throw new Error("draft_not_publishable");

  return store.publishEventDraft({
    draft,
    publishedAt: now.toISOString(),
  });
}

function isDraftPublishable(draft: AdminEventDraftRecord) {
  return Boolean(
    draft.title &&
      draft.startsAt &&
      draft.articleUrl &&
      (draft.venueName || draft.venueAddress),
  );
}
