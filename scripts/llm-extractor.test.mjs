import { describe, expect, it } from "vitest";

import {
  collectorEnvelopeSchema,
  collectorFailureSchema,
  eventDraftUploadSchema,
  evidenceAssetSchema,
} from "../src/contracts/collector";
import {
  buildExtractorPromptInput,
  formatLlmExtractionSummary,
  readLlmExtractorConfig,
  runLlmExtractionOnce,
} from "./llm-extractor.mjs";

describe("lightweight LLM extractor", () => {
  it("reports missing provider configuration without leaking provided secrets", () => {
    expect(readLlmExtractorConfig({ OPENAI_API_KEY: "sk-secret" })).toEqual({
      ok: false,
      missing: ["COLLECTOR_ID", "AGENT_PROVIDER", "OPENAI_MODEL"],
    });
  });

  it("summarizes missing live provider config with the failure reason", async () => {
    const result = await runLlmExtractionOnce({
      env: {},
      articleSnapshot: textArticle(),
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-missing",
    });

    expect(formatLlmExtractionSummary(result)).toContain(
      "failureReasons=agent_config_missing",
    );
  });

  it("builds a prompt input that excludes collector and provider secrets", () => {
    const input = buildExtractorPromptInput({
      articleSnapshot: textArticle(),
      evidenceAssets: [posterEvidence()],
      collectorId: "collector-1",
      runId: "run-1",
      providerSecret: "sk-secret",
    });

    const serialized = JSON.stringify(input);
    expect(serialized).toContain("Weekend concert");
    expect(serialized).toContain("poster-1");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("collector-secret");
    expect(input).toMatchObject({
      promptVersion: "event-extraction-2026-06-02",
      schemaVersion: "event-extraction-schema-v1",
    });
  });

  it("turns a mocked provider activity response into validated draft envelopes", async () => {
    const calls = [];
    const result = await runLlmExtractionOnce({
      env: validEnv(),
      articleSnapshot: textArticle(),
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return jsonResponse(openaiResponse(activityResponse()));
      },
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-run",
    });

    expect(result.kind).toBe("drafts");
    expect(result.eventDrafts).toHaveLength(1);
    expect(result.evidenceAssets).toHaveLength(1);
    expect(result.eventDrafts[0].payload).toMatchObject({
      articleUrl: "https://mp.weixin.qq.com/s/activity",
      extractionAttemptId: "extract-run-activity-1",
      title: "Weekend concert",
      startsAt: "2026-06-06T06:00:00.000Z",
      timezone: "Asia/Shanghai",
      city: "Beijing",
      signals: ["ready_for_review", "possible_duplicate"],
      confidence: 0.91,
    });
    expect(result.eventDrafts[0].payload.fieldEvidence._extraction).toEqual([
      "prompt:event-extraction-2026-06-02",
      "schema:event-extraction-schema-v1",
      "provider:openai",
      "model:gpt-5-mini",
    ]);
    expect(() =>
      collectorEnvelopeSchema(eventDraftUploadSchema).parse(result.eventDrafts[0]),
    ).not.toThrow();
    expect(() =>
      collectorEnvelopeSchema(evidenceAssetSchema).parse(result.evidenceAssets[0]),
    ).not.toThrow();
    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.stringify(calls)).not.toContain("openai-secret");
    expect(formatLlmExtractionSummary(result)).toContain("drafts=1");
    expect(formatLlmExtractionSummary(result)).not.toContain("openai-secret");
  });

  it("supports chat completions providers for activity extraction", async () => {
    const calls = [];
    const result = await runLlmExtractionOnce({
      env: {
        ...validEnv(),
        OPENAI_API_STYLE: "chat_completions",
      },
      articleSnapshot: textArticle(),
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
        return jsonResponse(chatCompletionResponse(activityResponse()));
      },
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-chat",
    });

    expect(result.kind).toBe("drafts");
    expect(result.eventDrafts[0].payload.title).toBe("Weekend concert");
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].body.messages).toHaveLength(1);
    expect(calls[0].body.messages[0].role).toBe("user");
    expect(calls[0].body.messages[0].content).toContain("ARTICLE:");
    expect(calls[0].body.max_tokens).toBe(800);
    expect(calls[0].body.response_format).toBeUndefined();
    expect(calls[0].signal).toBeDefined();
    expect(JSON.stringify(calls)).not.toContain("openai-secret");
  });

  it("normalizes string classifications from loose chat providers", async () => {
    const result = await runLlmExtractionOnce({
      env: {
        ...validEnv(),
        OPENAI_API_STYLE: "chat_completions",
      },
      articleSnapshot: textArticle(),
      fetchImpl: async () =>
        jsonResponse(
          chatCompletionResponse({
            classification: "not_activity",
            events: [],
            signals: ["missing_required_public_field"],
          }),
        ),
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-string-classification",
    });

    expect(result.kind).toBe("no_draft");
    expect(result.failures[0].payload.reason).toBe("not_activity");
  });

  it("runs deterministic fixture extraction without a live provider API key", async () => {
    const result = await runLlmExtractionOnce({
      env: {
        COLLECTOR_ID: "collector-1",
        AGENT_PROVIDER: "fixture",
        OPENAI_MODEL: "fixture-model",
      },
      articleSnapshot: textArticle(),
      providerResponse: activityResponse(),
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-fixture",
    });

    expect(result.kind).toBe("drafts");
    expect(result.eventDrafts[0].payload.fieldEvidence._extraction).toEqual([
      "prompt:event-extraction-2026-06-02",
      "schema:event-extraction-schema-v1",
      "provider:fixture",
      "model:fixture-model",
    ]);
  });

  it("keeps image and QR registration signals from provider output", async () => {
    const result = await runLlmExtractionOnce({
      env: validEnv(),
      articleSnapshot: {
        ...textArticle(),
        captureMode: "image_with_qr_registration",
        visibleText: "See poster for full activity details.",
        evidenceAssetIds: ["poster-1", "qr-1"],
      },
      evidenceAssets: [posterEvidence(), qrEvidence()],
      fetchImpl: async () =>
        jsonResponse(
          openaiResponse({
            ...activityResponse(),
            classification: {
              kind: "activity",
              confidence: 0.84,
              signals: ["image_dominant", "qr_registration"],
              missingFields: [],
            },
            events: [
              {
                ...activityResponse().events[0],
                confidence: 0.84,
                signals: ["image_dominant", "qr_registration"],
                evidenceAssetIds: ["poster-1", "qr-1"],
                fieldEvidence: {
                  title: ["poster-1"],
                  startsAt: ["poster-1"],
                  registrationAction: ["qr-1"],
                },
              },
            ],
          }),
        ),
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-image",
    });

    expect(result.eventDrafts[0].payload.signals).toEqual([
      "image_dominant",
      "qr_registration",
      "possible_duplicate",
    ]);
    expect(result.eventDrafts[0].payload.evidenceAssetIds).toEqual([
      "poster-1",
      "qr-1",
      "extract-image-metadata",
    ]);
  });

  it("creates multiple reviewable drafts for multi-mention activity posts", async () => {
    const result = await runLlmExtractionOnce({
      env: validEnv(),
      articleSnapshot: textArticle(),
      fetchImpl: async () =>
        jsonResponse(
          openaiResponse({
            ...activityResponse(),
            events: [
              activityResponse().events[0],
              {
                ...activityResponse().events[0],
                title: "Gallery talk",
                startsAt: "2026-06-07T07:00:00.000Z",
                confidence: 0.78,
                signals: ["secondary_mention"],
              },
            ],
          }),
        ),
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-multi",
    });

    expect(result.eventDrafts.map((draft) => draft.payload.title)).toEqual([
      "Weekend concert",
      "Gallery talk",
    ]);
    expect(result.eventDrafts[1].payload.extractionAttemptId).toBe(
      "extract-multi-activity-2",
    );
    expect(result.eventDrafts[1].payload.signals).toContain("secondary_mention");
    expect(result.eventDrafts[1].payload.signals).toContain("possible_duplicate");
  });

  it("keeps date-only model output in schedule text instead of invalid datetime fields", async () => {
    const result = await runLlmExtractionOnce({
      env: validEnv(),
      articleSnapshot: textArticle(),
      fetchImpl: async () =>
        jsonResponse(
          openaiResponse({
            ...activityResponse(),
            events: [
              {
                ...activityResponse().events[0],
                startsAt: "2026-05-31",
                endsAt: "2026-06-13",
              },
            ],
          }),
        ),
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-date-only",
    });

    expect(result.eventDrafts[0].payload.startsAt).toBeUndefined();
    expect(result.eventDrafts[0].payload.endsAt).toBeUndefined();
    expect(result.eventDrafts[0].payload.scheduleText).toBe(
      "2026-05-31 - 2026-06-13",
    );
    expect(() =>
      collectorEnvelopeSchema(eventDraftUploadSchema).parse(result.eventDrafts[0]),
    ).not.toThrow();
  });

  it("adds Beijing offset to local datetime model output", async () => {
    const result = await runLlmExtractionOnce({
      env: validEnv(),
      articleSnapshot: textArticle(),
      fetchImpl: async () =>
        jsonResponse(
          openaiResponse({
            ...activityResponse(),
            events: [
              {
                ...activityResponse().events[0],
                startsAt: "2026-06-03T19:00",
                endsAt: "2026-06-03T21:00",
              },
            ],
          }),
        ),
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-local-time",
    });

    expect(result.eventDrafts[0].payload.startsAt).toBe(
      "2026-06-03T19:00:00+08:00",
    );
    expect(result.eventDrafts[0].payload.endsAt).toBe(
      "2026-06-03T21:00:00+08:00",
    );
    expect(() =>
      collectorEnvelopeSchema(eventDraftUploadSchema).parse(result.eventDrafts[0]),
    ).not.toThrow();
  });

  it("classifies non-activity and cancellation posts without creating drafts", async () => {
    for (const [kind, reason] of [
      ["not_activity", "not_activity"],
      ["cancellation", "unsupported"],
    ]) {
      const result = await runLlmExtractionOnce({
        env: validEnv(),
        articleSnapshot: textArticle(),
        fetchImpl: async () =>
          jsonResponse(
            openaiResponse({
              classification: {
                kind,
                confidence: 0.88,
                signals: [],
                missingFields: [],
              },
              events: [],
            }),
          ),
        now: new Date("2026-06-02T08:00:00.000Z"),
        runId: `extract-${kind}`,
      });

      expect(result.kind).toBe("no_draft");
      expect(result.eventDrafts).toEqual([]);
      expect(result.failures[0].payload.reason).toBe(reason);
      expect(() =>
        collectorEnvelopeSchema(collectorFailureSchema).parse(result.failures[0]),
      ).not.toThrow();
    }
  });

  it("surfaces invalid provider schema and provider request failures", async () => {
    const invalid = await runLlmExtractionOnce({
      env: validEnv(),
      articleSnapshot: textArticle(),
      fetchImpl: async () => jsonResponse(openaiResponse({ nope: true })),
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-invalid",
    });

    expect(invalid.kind).toBe("failed");
    expect(invalid.failures[0].payload.reason).toBe(
      "agent_response_invalid_schema",
    );

    const failed = await runLlmExtractionOnce({
      env: validEnv(),
      articleSnapshot: textArticle(),
      fetchImpl: async () => jsonResponse({ error: "rate_limit" }, 429),
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-request-failed",
    });

    expect(failed.kind).toBe("failed");
    expect(failed.failures[0].payload.reason).toBe("agent_request_failed");
  });

  it("retries live provider once after an invalid schema response", async () => {
    let calls = 0;
    const result = await runLlmExtractionOnce({
      env: validEnv(),
      articleSnapshot: textArticle(),
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(
          calls === 1 ? openaiResponse({ nope: true }) : openaiResponse(activityResponse()),
        );
      },
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "extract-retry",
    });

    expect(calls).toBe(2);
    expect(result.kind).toBe("drafts");
  });
});

function validEnv() {
  return {
    COLLECTOR_ID: "collector-1",
    AGENT_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-secret",
    OPENAI_MODEL: "gpt-5-mini",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
  };
}

function textArticle() {
  return {
    canonicalUrl: "https://mp.weixin.qq.com/s/activity",
    finalUrl: "https://mp.weixin.qq.com/s/activity",
    title: "Weekend concert",
    authorName: "Embassy Cultural Office",
    publishedAt: "2026-06-01T04:00:00.000Z",
    capturedAt: "2026-06-02T08:00:00.000Z",
    languageHints: ["en", "zh"],
    captureMode: "text_complete",
    visibleText:
      "Weekend concert, June 6 14:00-16:00, Beijing Culture Center. Registration required.",
    textHash: "text-hash",
    evidenceAssetIds: [],
    contentHash: "article-hash",
  };
}

function posterEvidence() {
  return {
    assetId: "poster-1",
    articleUrl: "https://mp.weixin.qq.com/s/activity",
    role: "poster",
    mediaType: "image",
    sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
    contentHash: "poster-hash",
    extractedBy: "vision",
    confidence: 0.82,
  };
}

function qrEvidence() {
  return {
    assetId: "qr-1",
    articleUrl: "https://mp.weixin.qq.com/s/activity",
    role: "qr",
    mediaType: "image",
    sourceUrl: "https://mmbiz.qpic.cn/qr.jpg",
    contentHash: "qr-hash",
    extractedBy: "vision",
    confidence: 0.8,
  };
}

function activityResponse() {
  return {
    classification: {
      kind: "activity",
      confidence: 0.91,
      signals: [],
      missingFields: [],
    },
    events: [
      {
        title: "Weekend concert",
        originalTitle: "Weekend concert",
        organizer: "Embassy Cultural Office",
        startsAt: "2026-06-06T06:00:00.000Z",
        endsAt: "2026-06-06T08:00:00.000Z",
        venueName: "Beijing Culture Center",
        venueAddress: "Beijing",
        reservationStatus: "required",
        registrationAction: "Register from source article",
        registrationUrl: "https://mp.weixin.qq.com/s/activity",
        summary: "A weekend cultural concert in Beijing.",
        entryNotes: "Bring registration confirmation.",
        signals: ["ready_for_review"],
        evidenceAssetIds: [],
        fieldEvidence: {
          title: ["visibleText"],
          startsAt: ["visibleText"],
          venueName: ["visibleText"],
        },
        confidence: 0.91,
      },
    ],
  };
}

function openaiResponse(data) {
  return {
    output: [
      {
        content: [
          {
            type: "output_text",
            text: JSON.stringify(data),
          },
        ],
      },
    ],
  };
}

function chatCompletionResponse(data) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(data),
        },
      },
    ],
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
