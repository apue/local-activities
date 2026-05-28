import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  articleSnapshotSchema,
  collectorEnvelopeSchema,
  collectorFailureSchema,
  eventDraftUploadSchema,
  evidenceAssetSchema,
  sourceRunReportSchema,
} from "../src/contracts/collector";
import {
  buildExtractionFailure,
  capturePage,
  mapInferenceToCollectorPayloads,
  runCollectorExtract,
} from "./collector-extract-processor.mjs";

describe("collector extract processor", () => {
  it("captures visible text, title, and image evidence metadata from HTML", async () => {
    const html = await fixture("text-event.html");

    const capture = await capturePage({
      seedUrl: "https://mp.weixin.qq.com/s/text",
      fetchImpl: async () => htmlResponse(html),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(capture).toMatchObject({
      kind: "captured",
      seedUrl: "https://mp.weixin.qq.com/s/text",
      finalUrl: "https://mp.weixin.qq.com/s/text",
      title: "Fixture Text Event",
      captureModeHint: "text_complete",
    });
    expect(capture.visibleText).toContain("Fixture Text Event");
    expect(capture.images).toEqual([]);
  });

  it("detects QR and poster image hints during capture", async () => {
    const qr = await capturePage({
      seedUrl: "https://mp.weixin.qq.com/s/qr",
      fetchImpl: async () => htmlResponse(await fixture("qr-event.html")),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const poster = await capturePage({
      seedUrl: "https://mp.weixin.qq.com/s/image",
      fetchImpl: async () => htmlResponse(await fixture("image-event.html")),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(qr.captureModeHint).toBe("text_with_qr_registration");
    expect(qr.images).toContainEqual(
      expect.objectContaining({
        role: "qr",
        sourceUrl: "https://example.org/poster-qr.png",
      }),
    );
    expect(poster.captureModeHint).toBe("image_dominant");
    expect(poster.images).toContainEqual(
      expect.objectContaining({
        role: "poster",
        sourceUrl: "https://example.org/invitation-poster.png",
      }),
    );

    const imageQr = await capturePage({
      seedUrl: "https://mp.weixin.qq.com/s/image-qr",
      fetchImpl: async () => htmlResponse(await fixture("image-qr-event.html")),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    expect(imageQr.captureModeHint).toBe("image_with_qr_registration");
  });

  it("maps blocked, timeout, login, and captcha capture failures", async () => {
    const blocked = await capturePage({
      seedUrl: "https://mp.weixin.qq.com/s/blocked",
      fetchImpl: async () => htmlResponse("blocked", 403),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const timeout = await capturePage({
      seedUrl: "https://mp.weixin.qq.com/s/timeout",
      fetchImpl: async () => htmlResponse("timeout", 408),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const login = await capturePage({
      seedUrl: "https://mp.weixin.qq.com/s/login",
      fetchImpl: async () => htmlResponse("<p>login required</p>"),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const captcha = await capturePage({
      seedUrl: "https://mp.weixin.qq.com/s/captcha",
      fetchImpl: async () => htmlResponse("<p>captcha verification</p>"),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(blocked).toMatchObject({ kind: "failure", reason: "fetch_blocked" });
    expect(timeout).toMatchObject({ kind: "failure", reason: "fetch_timeout" });
    expect(login).toMatchObject({ kind: "failure", reason: "login_required" });
    expect(captcha).toMatchObject({
      kind: "failure",
      reason: "captcha_required",
    });
  });

  it("maps inferred text event drafts into normalized collector payloads", () => {
    const payloads = mapInferenceToCollectorPayloads({
      collectorId: "home-1",
      runId: "run-1",
      now: new Date("2026-05-28T10:00:00.000Z"),
      capture: captured({
        seedUrl: "https://mp.weixin.qq.com/s/text",
        captureModeHint: "text_complete",
        visibleText: "Fixture Text Event at Fixture Hall",
      }),
      inference: {
        disposition: "ready_for_review",
        captureMode: "text_complete",
        title: "Fixture Text Event",
        organizer: "Fixture Cultural Center",
        startsAt: "2026-06-06T06:00:00.000Z",
        endsAt: "2026-06-06T08:00:00.000Z",
        venueName: "Fixture Hall",
        venueAddress: "Beijing",
        reservationStatus: "not_required",
        summary: "A fixture text event.",
        fieldEvidence: {
          title: ["visibleText"],
          startsAt: ["visibleText"],
        },
        confidence: 0.91,
      },
    });

    expect(payloads.sourceRun.payload).toMatchObject({
      status: "success",
      draftCount: 1,
      failureCount: 0,
    });
    expect(payloads.articleSnapshot.payload).toMatchObject({
      captureMode: "text_complete",
      visibleText: "Fixture Text Event at Fixture Hall",
    });
    expect(payloads.eventDraft?.payload).toMatchObject({
      title: "Fixture Text Event",
      captureMode: "text_complete",
      signals: ["ready_for_review"],
      confidence: 0.91,
    });
    expect(payloads.collectorFailure).toBeUndefined();
    expect(() =>
      collectorEnvelopeSchema(sourceRunReportSchema).parse(payloads.sourceRun),
    ).not.toThrow();
    expect(() =>
      collectorEnvelopeSchema(articleSnapshotSchema).parse(
        payloads.articleSnapshot,
      ),
    ).not.toThrow();
    expect(() =>
      collectorEnvelopeSchema(eventDraftUploadSchema).parse(
        payloads.eventDraft,
      ),
    ).not.toThrow();
  });

  it("maps QR, image, image+QR, multi-mention, expired, and not-activity outcomes", () => {
    const cases = [
      {
        disposition: "needs_info",
        captureMode: "text_with_qr_registration",
        expectedSignals: ["qr_registration", "registration_evidence_required"],
      },
      {
        disposition: "needs_review",
        captureMode: "image_dominant",
        expectedSignals: ["image_dominant"],
      },
      {
        disposition: "needs_review",
        captureMode: "image_with_qr_registration",
        expectedSignals: ["image_dominant", "qr_registration"],
      },
      {
        disposition: "needs_review",
        captureMode: "text_complete",
        secondaryMentions: ["Related exhibition"],
        expectedSignals: ["secondary_mention"],
      },
      {
        disposition: "not_activity",
        captureMode: "not_activity",
        expectedFailure: "not_activity",
      },
      {
        disposition: "expired",
        captureMode: "text_complete",
        expectedFailure: "not_activity",
      },
    ];

    for (const item of cases) {
      const payloads = mapInferenceToCollectorPayloads({
        collectorId: "home-1",
        runId: `run-${item.captureMode}-${item.disposition}`,
        now: new Date("2026-05-28T10:00:00.000Z"),
        capture: captured({ captureModeHint: item.captureMode }),
        inference: {
          disposition: item.disposition,
          captureMode: item.captureMode,
          title: "Fixture Event",
          city: "Beijing",
          timezone: "Asia/Shanghai",
          confidence: 0.5,
          fieldEvidence: {},
          secondaryMentions: item.secondaryMentions,
        },
      });

      if (item.expectedFailure) {
        expect(payloads.collectorFailure?.payload.reason).toBe(
          item.expectedFailure,
        );
        expect(() =>
          collectorEnvelopeSchema(collectorFailureSchema).parse(
            payloads.collectorFailure,
          ),
        ).not.toThrow();
        expect(payloads.eventDraft).toBeUndefined();
      } else {
        expect(payloads.eventDraft?.payload.signals).toEqual(
          expect.arrayContaining(item.expectedSignals),
        );
      }
    }
  });

  it("builds structured failures for blocked or missing agent config cases", () => {
    const fetchBlocked = buildExtractionFailure({
      collectorId: "home-1",
      runId: "run-1",
      articleUrl: "https://mp.weixin.qq.com/s/blocked",
      stage: "page_fetch",
      reason: "fetch_blocked",
      message: "HTTP 403",
      retryable: true,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const agentMissing = buildExtractionFailure({
      collectorId: "home-1",
      runId: "run-2",
      articleUrl: "https://mp.weixin.qq.com/s/agent",
      stage: "draft_extraction",
      reason: "parser_mismatch",
      message: "agent_config_missing",
      retryable: false,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(fetchBlocked.payload.reason).toBe("fetch_blocked");
    expect(agentMissing.payload.message).toBe("agent_config_missing");
  });

  it("builds evidence assets accepted by shared contracts", () => {
    const payloads = mapInferenceToCollectorPayloads({
      collectorId: "home-1",
      runId: "run-evidence",
      now: new Date("2026-05-28T10:00:00.000Z"),
      capture: captured({
        captureModeHint: "image_with_qr_registration",
        images: [
          {
            sourceUrl: "https://example.org/poster.png",
            role: "poster",
            width: 900,
            height: 1200,
          },
          {
            sourceUrl: "https://example.org/qr.png",
            role: "qr",
            width: 300,
            height: 300,
          },
        ],
      }),
      inference: {
        disposition: "needs_review",
        captureMode: "image_with_qr_registration",
        title: "Poster QR Event",
        city: "Beijing",
        timezone: "Asia/Shanghai",
        fieldEvidence: { title: ["vision_summary"] },
        confidence: 0.72,
      },
    });

    expect(payloads.evidenceAssets).toHaveLength(2);
    for (const asset of payloads.evidenceAssets) {
      expect(asset).toMatchObject({
        collectorId: "home-1",
        runId: "run-evidence",
      });
      expect(() =>
        collectorEnvelopeSchema(evidenceAssetSchema).parse(asset),
      ).not.toThrow();
    }
  });

  it("runs capture, inference, upload, and reports uploaded ids without leaking provider keys", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      if (url === "https://mp.weixin.qq.com/s/text") {
        return htmlResponse(await fixture("text-event.html"));
      }
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };
    const inference = vi.fn(async () => ({
      disposition: "ready_for_review",
      captureMode: "text_complete",
      title: "Fixture Text Event",
      startsAt: "2026-06-06T06:00:00.000Z",
      timezone: "Asia/Shanghai",
      city: "Beijing",
      signals: ["ready_for_review"],
      fieldEvidence: { title: ["visibleText"] },
      confidence: 0.9,
    }));

    const result = await runCollectorExtract({
      env: {
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
        TEXT_INFERENCE_API_KEY: "llm-secret",
        TEXT_INFERENCE_API_BASE_URL: "https://llm.example/v1",
        TEXT_INFERENCE_MODEL: "fixture-model",
      },
      seedUrl: "https://mp.weixin.qq.com/s/text",
      runId: "run-1",
      fetchImpl,
      inference,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "uploaded",
      runId: "run-1",
      uploadedIds: {
        sourceRunId: "id-1",
        articleSnapshotId: "id-2",
        eventDraftId: "id-3",
      },
    });
    expect(inference).toHaveBeenCalledWith(
      expect.objectContaining({
        capture: expect.objectContaining({ title: "Fixture Text Event" }),
      }),
    );
    expect(calls.map((call) => call.url)).toEqual([
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-draft",
    ]);
    expect(JSON.stringify({ bodies: calls.map((call) => call.body), result }))
      .not.toContain("llm-secret");
    expect(JSON.stringify({ bodies: calls.map((call) => call.body), result }))
      .not.toContain("collector-secret");
  });

  it("returns agent_config_missing when extract processor is missing inference config", async () => {
    await expect(
      runCollectorExtract({
        env: {
          COLLECTOR_BASE_URL: "https://local-activities.example",
          COLLECTOR_API_KEY: "collector-secret",
          COLLECTOR_ID: "home-1",
        },
        seedUrl: "https://mp.weixin.qq.com/s/text",
        runId: "run-1",
        fetchImpl: async () => htmlResponse(await fixture("text-event.html")),
        now: new Date("2026-05-28T10:00:00.000Z"),
      }),
    ).rejects.toThrow("agent_config_missing");
  });

  it("rejects malformed inference provider output as structured local failure", async () => {
    await expect(
      runCollectorExtract({
        env: {
          COLLECTOR_BASE_URL: "https://local-activities.example",
          COLLECTOR_API_KEY: "collector-secret",
          COLLECTOR_ID: "home-1",
          TEXT_INFERENCE_API_KEY: "llm-secret",
          TEXT_INFERENCE_API_BASE_URL: "https://llm.example/v1",
          TEXT_INFERENCE_MODEL: "fixture-model",
        },
        seedUrl: "https://mp.weixin.qq.com/s/text",
        runId: "run-1",
        fetchImpl: async (url) => {
          if (url === "https://mp.weixin.qq.com/s/text") {
            return htmlResponse(await fixture("text-event.html"));
          }
          return jsonResponse({ output_text: "not json" });
        },
        now: new Date("2026-05-28T10:00:00.000Z"),
      }),
    ).rejects.toThrow("agent_response_invalid_json");
  });

  it("accepts chat-completions endpoint style aliases", async () => {
    const calls = [];
    await runCollectorExtract({
      env: {
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
        TEXT_INFERENCE_API_KEY: "llm-secret",
        TEXT_INFERENCE_API_BASE_URL: "https://llm.example/v1",
        TEXT_INFERENCE_MODEL: "fixture-model",
        TEXT_INFERENCE_ENDPOINT_STYLE: "chat-completions",
      },
      seedUrl: "https://mp.weixin.qq.com/s/text",
      runId: "run-1",
      fetchImpl: async (url, init = {}) => {
        if (url === "https://mp.weixin.qq.com/s/text") {
          return htmlResponse(await fixture("text-event.html"));
        }
        calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
        if (url === "https://llm.example/v1/chat/completions") {
          return jsonResponse({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    disposition: "ready_for_review",
                    captureMode: "text_complete",
                    title: "Fixture Text Event",
                    fieldEvidence: {},
                    confidence: 0.8,
                  }),
                },
              },
            ],
          });
        }
        return jsonResponse({ ok: true, id: `id-${calls.length}` });
      },
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls[0]).toMatchObject({
      url: "https://llm.example/v1/chat/completions",
      body: {
        model: "fixture-model",
        messages: expect.any(Array),
      },
    });
  });
});

async function fixture(name) {
  return readFile(
    new URL(`./fixtures/collector-extraction/${name}`, import.meta.url),
    "utf8",
  );
}

function htmlResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://mp.weixin.qq.com/s/text",
    headers: new Map([["content-type", "text/html"]]),
    async text() {
      return body;
    },
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

function captured(overrides = {}) {
  return {
    kind: "captured",
    seedUrl: "https://mp.weixin.qq.com/s/example",
    finalUrl: "https://mp.weixin.qq.com/s/example",
    title: "Fixture Event",
    visibleText: "Fixture Event",
    languageHints: ["en"],
    images: [],
    capturedAt: "2026-05-28T10:00:00.000Z",
    captureModeHint: "text_complete",
    contentHash: "hash-fixture",
    ...overrides,
  };
}
