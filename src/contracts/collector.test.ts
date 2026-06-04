import { describe, expect, it } from "vitest";

import {
  captureModeSchema,
  collectorFailureSchema,
  collectorEnvelopeSchema,
  excludedArticleUploadSchema,
  failureReasonSchema,
  eventDraftUploadSchema,
  llmUsageEventSchema,
  sourceCandidateSchema,
} from "./collector";

describe("collector contracts", () => {
  it("accepts a collector event draft with optional extracted fields", () => {
    const result = collectorEnvelopeSchema(eventDraftUploadSchema).parse({
      collectorId: "home-192-168-0-16",
      runId: "run-2026-05-28-001",
      observedAt: "2026-05-28T07:00:00.000Z",
      payloadVersion: "2026-05-collector-v1",
      payload: {
        articleUrl: "https://mp.weixin.qq.com/s/example",
        extractionAttemptId: "attempt-001",
        captureMode: "image_with_qr_registration",
        timezone: "Asia/Shanghai",
        city: "Beijing",
        reservationStatus: "unknown",
        posterImageUrl: "https://cdn.example.com/posters/event.png",
        posterImageAlt: "Italian Design Weekend poster",
        posterImageSourceUrl: "https://mp.weixin.qq.com/poster.png",
        signals: ["image_dominant", "registration_evidence_required"],
        evidenceAssetIds: ["asset-poster-1", "asset-qr-1"],
        fieldEvidence: {
          title: ["asset-poster-1"],
          registrationUrl: ["asset-qr-1"],
        },
        confidence: 0.62,
      },
    });

    expect(result.payload.title).toBeUndefined();
    expect(result.payload.posterImageUrl).toBe(
      "https://cdn.example.com/posters/event.png",
    );
    expect(result.payload.signals).toContain("registration_evidence_required");
  });

  it("rejects unknown collector payload versions", () => {
    expect(() =>
      collectorEnvelopeSchema(eventDraftUploadSchema).parse({
        collectorId: "home-collector",
        runId: "run-1",
        observedAt: "2026-05-28T07:00:00.000Z",
        payloadVersion: "older-version",
        payload: {
          articleUrl: "https://example.com/a",
          extractionAttemptId: "attempt-001",
          captureMode: "text_complete",
          timezone: "Asia/Shanghai",
          city: "Beijing",
          signals: ["ready_for_review"],
          evidenceAssetIds: [],
          fieldEvidence: {},
          confidence: 0.9,
        },
      }),
    ).toThrow();
  });

  it("does not allow collector uploads to set publication state", () => {
    expect(() =>
      eventDraftUploadSchema.parse({
        articleUrl: "https://example.com/a",
        extractionAttemptId: "attempt-001",
        captureMode: "text_complete",
        timezone: "Asia/Shanghai",
        city: "Beijing",
        signals: ["ready_for_review"],
        evidenceAssetIds: [],
        fieldEvidence: {},
        confidence: 0.9,
        publishState: "published",
      }),
    ).toThrow();
  });

  it("keeps capture modes aligned with documented page modes", () => {
    expect(captureModeSchema.options).toEqual([
      "text_complete",
      "text_with_qr_registration",
      "image_dominant",
      "image_with_qr_registration",
      "not_activity",
      "unsupported",
    ]);
  });

  it("accepts source candidates discovered from a seed article", () => {
    const result = collectorEnvelopeSchema(sourceCandidateSchema).parse({
      collectorId: "sandbox-job-1",
      runId: "run-source-discovery",
      observedAt: "2026-05-28T07:00:00.000Z",
      payloadVersion: "2026-05-collector-v1",
      payload: {
        sourceKey: "wechat:italian-cultural-institute-beijing",
        name: "意大利驻华使馆文化处",
        homepageUrl: "https://mp.weixin.qq.com/s/example-profile",
        seedUrl: "https://mp.weixin.qq.com/s/example",
        platform: "wechat_official_account",
        confidence: 0.82,
        diagnostics: [
          { key: "source_name_evidence", value: "article author name" },
        ],
      },
    });

    expect(result.payload.platform).toBe("wechat_official_account");
    expect(result.payload.sourceKey).toBe(
      "wechat:italian-cultural-institute-beijing",
    );
  });

  it("accepts structured Agent processor failures", () => {
    expect(failureReasonSchema.parse("agent_response_invalid_schema")).toBe(
      "agent_response_invalid_schema",
    );
    expect(
      collectorFailureSchema.parse({
        articleUrl: "https://mp.weixin.qq.com/s/bad-agent",
        stage: "agent_extraction",
        reason: "agent_response_invalid_schema",
        message: "Agent response did not match schema.",
        retryable: true,
      }),
    ).toMatchObject({
      stage: "agent_extraction",
      reason: "agent_response_invalid_schema",
    });
  });

  it("accepts Event Pipeline V2 editorial fields on event drafts", () => {
    const result = eventDraftUploadSchema.parse({
      articleUrl: "https://mp.weixin.qq.com/s/activity",
      extractionAttemptId: "extract-v2-001",
      captureMode: "image_with_qr_registration",
      triageDecision: "public_activity",
      triageAction: "extract",
      triageConfidence: 0.96,
      publicSignals: ["Open RSVP link", "Venue and date are public"],
      exclusionSignals: [],
      publicEligibility: "public",
      eventKind: "recurring",
      scheduleKind: "recurring",
      scheduleText: "Every Saturday 16:00-17:00",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SA",
      occurrenceStartsAt: [
        "2026-06-06T08:00:00.000Z",
        "2026-06-13T08:00:00.000Z",
      ],
      timezone: "Asia/Shanghai",
      city: "Beijing",
      title: "Weekly Library Meetup",
      startsAt: "2026-06-06T08:00:00.000Z",
      venueName: "Goethe-Institut Beijing",
      registrationRequirement: "not_required",
      reservationStatus: "not_required",
      posterAssetId: "asset-poster-1",
      qrAssetId: "asset-qr-1",
      registrationQrAssetId: "asset-qr-1",
      hardBlockers: [],
      softBlockers: [{ code: "missing_end_time", message: "No end time" }],
      signals: ["ready_for_review"],
      evidenceAssetIds: ["asset-poster-1", "asset-qr-1"],
      fieldEvidence: { title: ["asset-poster-1"] },
      confidence: 0.96,
    });

    expect(result.triageDecision).toBe("public_activity");
    expect(result.scheduleKind).toBe("recurring");
    expect(result.softBlockers?.[0]?.code).toBe("missing_end_time");
  });

  it("accepts excluded article uploads separate from event drafts", () => {
    const result = collectorEnvelopeSchema(excludedArticleUploadSchema).parse({
      collectorId: "home-collector",
      runId: "run-triage",
      observedAt: "2026-06-03T08:00:00.000Z",
      payloadVersion: "2026-05-collector-v1",
      payload: {
        articleUrl: "https://mp.weixin.qq.com/s/official-visit",
        triageAttemptId: "triage-001",
        triageDecision: "official_visit",
        triageAction: "exclude",
        confidence: 0.98,
        publicSignals: [],
        exclusionSignals: ["ministerial delegation", "closed itinerary"],
        exclusionReason: "Official visit, not a public activity.",
        evidenceAssetIds: ["asset-screenshot-1"],
        promptVersion: "triage-v2",
        schemaVersion: "triage-schema-v2",
        provider: "openai-compatible",
        model: "gpt-5.4-mini",
      },
    });

    expect(result.payload.triageDecision).toBe("official_visit");
    expect(result.payload.triageAction).toBe("exclude");
  });

  it("accepts normalized LLM usage uploads with missing provider usage fields", () => {
    const result = collectorEnvelopeSchema(llmUsageEventSchema).parse({
      collectorId: "home-collector",
      runId: "run-usage",
      observedAt: "2026-06-04T08:00:00.000Z",
      payloadVersion: "2026-05-collector-v1",
      payload: {
        operation: "event_extraction",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        status: "succeeded",
        latencyMs: 1842,
        metadata: {
          schemaVersion: "event-extraction-schema-v1",
          apiStyle: "chat_completions",
        },
      },
    });

    expect(result.payload.operation).toBe("event_extraction");
    expect(result.payload.inputTokens).toBeUndefined();
    expect(result.payload.metadata?.schemaVersion).toBe(
      "event-extraction-schema-v1",
    );
  });

  it("rejects sensitive LLM usage metadata keys", () => {
    expect(() =>
      llmUsageEventSchema.parse({
        operation: "event_extraction",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        status: "failed",
        metadata: {
          promptText: "do not store this",
        },
      }),
    ).toThrow();
  });
});
