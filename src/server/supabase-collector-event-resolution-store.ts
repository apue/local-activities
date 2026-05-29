import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CollectorEventResolutionStore,
  EventResolutionMentionInput,
  EventResolutionRevisionInput,
} from "./collector-event-resolution-route-handlers";
import { getSupabaseAdminClient } from "./supabase-admin";

export function getSupabaseCollectorEventResolutionStore(
  client = getSupabaseAdminClient(),
): CollectorEventResolutionStore {
  return new SupabaseCollectorEventResolutionStore(client);
}

class SupabaseCollectorEventResolutionStore
  implements CollectorEventResolutionStore
{
  constructor(private readonly client: SupabaseClient) {}

  async recordEventMention(input: EventResolutionMentionInput) {
    const canonicalEventId = await this.findCanonicalEventId(
      input.canonicalEventId,
    );
    const eventDraftId = await this.findEventDraftId(input.eventDraftId);
    const row = await this.writeOne<{ id: number }>(
      this.client
        .from("event_mentions")
        .insert({
          canonical_event_id: canonicalEventId,
          event_draft_id: eventDraftId,
          match_score: input.matchScore,
          match_reason: {
            ...input.matchReason,
            collectorId: input.collectorId,
          },
        })
        .select("id")
        .single(),
      "event_resolution_mention_write_failed",
    );

    return { id: `mention-${row.id}` };
  }

  async recordEventRevision(input: EventResolutionRevisionInput) {
    const canonicalEventId = await this.findCanonicalEventId(
      input.canonicalEventId,
    );
    const eventDraftId = await this.findEventDraftId(input.eventDraftId);
    const row = await this.writeOne<{ id: number }>(
      this.client
        .from("event_revisions")
        .insert({
          canonical_event_id: canonicalEventId,
          event_draft_id: eventDraftId,
          revision_type: input.revisionType,
          proposed_changes: input.proposedChanges,
          review_state: input.reviewState,
          source_evidence: {
            ...input.sourceEvidence,
            collectorId: input.collectorId,
          },
        })
        .select("id")
        .single(),
      "event_resolution_revision_write_failed",
    );

    return { id: `revision-${row.id}` };
  }

  private async findCanonicalEventId(eventId: string) {
    const row = await this.readMaybeOne<{ id: number }>(
      this.client
        .from("canonical_events")
        .select("id")
        .eq("event_id", eventId)
        .maybeSingle(),
      "event_resolution_event_lookup_failed",
    );
    if (!row) throw new Error("event_resolution_target_not_found");
    return row.id;
  }

  private async findEventDraftId(draftId: string) {
    const row = await this.readMaybeOne<{ id: number }>(
      this.client
        .from("event_drafts")
        .select("id")
        .eq("draft_id", draftId)
        .maybeSingle(),
      "event_resolution_draft_lookup_failed",
    );
    if (!row) throw new Error("event_resolution_draft_not_found");
    return row.id;
  }

  private async readMaybeOne<Row>(
    query: PromiseLike<{ data: Row | null; error: unknown }>,
    errorMessage: string,
  ) {
    const { data, error } = await query;
    if (error) throw new Error(errorMessage);
    return data;
  }

  private async writeOne<Row>(
    query: PromiseLike<{ data: Row | null; error: unknown }>,
    errorMessage: string,
  ) {
    const { data, error } = await query;
    if (error || !data) throw new Error(errorMessage);
    return data;
  }
}
