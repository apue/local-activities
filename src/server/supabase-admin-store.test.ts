import { describe, expect, it } from "vitest";

import { getSupabaseAdminStore } from "./supabase-admin-store";

describe("supabase admin store", () => {
  it("maps Event Pipeline V2 draft review fields for admin records", async () => {
    const store = getSupabaseAdminStore(
      supabaseClientReturningEventDrafts([
        {
          id: 1,
          draft_id: "draft-v2",
          article_url: "https://mp.weixin.qq.com/s/activity",
          title: "Weekly Library Meetup",
          original_title: "每周六，来歌德798图书馆",
          organizer: "Goethe-Institut Beijing",
          starts_at: "2026-06-06T08:00:00.000Z",
          ends_at: null,
          timezone: "Asia/Shanghai",
          city: "Beijing",
          venue_name: "Goethe 798 Library",
          venue_address: null,
          reservation_status: "not_required",
          registration_action: null,
          registration_url: null,
          schedule_text: "Every Saturday 16:00-17:00",
          poster_image_url: null,
          poster_image_alt: null,
          poster_image_source_url: null,
          summary: "A weekly public library meetup.",
          entry_notes: null,
          triage_decision: "public_activity",
          triage_action: "extract",
          triage_confidence: 0.97,
          public_signals: ["public venue", "weekly schedule"],
          exclusion_signals: [],
          public_eligibility: "public",
          event_kind: "recurring",
          schedule_kind: "recurring",
          recurrence_rule: "FREQ=WEEKLY;BYDAY=SA",
          occurrence_starts_at: ["2026-06-06T08:00:00.000Z"],
          poster_asset_id: "asset-poster-1",
          qr_asset_id: "asset-qr-1",
          registration_qr_asset_id: "asset-qr-1",
          hard_blockers: [],
          soft_blockers: [
            { code: "missing_end_time", message: "No end time" },
          ],
          operator_override_reason: "Public page is readable enough.",
          resolution_decision: "new_event",
          canonical_event_id: "42",
          processing_state: "ready_for_policy",
          confidence: 0.97,
          review_state: "ready_for_review",
          evidence_asset_ids: ["asset-poster-1"],
          field_evidence: { title: ["asset-poster-1"] },
        },
      ]),
    );

    await expect(store.listEventDrafts({})).resolves.toEqual([
      expect.objectContaining({
        id: "draft-v2",
        triageDecision: "public_activity",
        triageAction: "extract",
        triageConfidence: 0.97,
        publicSignals: ["public venue", "weekly schedule"],
        publicEligibility: "public",
        scheduleKind: "recurring",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=SA",
        occurrenceStartsAt: ["2026-06-06T08:00:00.000Z"],
        posterAssetId: "asset-poster-1",
        registrationQrAssetId: "asset-qr-1",
        softBlockers: [{ code: "missing_end_time", message: "No end time" }],
        operatorOverrideReason: "Public page is readable enough.",
        resolutionDecision: "new_event",
        canonicalEventId: "42",
        processingState: "ready_for_policy",
      }),
    ]);
  });

  it("maps collector job result fields for admin smoke verification", async () => {
    const store = getSupabaseAdminStore(
      supabaseClientReturning([
        {
          id: 1,
          job_id: "job-1",
          seed_url: "https://example.com/a",
          state: "failed",
          requested_at: "2026-05-28T08:00:00.000Z",
          claimed_at: "2026-05-28T08:01:00.000Z",
          lease_expires_at: "2026-05-28T08:20:00.000Z",
          collector_id: "sandbox-job-1",
          local_run_id: "sandbox-job-1-1",
          attempt_number: 1,
          last_heartbeat_at: null,
          last_heartbeat_stage: null,
          suggested_disposition: "failed",
          source_run_id: "run-1",
          article_snapshot_ids: ["snapshot-1"],
          event_draft_ids: [],
          evidence_asset_ids: ["evidence-1"],
          failure_ids: ["failure-1"],
          result_message: "Structured failure uploaded.",
          finished_at: "2026-05-28T08:02:00.000Z",
          preferred_runner: "vercel_sandbox",
          actual_runner: "vercel_sandbox",
          runner_state: "failed",
          fallback_eligible: false,
          fallback_reason: null,
          sandbox_run_id: "sb-1",
        },
      ]),
    );

    await expect(store.listCollectorJobs()).resolves.toMatchObject([
      {
        jobId: "job-1",
        sourceRunId: "run-1",
        articleSnapshotIds: ["snapshot-1"],
        eventDraftIds: [],
        evidenceAssetIds: ["evidence-1"],
        failureIds: ["failure-1"],
        finishedAt: "2026-05-28T08:02:00.000Z",
      },
    ]);
  });

  it("publishes drafts without poster fields when poster columns are pending", async () => {
    const inserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseAdminStore(
      supabaseClientMissingPosterColumnsForPublish(inserts),
    );

    await expect(
      store.publishEventDraft({
        draft: {
          id: "draft-1",
          articleUrl: "https://mp.weixin.qq.com/s/example",
          title: "Thai Festival Beijing 2026",
          organizer: "Thai Embassy",
          startsAt: "2026-05-30T10:30:00+08:00",
          endsAt: "2026-05-31T18:00:00+08:00",
          timezone: "Asia/Shanghai",
          city: "Beijing",
          venueName: "北京朝阳公园",
          reservationStatus: "not_required",
          scheduleText: "2026年5月30日-31日 10:30-18:00",
          publicEligibility: "public",
          eventKind: "multi_day",
          scheduleKind: "multi_day",
          occurrenceStartsAt: [
            "2026-05-30T02:30:00.000Z",
            "2026-05-31T02:30:00.000Z",
          ],
          posterAssetId: "asset-poster-1",
          registrationQrAssetId: "asset-qr-1",
          hardBlockers: [],
          softBlockers: [
            { code: "missing_registration_url", message: "QR only" },
          ],
          operatorOverrideReason: "QR poster is enough for attendees.",
          resolutionDecision: "new_event",
          posterImageUrl: "https://cdn.example.com/posters/thai.png",
          posterImageAlt: "Thai Festival poster",
          posterImageSourceUrl: "https://mp.weixin.qq.com/poster.png",
          confidence: 0.9,
          reviewState: "ready_for_review",
          evidenceAssetIds: [],
          fieldEvidence: {},
        },
        publishedAt: "2026-05-29T08:00:00.000Z",
      }),
    ).resolves.toEqual({
      id: "event-1",
      title: "Thai Festival Beijing 2026",
      status: "published",
      publishedAt: "2026-05-29T08:00:00.000Z",
    });

    const eventAttempts = inserts.filter(
      (entry) => entry.table === "canonical_events",
    );
    expect(eventAttempts).toHaveLength(2);
    expect(eventAttempts[0]?.payload).toHaveProperty("poster_image_url");
    expect(eventAttempts[1]?.payload).not.toHaveProperty("poster_image_url");
    expect(eventAttempts[1]?.payload).toMatchObject({
      schedule_text: "2026年5月30日-31日 10:30-18:00",
      public_eligibility: "public",
      event_kind: "multi_day",
      schedule_kind: "multi_day",
      occurrence_starts_at: [
        "2026-05-30T02:30:00.000Z",
        "2026-05-31T02:30:00.000Z",
      ],
      poster_asset_id: "asset-poster-1",
      registration_qr_asset_id: "asset-qr-1",
      soft_blockers: [
        { code: "missing_registration_url", message: "QR only" },
      ],
      operator_override_reason: "QR poster is enough for attendees.",
      resolution_decision: "new_event",
    });
  });
});

function supabaseClientReturningEventDrafts(rows: unknown[]) {
  const query = {
    select() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };

  return {
    from(table: string) {
      expect(table).toBe("event_drafts");
      return query;
    },
  } as never;
}

function supabaseClientReturning(rows: unknown[]) {
  const query = {
    select() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };

  return {
    from(table: string) {
      expect(table).toBe("collector_jobs");
      return query;
    },
  } as never;
}

function supabaseClientMissingPosterColumnsForPublish(
  inserts: Array<{ table: string; payload: Record<string, unknown> }>,
) {
  return {
    from(table: string) {
      const query = {
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return query;
        },
        select() {
          return query;
        },
        single() {
          if (
            table === "canonical_events" &&
            inserts.at(-1)?.payload.poster_image_url !== undefined
          ) {
            return Promise.resolve({
              data: null,
              error: {
                message:
                  "Could not find the 'poster_image_url' column in the schema cache",
              },
            });
          }
          return Promise.resolve({
            data: {
              id: 1,
              event_id: "event-1",
              title: "Thai Festival Beijing 2026",
              status: "published",
              published_at: "2026-05-29T08:00:00.000Z",
            },
            error: null,
          });
        },
        update() {
          return query;
        },
        eq() {
          return Promise.resolve({ error: null });
        },
      };
      return query;
    },
  } as never;
}
