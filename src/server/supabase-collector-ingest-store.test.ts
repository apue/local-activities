import { describe, expect, it } from "vitest";

import { getSupabaseCollectorIngestStore } from "./supabase-collector-ingest-store";

describe("supabase collector ingest store", () => {
  it("does not require optional schedule_text columns when publishing drafts", async () => {
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const store = getSupabaseCollectorIngestStore(
      supabaseClientForEventDraftPublish(upserts),
    );

    await expect(
      store.upsertEventDraft(
        {
          collectorId: "collector-1",
          runId: "run-1",
          observedAt: "2026-05-29T08:00:00.000Z",
          payloadVersion: "2026-05-collector-v1",
          payload: {
            articleUrl: "https://mp.weixin.qq.com/s/example",
            extractionAttemptId: "attempt-1",
            captureMode: "text_complete",
            title: "Thai Festival Beijing 2026",
            startsAt: "2026-05-30T10:30:00+08:00",
            endsAt: "2026-05-31T18:00:00+08:00",
            timezone: "Asia/Shanghai",
            venueName: "北京朝阳公园",
            city: "Beijing",
            scheduleText: "5月30日至31日每日10:30-18:00",
            signals: ["ready_for_review"],
            evidenceAssetIds: [],
            fieldEvidence: {},
            confidence: 0.9,
          },
        },
        { reviewState: "approved" },
      ),
    ).resolves.toEqual({ id: "1" });

    await expect(
      store.publishEventDraft!({
        payload: {
          articleUrl: "https://mp.weixin.qq.com/s/example",
          extractionAttemptId: "attempt-1",
          captureMode: "text_complete",
          title: "Thai Festival Beijing 2026",
          startsAt: "2026-05-30T10:30:00+08:00",
          endsAt: "2026-05-31T18:00:00+08:00",
          timezone: "Asia/Shanghai",
          venueName: "北京朝阳公园",
          city: "Beijing",
          scheduleText: "5月30日至31日每日10:30-18:00",
          signals: ["ready_for_review"],
          evidenceAssetIds: [],
          fieldEvidence: {},
          confidence: 0.9,
        },
        publishedAt: "2026-05-29T08:00:00.000Z",
      }),
    ).resolves.toEqual({ id: "event-1" });

    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "event_drafts" }),
        expect.objectContaining({ table: "canonical_events" }),
      ]),
    );
    expect(upserts.find((entry) => entry.table === "event_drafts")?.payload).not
      .toHaveProperty("schedule_text");
    expect(upserts.find((entry) => entry.table === "canonical_events")?.payload)
      .not.toHaveProperty("schedule_text");
  });
});

function supabaseClientForEventDraftPublish(
  upserts: Array<{ table: string; payload: Record<string, unknown> }>,
) {
  return {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: { id: 10 }, error: null });
        },
        upsert(payload: Record<string, unknown>) {
          upserts.push({ table, payload });
          return query;
        },
        single() {
          const data =
            table === "canonical_events"
              ? { event_id: "event-1" }
              : { id: 1 };
          return Promise.resolve({ data, error: null });
        },
      };
      return query;
    },
  } as never;
}
