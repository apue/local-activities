import type { CollectorJobRecord } from "./collector-job-service";
import { extractFirstHttpUrl } from "../shared/seed-url";

export type AdminReviewState =
  | "needs_review"
  | "needs_info"
  | "possible_duplicate"
  | "ready_for_review"
  | "approved"
  | "rejected";

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
  summary?: string;
  entryNotes?: string;
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
