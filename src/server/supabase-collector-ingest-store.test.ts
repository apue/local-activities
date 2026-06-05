import { describe, expect, it } from "vitest";

import type { EventDraftUpload } from "../contracts/collector";
import { getSupabaseCollectorIngestStore } from "./supabase-collector-ingest-store";

describe("supabase collector ingest store", () => {
  it("persists schedule text while publishing drafts", async () => {
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
    expect(upserts.find((entry) => entry.table === "event_drafts")?.payload)
      .toHaveProperty("schedule_text", "5月30日至31日每日10:30-18:00");
    expect(upserts.find((entry) => entry.table === "canonical_events")?.payload)
      .toHaveProperty("schedule_text", "5月30日至31日每日10:30-18:00");
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

  it("persists Event Pipeline V2 draft fields without optional-column fallback", async () => {
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseCollectorIngestStore(
      supabaseClientForEventDraftPublish(upserts),
    );

    await expect(
      store.upsertEventDraft(
        {
          collectorId: "collector-1",
          runId: "run-1",
          observedAt: "2026-06-03T08:00:00.000Z",
          payloadVersion: "2026-05-collector-v1",
          payload: eventPipelineV2DraftPayload(),
        },
        { reviewState: "needs_review" },
      ),
    ).resolves.toEqual({ id: "1" });

    expect(upserts.find((entry) => entry.table === "event_drafts")?.payload)
      .toMatchObject({
        triage_decision: "public_activity",
        triage_action: "extract",
        triage_confidence: 0.97,
        public_eligibility: "public",
        event_kind: "long_running",
        schedule_kind: "long_running",
        schedule_text: "Through 2026-08-30, Tue-Sun 10:00-18:00",
        recurrence_rule: "FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA,SU",
        occurrence_starts_at: ["2026-06-04T02:00:00.000Z"],
        poster_asset_id: "asset-poster-1",
        qr_asset_id: "asset-qr-1",
        registration_qr_asset_id: "asset-qr-1",
        hard_blockers: [],
        soft_blockers: [{ code: "low_confidence", message: "Review confidence" }],
        resolution_decision: "new_event",
      });
  });

  it("resolves public poster and registration QR evidence URLs for drafts and published events", async () => {
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseCollectorIngestStore(
      supabaseClientForEventDraftPublish(upserts, [
        {
          asset_id: "asset-poster-1",
          role: "poster",
          storage_path: "https://blob.example.com/posters/activity.png",
          source_url: "https://mmbiz.qpic.cn/source-poster.png",
          text_content: "Activity poster",
        },
        {
          asset_id: "asset-qr-1",
          role: "registration",
          storage_path: "https://blob.example.com/qr/register.png",
          source_url: "https://mmbiz.qpic.cn/source-qr.png",
          text_content: "Registration QR",
        },
      ]),
    );
    const payload = {
      ...eventPipelineV2DraftPayload(),
      posterImageUrl: undefined,
      posterImageAlt: undefined,
      posterImageSourceUrl: undefined,
    };

    await expect(
      store.upsertEventDraft(
        {
          collectorId: "collector-1",
          runId: "run-1",
          observedAt: "2026-06-03T08:00:00.000Z",
          payloadVersion: "2026-05-collector-v1",
          payload,
        },
        { reviewState: "needs_review" },
      ),
    ).resolves.toEqual({ id: "1" });
    await expect(
      store.publishEventDraft!({
        payload,
        publishedAt: "2026-06-03T09:00:00.000Z",
      }),
    ).resolves.toEqual({ id: "event-1" });

    expect(upserts.find((entry) => entry.table === "event_drafts")?.payload)
      .toMatchObject({
        poster_image_url: "https://blob.example.com/posters/activity.png",
        poster_image_alt: "Activity poster",
        poster_image_source_url: "https://mmbiz.qpic.cn/source-poster.png",
        registration_qr_image_url: "https://blob.example.com/qr/register.png",
        registration_qr_image_alt: "Registration QR",
      });
    expect(upserts.find((entry) => entry.table === "canonical_events")?.payload)
      .toMatchObject({
        poster_image_url: "https://blob.example.com/posters/activity.png",
        registration_qr_image_url: "https://blob.example.com/qr/register.png",
      });
  });

  it("does not resolve placeholder fixture asset paths as public image URLs", async () => {
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseCollectorIngestStore(
      supabaseClientForEventDraftPublish(upserts, [
        {
          asset_id: "asset-poster-1",
          role: "poster",
          storage_path: "fixture-assets/beiping/asset-poster-1.png",
          source_url: "https://mmbiz.qpic.cn/source-poster.png",
          text_content: "Fixture poster",
        },
      ]),
    );

    await store.upsertEventDraft(
      {
        collectorId: "collector-1",
        runId: "run-1",
        observedAt: "2026-06-03T08:00:00.000Z",
        payloadVersion: "2026-05-collector-v1",
        payload: {
          ...eventPipelineV2DraftPayload(),
          registrationQrAssetId: undefined,
          posterImageUrl: undefined,
        },
      },
      { reviewState: "needs_review" },
    );

    expect(upserts.find((entry) => entry.table === "event_drafts")?.payload)
      .toMatchObject({
        poster_image_url: null,
      });
  });

  it("persists excluded articles separately from ordinary drafts", async () => {
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseCollectorIngestStore(
      supabaseClientForEventDraftPublish(upserts),
    );

    await expect(
      store.upsertExcludedArticle!({
        collectorId: "collector-1",
        runId: "run-1",
        observedAt: "2026-06-03T08:00:00.000Z",
        payloadVersion: "2026-05-collector-v1",
        payload: {
          articleUrl: "https://mp.weixin.qq.com/s/official-visit",
          triageAttemptId: "triage-1",
          triageDecision: "official_visit",
          triageAction: "exclude",
          confidence: 0.98,
          publicSignals: [],
          exclusionSignals: ["closed official itinerary"],
          exclusionReason: "Official visit, not a public activity.",
          evidenceAssetIds: ["asset-screenshot-1"],
          promptVersion: "triage-v2",
          schemaVersion: "triage-schema-v2",
          provider: "openai-compatible",
          model: "gpt-5.4-mini",
        },
      }),
    ).resolves.toEqual({ id: "1" });

    expect(upserts.map((entry) => entry.table)).toContain("excluded_articles");
    expect(upserts.map((entry) => entry.table)).not.toContain("event_drafts");
  });

  it("inserts normalized LLM usage ledger rows", async () => {
    const inserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];
    const store = getSupabaseCollectorIngestStore(
      supabaseClientForLlmUsage(inserts),
    );

    await expect(
      store.insertLlmUsage!({
        collectorId: "collector-1",
        runId: "run-usage",
        observedAt: "2026-06-04T08:00:00.000Z",
        payloadVersion: "2026-05-collector-v1",
        payload: {
          usageId: "usage-1",
          recordedAt: "2026-06-04T08:00:01.000Z",
          operation: "event_extraction",
          provider: "dashscope",
          model: "qwen3-vl-plus",
          status: "succeeded",
          inputTokens: 900,
          outputTokens: 250,
          totalTokens: 1150,
          cachedInputTokens: 120,
          reasoningOutputTokens: 0,
          costMicroCny: 2100,
          latencyMs: 1800,
          sourceRunId: "run-usage",
          articleSnapshotId: "snapshot-1",
          metadata: {
            schemaVersion: "event-extraction-schema-v1",
          },
        },
      }),
    ).resolves.toEqual({ id: "usage-1" });

    expect(inserts).toEqual([
      {
        table: "llm_usage_ledger",
        payload: {
          usage_id: "usage-1",
          recorded_at: "2026-06-04T08:00:01.000Z",
          operation: "event_extraction",
          provider: "dashscope",
          model: "qwen3-vl-plus",
          status: "succeeded",
          input_tokens: 900,
          output_tokens: 250,
          total_tokens: 1150,
          cached_input_tokens: 120,
          reasoning_output_tokens: 0,
          cost_micro_cny: 2100,
          latency_ms: 1800,
          source_run_id: "run-usage",
          collector_job_id: null,
          article_snapshot_id: "snapshot-1",
          event_draft_id: null,
          excluded_article_id: null,
          metadata: {
            schemaVersion: "event-extraction-schema-v1",
          },
        },
      },
    ]);
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

function eventPipelineV2DraftPayload(): EventDraftUpload {
  return {
    ...eventDraftPayload(),
    triageDecision: "public_activity",
    triageAction: "extract",
    triageConfidence: 0.97,
    publicSignals: ["public venue", "public schedule"],
    exclusionSignals: [],
    publicEligibility: "public",
    eventKind: "long_running",
    scheduleKind: "long_running",
    scheduleText: "Through 2026-08-30, Tue-Sun 10:00-18:00",
    recurrenceRule: "FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA,SU",
    occurrenceStartsAt: ["2026-06-04T02:00:00.000Z"],
    posterAssetId: "asset-poster-1",
    qrAssetId: "asset-qr-1",
    registrationQrAssetId: "asset-qr-1",
    hardBlockers: [],
    softBlockers: [{ code: "low_confidence", message: "Review confidence" }],
    resolutionDecision: "new_event",
  };
}

function supabaseClientForEventDraftPublish(
  upserts: Array<{ table: string; payload: Record<string, unknown> }>,
  evidenceRows: unknown[] = [],
) {
  return {
    from(table: string) {
      if (table === "evidence_assets") {
        return evidenceAssetQuery(evidenceRows);
      }
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

function evidenceAssetQuery(rows: unknown[]) {
  const query = {
    select() {
      return query;
    },
    in() {
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return query;
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

function supabaseClientForLlmUsage(
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
          return Promise.resolve({
            data: { usage_id: inserts.at(-1)?.payload.usage_id },
            error: null,
          });
        },
      };
      return query;
    },
  } as never;
}
