import { describe, expect, it } from "vitest";

import type { EventDraftUpload } from "../contracts/collector";
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
            posterImageUrl: "https://cdn.example.com/posters/thai.png",
            posterImageAlt: "Thai Festival poster",
            posterImageSourceUrl: "https://mp.weixin.qq.com/poster.png",
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
          posterImageUrl: "https://cdn.example.com/posters/thai.png",
          posterImageAlt: "Thai Festival poster",
          posterImageSourceUrl: "https://mp.weixin.qq.com/poster.png",
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
    expect(upserts.find((entry) => entry.table === "event_drafts")?.payload)
      .toMatchObject({
        poster_image_url: "https://cdn.example.com/posters/thai.png",
        poster_image_alt: "Thai Festival poster",
        poster_image_source_url: "https://mp.weixin.qq.com/poster.png",
      });
    expect(upserts.find((entry) => entry.table === "canonical_events")?.payload)
      .toMatchObject({
        poster_image_url: "https://cdn.example.com/posters/thai.png",
        poster_image_alt: "Thai Festival poster",
        poster_image_source_url: "https://mp.weixin.qq.com/poster.png",
      });
  });

  it("falls back when optional poster columns are not migrated yet", async () => {
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseCollectorIngestStore(
      supabaseClientMissingPosterColumns(upserts),
    );

    await expect(
      store.upsertEventDraft(
        {
          collectorId: "collector-1",
          runId: "run-1",
          observedAt: "2026-05-29T08:00:00.000Z",
          payloadVersion: "2026-05-collector-v1",
          payload: eventDraftPayload(),
        },
        { reviewState: "approved" },
      ),
    ).resolves.toEqual({ id: "1" });

    await expect(
      store.publishEventDraft!({
        payload: eventDraftPayload(),
        publishedAt: "2026-05-29T08:00:00.000Z",
      }),
    ).resolves.toEqual({ id: "event-1" });

    const draftAttempts = upserts.filter((entry) => entry.table === "event_drafts");
    const eventAttempts = upserts.filter(
      (entry) => entry.table === "canonical_events",
    );
    expect(draftAttempts).toHaveLength(2);
    expect(eventAttempts).toHaveLength(2);
    expect(draftAttempts[0]?.payload).toHaveProperty("poster_image_url");
    expect(draftAttempts[1]?.payload).not.toHaveProperty("poster_image_url");
    expect(eventAttempts[0]?.payload).toHaveProperty("poster_image_url");
    expect(eventAttempts[1]?.payload).not.toHaveProperty("poster_image_url");
  });
});

function eventDraftPayload(): EventDraftUpload {
  return {
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
    posterImageUrl: "https://cdn.example.com/posters/thai.png",
    posterImageAlt: "Thai Festival poster",
    posterImageSourceUrl: "https://mp.weixin.qq.com/poster.png",
    signals: ["ready_for_review"],
    evidenceAssetIds: [],
    fieldEvidence: {},
    confidence: 0.9,
  };
}

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

function supabaseClientMissingPosterColumns(
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
          if (
            ["event_drafts", "canonical_events"].includes(table) &&
            upserts.at(-1)?.payload.poster_image_url !== undefined
          ) {
            return Promise.resolve({
              data: null,
              error: {
                message:
                  "Could not find the 'poster_image_url' column in the schema cache",
              },
            });
          }
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
