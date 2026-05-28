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
  capturePageWithBrowser,
  createVisionImageAnalyzer,
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

  it("captures the four source patterns through a browser-backed adapter", async () => {
    const pages = {
      text: {
        title: "Browser Text Event",
        visibleText: "Browser Text Event at Fixture Hall",
        images: [],
      },
      qr: {
        title: "Browser QR Event",
        visibleText:
          "Browser QR Event register using this QR code. The page includes date, venue, organizer, and public registration instructions in text.",
        images: [
          {
            sourceUrl: "https://example.org/register-qr.png",
            alt: "registration QR",
            width: 240,
            height: 240,
          },
        ],
      },
      image: {
        title: "Browser Poster Event",
        visibleText: "Poster only",
        images: [
          {
            sourceUrl: "https://example.org/event-poster.png",
            alt: "invitation poster",
            width: 900,
            height: 1200,
          },
        ],
      },
      imageQr: {
        title: "Browser Poster QR Event",
        visibleText: "Poster with QR",
        images: [
          {
            sourceUrl: "https://example.org/invitation-poster.png",
            alt: "invitation poster",
            width: 900,
            height: 1200,
          },
          {
            sourceUrl: "https://example.org/register-qr.png",
            alt: "registration QR",
            width: 240,
            height: 240,
          },
        ],
      },
    };
    const browserAdapter = vi.fn(async ({ seedUrl }) => {
      const key = seedUrl.split("/").pop();
      return {
        finalUrl: seedUrl,
        ...pages[key],
      };
    });

    const captures = await Promise.all(
      ["text", "qr", "image", "imageQr"].map((key) =>
        capturePageWithBrowser({
          seedUrl: `https://mp.weixin.qq.com/s/${key}`,
          browserAdapter,
          profileDir: ".collector-profile",
          now: new Date("2026-05-28T10:00:00.000Z"),
        }),
      ),
    );

    expect(captures.map((capture) => capture.captureModeHint)).toEqual([
      "text_complete",
      "text_with_qr_registration",
      "image_dominant",
      "image_with_qr_registration",
    ]);
    expect(browserAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        seedUrl: "https://mp.weixin.qq.com/s/text",
        profileDir: ".collector-profile",
      }),
    );
    expect(captures[3].images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "poster" }),
        expect.objectContaining({ role: "qr" }),
      ]),
    );
  });

  it("maps browser OCR and vision evidence into collector evidence assets", async () => {
    const capture = await capturePageWithBrowser({
      seedUrl: "https://mp.weixin.qq.com/s/image",
      browserAdapter: async () => ({
        finalUrl: "https://mp.weixin.qq.com/s/image",
        title: "Poster Event",
        visibleText: "Poster only",
        images: [
          {
            sourceUrl: "https://example.org/event-poster.png",
            alt: "invitation poster",
            width: 900,
            height: 1200,
          },
        ],
      }),
      imageAnalyzer: async () => ({
        evidenceTexts: [
          {
            role: "ocr_text",
            textContent: "OCR title: Poster Event",
            extractedBy: "ocr",
            confidence: 0.7,
          },
          {
            role: "vision_summary",
            textContent: "Vision summary: poster event in Beijing.",
            extractedBy: "vision",
            confidence: 0.82,
          },
        ],
      }),
      profileDir: ".collector-profile",
      now: new Date("2026-05-28T10:00:00.000Z"),
    });
    const payloads = mapInferenceToCollectorPayloads({
      collectorId: "home-1",
      runId: "browser-evidence",
      now: new Date("2026-05-28T10:00:00.000Z"),
      capture,
      inference: {
        disposition: "needs_review",
        captureMode: "image_dominant",
        title: "Poster Event",
        city: "Beijing",
        timezone: "Asia/Shanghai",
        fieldEvidence: { title: ["ocr_text", "vision_summary"] },
        confidence: 0.72,
      },
    });

    expect(payloads.evidenceAssets.map((asset) => asset.payload.role)).toEqual([
      "poster",
      "ocr_text",
      "vision_summary",
    ]);
    for (const asset of payloads.evidenceAssets) {
      expect(() =>
        collectorEnvelopeSchema(evidenceAssetSchema).parse(asset),
      ).not.toThrow();
    }
    expect(payloads.eventDraft?.payload).toMatchObject({
      signals: ["image_dominant"],
      fieldEvidence: { title: ["ocr_text", "vision_summary"] },
    });
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

  it("maps browser, image download, OCR, and vision failures to structured capture failures", async () => {
    const cases = [
      {
        error: Object.assign(new Error("browser unavailable"), {
          reason: "unsupported",
          stage: "page_fetch",
        }),
        expected: { reason: "unsupported", stage: "page_fetch" },
      },
      {
        error: Object.assign(new Error("image failed"), {
          reason: "image_download_failed",
          stage: "image_capture",
        }),
        expected: { reason: "image_download_failed", stage: "image_capture" },
        fromAnalyzer: true,
      },
      {
        error: Object.assign(new Error("ocr failed"), {
          reason: "ocr_failed",
          stage: "ocr",
        }),
        expected: { reason: "ocr_failed", stage: "ocr" },
        fromAnalyzer: true,
      },
      {
        error: Object.assign(new Error("vision failed"), {
          reason: "vision_failed",
          stage: "vision_extraction",
        }),
        expected: { reason: "vision_failed", stage: "vision_extraction" },
        fromAnalyzer: true,
      },
    ];

    for (const item of cases) {
      const capture = await capturePageWithBrowser({
        seedUrl: "https://mp.weixin.qq.com/s/failure",
        browserAdapter: item.fromAnalyzer
          ? async () => ({
              finalUrl: "https://mp.weixin.qq.com/s/failure",
              title: "Failure",
              visibleText: "Failure",
              images: [
                {
                  sourceUrl: "https://example.org/poster.png",
                  alt: "poster",
                },
              ],
            })
          : async () => {
              throw item.error;
            },
        imageAnalyzer: item.fromAnalyzer
          ? async () => {
              throw item.error;
            }
          : undefined,
        profileDir: ".collector-profile",
        now: new Date("2026-05-28T10:00:00.000Z"),
      });

      expect(capture).toMatchObject({
        kind: "failure",
        ...item.expected,
        retryable: true,
      });
    }
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

  it("runs the browser-backed extract path through upload APIs", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://llm.example/v1/responses") {
        return jsonResponse({
          output_text: JSON.stringify({
            disposition: "needs_review",
            captureMode: "image_with_qr_registration",
            title: "Browser Poster QR Event",
            city: "Beijing",
            timezone: "Asia/Shanghai",
            fieldEvidence: { title: ["vision_summary"] },
            confidence: 0.7,
          }),
        });
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorExtract({
      env: {
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
        COLLECTOR_CAPTURE_ADAPTER: "browser",
        COLLECTOR_BROWSER_PROFILE_DIR: ".collector-profile",
        TEXT_INFERENCE_API_KEY: "llm-secret",
        TEXT_INFERENCE_API_BASE_URL: "https://llm.example/v1",
        TEXT_INFERENCE_MODEL: "fixture-model",
      },
      seedUrl: "https://mp.weixin.qq.com/s/image-qr",
      runId: "browser-run",
      fetchImpl,
      browserAdapter: async () => ({
        finalUrl: "https://mp.weixin.qq.com/s/image-qr",
        title: "Browser Poster QR Event",
        visibleText: "Poster with QR",
        images: [
          {
            sourceUrl: "https://example.org/invitation-poster.png",
            alt: "poster",
            width: 900,
            height: 1200,
          },
          {
            sourceUrl: "https://example.org/register-qr.png",
            alt: "QR",
            width: 240,
            height: 240,
          },
        ],
      }),
      imageAnalyzer: async () => ({
        evidenceTexts: [
          {
            role: "vision_summary",
            textContent: "Poster QR event in Beijing.",
            extractedBy: "vision",
            confidence: 0.8,
          },
        ],
      }),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "uploaded",
      uploadedIds: {
        sourceRunId: "id-2",
        evidenceAssetIds: ["id-3", "id-4", "id-5"],
        articleSnapshotId: "id-6",
        eventDraftId: "id-7",
      },
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://llm.example/v1/responses",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/evidence-asset",
      "https://local-activities.example/api/collector/evidence-asset",
      "https://local-activities.example/api/collector/evidence-asset",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-draft",
    ]);
    expect(calls.map((call) => call.body.payload?.captureMode)).toContain(
      "image_with_qr_registration",
    );
  });

  it("builds OCR and vision evidence with an OpenAI-compatible Responses analyzer", async () => {
    const calls = [];
    const analyzer = createVisionImageAnalyzer({
      env: {
        VISION_INFERENCE_API_BASE_URL: "https://api.openai.com/v1",
        VISION_INFERENCE_API_KEY: "replace-with-vision-inference-api-key",
        VISION_INFERENCE_MODEL: "gpt-4.1-mini",
        TEXT_INFERENCE_API_BASE_URL: "https://llm.example/v1",
        TEXT_INFERENCE_API_KEY: "vision-secret",
        TEXT_INFERENCE_MODEL: "vision-model",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({
          output_text: JSON.stringify({
            ocrText: "OCR title: Browser Poster Event",
            visionSummary: "Vision summary: poster event with QR registration.",
          }),
        });
      },
    });

    const result = await analyzer({
      finalUrl: "https://mp.weixin.qq.com/s/image",
      title: "Browser Poster Event",
      visibleText: "Poster with QR",
      images: [
        {
          sourceUrl: "https://example.org/poster.png",
          role: "poster",
        },
        {
          sourceUrl: "https://example.org/qr.png",
          role: "qr",
        },
      ],
    });

    expect(calls[0]).toMatchObject({
      url: "https://llm.example/v1/responses",
      body: {
        model: "vision-model",
      },
    });
    expect(calls[0].body.input[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "input_image",
          image_url: "https://example.org/poster.png",
        }),
        expect.objectContaining({
          type: "input_image",
          image_url: "https://example.org/qr.png",
        }),
      ]),
    );
    expect(result.evidenceTexts).toEqual([
      expect.objectContaining({ role: "ocr_text", extractedBy: "ocr" }),
      expect.objectContaining({
        role: "vision_summary",
        extractedBy: "vision",
      }),
    ]);
    expect(JSON.stringify(calls[0].body)).not.toContain("vision-secret");
  });

  it("supports chat-completions image analyzer requests", async () => {
    const calls = [];
    const analyzer = createVisionImageAnalyzer({
      env: {
        VISION_INFERENCE_API_BASE_URL: "https://vision.example/v1",
        VISION_INFERENCE_API_KEY: "vision-secret",
        VISION_INFERENCE_MODEL: "vision-model",
        VISION_INFERENCE_ENDPOINT_STYLE: "chat-completions",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  visionSummary: "Vision summary from chat.",
                }),
              },
            },
          ],
        });
      },
    });

    await analyzer({
      finalUrl: "https://mp.weixin.qq.com/s/image",
      images: [
        {
          sourceUrl: "https://example.org/poster.png",
          role: "poster",
        },
      ],
    });

    expect(calls[0]).toMatchObject({
      url: "https://vision.example/v1/chat/completions",
      body: {
        model: "vision-model",
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image_url",
                image_url: { url: "https://example.org/poster.png" },
              }),
            ]),
          }),
        ],
      },
    });
  });

  it("runs browser extract with the default vision analyzer without leaking keys", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://llm.example/v1/responses") {
        const inputText = JSON.stringify(calls.at(-1).body.input);
        if (inputText.includes("Analyze captured event images")) {
          return jsonResponse({
            output_text: JSON.stringify({
              visionSummary: "Vision summary: default analyzer event.",
            }),
          });
        }
        return jsonResponse({
          output_text: JSON.stringify({
            disposition: "needs_review",
            captureMode: "image_dominant",
            title: "Default Analyzer Event",
            city: "Beijing",
            timezone: "Asia/Shanghai",
            fieldEvidence: { title: ["vision_summary"] },
            confidence: 0.76,
          }),
        });
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorExtract({
      env: {
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
        COLLECTOR_CAPTURE_ADAPTER: "browser",
        TEXT_INFERENCE_API_KEY: "llm-secret",
        TEXT_INFERENCE_API_BASE_URL: "https://llm.example/v1",
        TEXT_INFERENCE_MODEL: "vision-model",
      },
      seedUrl: "https://mp.weixin.qq.com/s/image",
      runId: "vision-run",
      fetchImpl,
      browserAdapter: async () => ({
        finalUrl: "https://mp.weixin.qq.com/s/image",
        title: "Default Analyzer Event",
        visibleText: "Poster only",
        images: [
          {
            sourceUrl: "https://example.org/poster.png",
            alt: "poster",
          },
        ],
      }),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(result.uploadedIds).toMatchObject({
      evidenceAssetIds: ["id-4", "id-5"],
      eventDraftId: "id-7",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://llm.example/v1/responses",
      "https://llm.example/v1/responses",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/evidence-asset",
      "https://local-activities.example/api/collector/evidence-asset",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-draft",
    ]);
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain(
      "llm-secret",
    );
  });

  it("uploads a structured vision failure when analyzer output is malformed", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://llm.example/v1/responses") {
        return jsonResponse({ output_text: "not json" });
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorExtract({
      env: {
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
        COLLECTOR_CAPTURE_ADAPTER: "browser",
        TEXT_INFERENCE_API_KEY: "llm-secret",
        TEXT_INFERENCE_API_BASE_URL: "https://llm.example/v1",
        TEXT_INFERENCE_MODEL: "vision-model",
      },
      seedUrl: "https://mp.weixin.qq.com/s/image",
      runId: "vision-failure",
      fetchImpl,
      browserAdapter: async () => ({
        finalUrl: "https://mp.weixin.qq.com/s/image",
        title: "Bad Vision Event",
        visibleText: "Poster only",
        images: [
          {
            sourceUrl: "https://example.org/poster.png",
            alt: "poster",
          },
        ],
      }),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(result.uploadedIds).toMatchObject({
      sourceRunId: "id-2",
      failureId: "id-3",
    });
    expect(calls[2].body.payload).toMatchObject({
      stage: "vision_extraction",
      reason: "vision_failed",
    });
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
