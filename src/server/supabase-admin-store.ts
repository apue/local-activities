import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AdminEventDraftRecord,
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
  confidence: number;
  review_state: AdminReviewState;
  evidence_asset_ids: string[];
  field_evidence: Record<string, string[]>;
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
    confidence: row.confidence,
    reviewState: row.review_state,
    evidenceAssetIds: row.evidence_asset_ids,
    fieldEvidence: row.field_evidence,
  };
}
