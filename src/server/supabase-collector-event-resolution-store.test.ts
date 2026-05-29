import { describe, expect, it } from "vitest";

import { getSupabaseCollectorEventResolutionStore } from "./supabase-collector-event-resolution-store";

describe("supabase collector event resolution store", () => {
  it("records same-event decisions as event mentions", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const store = getSupabaseCollectorEventResolutionStore(
      supabaseClientForResolution(calls),
    );

    await expect(
      store.recordEventMention({
        collectorId: "home-1",
        eventDraftId: "draft-1",
        canonicalEventId: "event-1",
        matchScore: 0.94,
        matchReason: {
          decision: "same_event",
          rationale: "Same title and overlapping time.",
        },
      }),
    ).resolves.toEqual({ id: "mention-10" });

    expect(calls).toContainEqual(["from", ["canonical_events"]]);
    expect(calls).toContainEqual(["eq", ["event_id", "event-1"]]);
    expect(calls).toContainEqual(["from", ["event_drafts"]]);
    expect(calls).toContainEqual(["eq", ["draft_id", "draft-1"]]);
    expect(calls).toContainEqual([
      "insert",
      [
        {
          canonical_event_id: 101,
          event_draft_id: 201,
          match_score: 0.94,
          match_reason: {
            decision: "same_event",
            rationale: "Same title and overlapping time.",
            collectorId: "home-1",
          },
        },
      ],
    ]);
  });

  it("records update decisions as approved event revisions", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const store = getSupabaseCollectorEventResolutionStore(
      supabaseClientForResolution(calls),
    );

    await expect(
      store.recordEventRevision({
        collectorId: "home-1",
        eventDraftId: "draft-1",
        canonicalEventId: "event-1",
        revisionType: "update",
        proposedChanges: {
          venueName: "New Hall",
        },
        reviewState: "approved",
        sourceEvidence: {
          decision: "update_existing",
          confidence: 0.9,
          rationale: "Venue changed.",
        },
      }),
    ).resolves.toEqual({ id: "revision-20" });

    expect(calls).toContainEqual([
      "insert",
      [
        {
          canonical_event_id: 101,
          event_draft_id: 201,
          revision_type: "update",
          proposed_changes: {
            venueName: "New Hall",
          },
          review_state: "approved",
          source_evidence: {
            decision: "update_existing",
            confidence: 0.9,
            rationale: "Venue changed.",
            collectorId: "home-1",
          },
        },
      ],
    ]);
  });
});

function supabaseClientForResolution(calls: Array<[string, unknown[]]>) {
  return {
    from(table: string) {
      calls.push(["from", [table]]);
      return createQuery(calls, table);
    },
  } as never;
}

function createQuery(calls: Array<[string, unknown[]]>, table: string) {
  const query = {
    select(...args: unknown[]) {
      calls.push(["select", args]);
      return query;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", args]);
      return query;
    },
    insert(...args: unknown[]) {
      calls.push(["insert", args]);
      return query;
    },
    maybeSingle() {
      if (table === "canonical_events") {
        return Promise.resolve({ data: { id: 101 }, error: null });
      }
      if (table === "event_drafts") {
        return Promise.resolve({ data: { id: 201 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    single() {
      if (table === "event_mentions") {
        return Promise.resolve({ data: { id: 10 }, error: null });
      }
      if (table === "event_revisions") {
        return Promise.resolve({ data: { id: 20 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return query;
}
