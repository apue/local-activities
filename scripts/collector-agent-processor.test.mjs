import { describe, expect, it } from "vitest";

import { runCollectorAgent } from "./collector-agent-processor.mjs";

describe("collector agent processor", () => {
  it("calls the Agent API and uploads validated normalized payloads", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://agent.example/v1/extract") {
        return jsonResponse(agentSuccessResponse());
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/agent",
      runId: "agent-run",
      vercelJobId: "job-1",
      fetchImpl,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls[0]).toMatchObject({
      url: "https://agent.example/v1/extract",
      body: {
        seedUrl: "https://mp.weixin.qq.com/s/agent",
        runId: "agent-run",
        collectorId: "home-1",
        vercelJobId: "job-1",
        model: "agent-model",
      },
    });
    expect(result.uploadedIds).toEqual({
      sourceRunId: "id-2",
      evidenceAssetIds: ["id-3"],
      articleSnapshotId: "id-4",
      eventDraftId: "id-5",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://agent.example/v1/extract",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/evidence-asset",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-draft",
    ]);
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain(
      "agent-secret",
    );
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain(
      "collector-secret",
    );
  });

  it("retries invalid Agent responses before uploading a valid response", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://agent.example/v1/extract" && calls.length === 1) {
        return jsonResponse({ status: "success" });
      }
      if (url === "https://agent.example/v1/extract") {
        return jsonResponse(agentSuccessResponse());
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/retry",
      runId: "agent-retry",
      fetchImpl,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.filter((call) => call.url.endsWith("/extract"))).toHaveLength(2);
    expect(result.uploadedIds.eventDraftId).toBe("id-6");
  });

  it("uploads a structured failure after Agent schema retry exhaustion", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://agent.example/v1/extract") {
        return jsonResponse({ status: "success" });
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: {
        ...agentEnv(),
        AGENT_MAX_ATTEMPTS: "2",
      },
      seedUrl: "https://mp.weixin.qq.com/s/bad",
      runId: "agent-bad",
      fetchImpl,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.filter((call) => call.url.endsWith("/extract"))).toHaveLength(2);
    expect(result.uploadedIds).toEqual({
      sourceRunId: "id-3",
      failureId: "id-4",
    });
    expect(calls[3].body.payload).toMatchObject({
      articleUrl: "https://mp.weixin.qq.com/s/bad",
      stage: "agent_extraction",
      reason: "agent_response_invalid_schema",
      retryable: true,
    });
  });

  it("uploads Agent-reported structured failures without retrying non-retryable responses", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://agent.example/v1/extract") {
        return jsonResponse({
          status: "failure",
          failure: {
            stage: "agent_extraction",
            reason: "captcha_required",
            message: "Captcha required by source page.",
            retryable: false,
          },
        });
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/captcha",
      runId: "agent-captcha",
      fetchImpl,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.filter((call) => call.url.endsWith("/extract"))).toHaveLength(1);
    expect(result.uploadedIds).toEqual({
      sourceRunId: "id-2",
      failureId: "id-3",
    });
    expect(calls[2].body.payload).toMatchObject({
      reason: "captcha_required",
      retryable: false,
    });
  });
});

function agentEnv() {
  return {
    COLLECTOR_BASE_URL: "https://local-activities.example",
    COLLECTOR_API_KEY: "collector-secret",
    COLLECTOR_ID: "home-1",
    AGENT_API_BASE_URL: "https://agent.example/v1",
    AGENT_API_KEY: "agent-secret",
    AGENT_MODEL: "agent-model",
  };
}

function agentSuccessResponse() {
  return {
    status: "success",
    disposition: "ready_for_review",
    confidence: 0.93,
    missingFields: ["venueAddress"],
    articleSnapshot: {
      canonicalUrl: "https://mp.weixin.qq.com/s/agent",
      finalUrl: "https://mp.weixin.qq.com/s/agent",
      title: "Agent Event",
      capturedAt: "2026-05-28T10:00:00.000Z",
      languageHints: ["zh-CN"],
      captureMode: "image_with_qr_registration",
      evidenceAssetIds: ["asset-poster"],
      contentHash: "hash-article",
    },
    evidenceAssets: [
      {
        assetId: "asset-poster",
        articleUrl: "https://mp.weixin.qq.com/s/agent",
        role: "poster",
        mediaType: "image",
        sourceUrl: "https://example.org/poster.png",
        contentHash: "hash-poster",
      },
    ],
    eventDraft: {
      articleUrl: "https://mp.weixin.qq.com/s/agent",
      extractionAttemptId: "agent-run-agent",
      captureMode: "image_with_qr_registration",
      title: "Agent Event",
      organizer: "Official Cultural Center",
      startsAt: "2026-06-06T06:00:00.000Z",
      timezone: "Asia/Shanghai",
      city: "Beijing",
      reservationStatus: "required",
      registrationUrl: "https://example.org/register",
      summary: "Agent extracted event.",
      signals: ["qr_registration"],
      evidenceAssetIds: ["asset-poster"],
      fieldEvidence: {
        title: ["asset-poster"],
      },
      confidence: 0.93,
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
