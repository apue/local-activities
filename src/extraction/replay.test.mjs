import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  collectorEnvelopeSchema,
  eventDraftUploadSchema,
} from "../contracts/collector";
import {
  rawModelResponseRecordToProviderResponse,
  recordedExtractionToProviderResponse,
  runRawModelResponseReplay,
  runRecordedExtractionReplay,
} from "./replay.mjs";

describe("recorded extraction replay", () => {
  it("replays QR/poster fixture output through the extractor contract", async () => {
    const result = await runRecordedExtractionReplay({
      env: replayEnv(),
      articleSnapshot: fixtureArticle("qr-registration-poster"),
      evidenceAssets: [
        evidence("asset-qr-registration-poster-poster", "poster"),
        evidence("asset-qr-registration-poster-qr", "qr"),
      ],
      recordedResponse: fixtureJson(
        "qr-registration-poster",
        "extraction-response.json",
      ),
      now: new Date("2026-06-05T08:00:00.000Z"),
      runId: "replay-qr",
    });

    expect(result.kind).toBe("drafts");
    expect(result.eventDrafts).toHaveLength(1);
    expect(result.eventDrafts[0].payload).toMatchObject({
      title: "QR Registration Poster Event",
      publicEligibility: "public",
      eventKind: "single",
      scheduleKind: "single",
      posterAssetId: "asset-qr-registration-poster-poster",
      registrationQrAssetId: "asset-qr-registration-poster-qr",
      registrationRequirement: "required",
      signals: ["qr_registration", "image_dominant"],
    });
    expect(() =>
      collectorEnvelopeSchema(eventDraftUploadSchema).parse(
        result.eventDrafts[0],
      ),
    ).not.toThrow();
    expect(result.uploadedEventDraftIds).toBeUndefined();
  });

  it("replays non-public/news fixtures without creating drafts", async () => {
    const providerResponse = recordedExtractionToProviderResponse(
      fixtureJson("official-visit-news", "extraction-response.json"),
    );

    expect(providerResponse.classification.kind).toBe("not_activity");

    const result = await runRecordedExtractionReplay({
      env: replayEnv(),
      articleSnapshot: fixtureArticle("official-visit-news"),
      recordedResponse: fixtureJson("official-visit-news", "extraction-response.json"),
      now: new Date("2026-06-05T08:00:00.000Z"),
      runId: "replay-negative",
    });

    expect(result.kind).toBe("no_draft");
    expect(result.eventDrafts).toEqual([]);
    expect(result.failures[0].payload.reason).toBe("not_activity");
  });

  it("preserves multi-event, long-running, and recurring schedule fields", async () => {
    const multi = await runRecordedExtractionReplay({
      env: replayEnv(),
      articleSnapshot: fixtureArticle("italian-monthly-roundup"),
      recordedResponse: fixtureJson(
        "italian-monthly-roundup",
        "extraction-response.json",
      ),
      now: new Date("2026-06-05T08:00:00.000Z"),
      runId: "replay-multi",
    });
    const recurring = await runRecordedExtractionReplay({
      env: replayEnv(),
      articleSnapshot: fixtureArticle("goethe-weekly-library"),
      recordedResponse: fixtureJson(
        "goethe-weekly-library",
        "extraction-response.json",
      ),
      now: new Date("2026-06-05T08:00:00.000Z"),
      runId: "replay-recurring",
    });
    const longRunning = await runRecordedExtractionReplay({
      env: replayEnv(),
      articleSnapshot: fixtureArticle("goethe-sonic-exhibition"),
      recordedResponse: fixtureJson(
        "goethe-sonic-exhibition",
        "extraction-response.json",
      ),
      now: new Date("2026-06-05T08:00:00.000Z"),
      runId: "replay-long",
    });

    expect(multi.eventDrafts).toHaveLength(4);
    expect(multi.eventDrafts.map((draft) => draft.payload.title)).toContain(
      "Italian Summer Exhibition",
    );
    expect(recurring.eventDrafts[0].payload).toMatchObject({
      eventKind: "recurring",
      scheduleKind: "recurring",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SA",
      occurrenceStartsAt: [
        "2026-06-06T08:00:00+08:00",
        "2026-06-13T08:00:00+08:00",
      ],
    });
    expect(longRunning.eventDrafts[0].payload).toMatchObject({
      eventKind: "long_running",
      scheduleKind: "long_running",
      recurrenceRule:
        "FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA,SU;UNTIL=20260830T110000Z",
      scheduleText:
        "即日起至2026年8月30日，周二至周日 10:00-18:00，周一闭馆",
    });
  });

  it("replays persisted raw model response records without provider calls", async () => {
    const rawRecord = {
      contractVersion: "llm-raw-model-response-v1",
      provider: "recorded",
      model: "fixture-model",
      promptVersion: "event-extraction-2026-06-02",
      schemaVersion: "event-extraction-schema-v1",
      maxOutputTokens: 900,
      request: {
        captureId: "capture-raw",
        contentHash: "content-raw",
        articleUrl: "https://mp.weixin.qq.com/s/raw",
      },
      rawResponse: {
        output_text: JSON.stringify({
          classification: {
            kind: "activity",
            confidence: 0.86,
            signals: [],
            missingFields: [],
          },
          events: [
            {
              title: "Replay lecture",
              organizer: "Embassy Cultural Office",
              startsAt: "2026-06-08T19:00",
              venueName: "Beijing Culture Center",
              reservationStatus: "not_required",
              summary: "A replayed public lecture.",
              signals: ["ready_for_review"],
              fieldEvidence: {
                title: ["raw-response"],
              },
              confidence: 0.86,
              publicEligibility: "public",
              eventKind: "single",
              scheduleKind: "single",
            },
          ],
        }),
      },
    };

    expect(rawModelResponseRecordToProviderResponse(rawRecord)).toBe(
      rawRecord.rawResponse,
    );

    const result = await runRawModelResponseReplay({
      env: replayEnv(),
      articleSnapshot: {
        ...fixtureArticle("qr-registration-poster"),
        canonicalUrl: "https://mp.weixin.qq.com/s/raw",
        finalUrl: "https://mp.weixin.qq.com/s/raw",
        contentHash: "content-raw",
      },
      rawModelResponseRecord: rawRecord,
      now: new Date("2026-06-08T08:00:00.000Z"),
      runId: "raw-replay",
    });

    expect(result.kind).toBe("drafts");
    expect(result.eventDrafts[0].payload).toMatchObject({
      title: "Replay lecture",
      startsAt: "2026-06-08T19:00:00+08:00",
      publicEligibility: "public",
    });
    expect(result.rawModelResponse).toEqual(rawRecord);
  });
});

function replayEnv() {
  return {
    COLLECTOR_ID: "collector-1",
    AGENT_PROVIDER: "recorded",
    OPENAI_MODEL: "fixture-model",
  };
}

function fixtureArticle(caseId) {
  const input = fixtureJson(caseId, "extraction-input.json");
  return {
    canonicalUrl: input.articleUrl,
    finalUrl: input.articleUrl,
    title: caseId,
    authorName: "fixture",
    publishedAt: "2026-06-01T04:00:00.000Z",
    capturedAt: "2026-06-05T08:00:00.000Z",
    languageHints: ["zh", "en"],
    captureMode: input.evidenceAssetIds?.length
      ? "image_with_qr_registration"
      : "text_complete",
    visibleText: `Fixture article ${caseId}`,
    textHash: `text-${caseId}`,
    evidenceAssetIds: input.evidenceAssetIds ?? [],
    contentHash: `content-${caseId}`,
  };
}

function evidence(assetId, role) {
  return {
    assetId,
    role,
    mediaType: "image",
    sourceUrl: `https://mmbiz.qpic.cn/${assetId}.jpg`,
    contentHash: `hash-${assetId}`,
    extractedBy: "vision",
    confidence: 0.8,
  };
}

function fixtureJson(caseId, fileName) {
  return JSON.parse(
    readFileSync(
      new URL(`../../fixtures/event-pipeline-v2/${caseId}/${fileName}`, import.meta.url),
      "utf8",
    ),
  );
}
