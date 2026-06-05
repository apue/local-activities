import { describe, expect, it } from "vitest";

import {
  observePageForBenchmark,
  runCollectorAgent,
} from "./collector-agent-processor.mjs";

describe("collector agent processor", () => {
  it("observes the page, calls OpenAI, and uploads validated normalized payloads", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({
        url,
        headers: init.headers ?? {},
        body: init.body ? JSON.parse(init.body) : {},
      });
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(openaiResponse(agentSuccessResponse()));
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/agent",
      runId: "agent-run",
      vercelJobId: "job-1",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/responses",
      headers: {
        authorization: "Bearer openai-secret",
      },
      body: {
        model: "gpt-5-mini",
        text: {
          format: {
            type: "json_schema",
            name: "collector_agent_response",
          },
        },
      },
    });
    expect(JSON.stringify(calls[0].body)).toContain("Agent Event");
    expect(JSON.stringify(calls[0].body)).toContain("意大利驻华使馆文化处");
    expect(result.uploadedIds).toEqual({
      sourceId: "id-2",
      sourceRunId: "id-3",
      evidenceAssetIds: ["id-4"],
      articleSnapshotId: "id-5",
      eventDraftId: "id-6",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.openai.com/v1/responses",
      "https://local-activities.example/api/collector/source",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/evidence-asset",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-draft",
      "https://local-activities.example/api/collector/jobs/job-1/report",
    ]);
    expect(calls[6].body).toMatchObject({
      collectorId: "home-1",
      localRunId: "agent-run",
      status: "completed",
      sourceRunId: "id-3",
      eventDraftIds: ["id-6"],
      suggestedDisposition: "ready_for_review",
    });
    expect(calls[5].body.payload).toMatchObject({
      scheduleText: "6月6日 14:00-16:00",
    });
    expect(calls[2].body.payload.diagnostics).toEqual(
      expect.arrayContaining([
        { key: "browser_runner", value: "agent_browser" },
        { key: "timing_total_elapsed_ms", value: expect.any(String) },
        { key: "timing_page_observe_elapsed_ms", value: expect.any(String) },
        { key: "timing_agent_request_elapsed_ms", value: expect.any(String) },
      ]),
    );
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain(
      "openai-secret",
    );
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain(
      "collector-secret",
    );
  });

  it("supports OpenAI-compatible chat completions providers", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({
        url,
        headers: init.headers ?? {},
        body: init.body ? JSON.parse(init.body) : {},
      });
      if (url === "https://api.deepseek.example/v1/chat/completions") {
        return jsonResponse(chatCompletionResponse(agentSuccessResponse()));
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: {
        ...agentEnv(),
        OPENAI_BASE_URL: "https://api.deepseek.example/v1",
        OPENAI_MODEL: "deepseek-reasoner",
        AGENT_API_STYLE: "chat_completions",
      },
      seedUrl: "https://mp.weixin.qq.com/s/chat",
      runId: "agent-chat",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls[0]).toMatchObject({
      url: "https://api.deepseek.example/v1/chat/completions",
      headers: {
        authorization: "Bearer openai-secret",
      },
      body: {
        model: "deepseek-reasoner",
        response_format: { type: "json_object" },
      },
    });
    expect(calls[0].body.messages).toHaveLength(2);
    expect(calls[0].body.messages[0].role).toBe("system");
    expect(calls[0].body.messages[1].role).toBe("user");
    expect(result.uploadedIds.eventDraftId).toBe("id-6");
  });

  it("accepts OPENAI_API_STYLE as the documented chat completions alias", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({
        url,
        headers: init.headers ?? {},
        body: init.body ? JSON.parse(init.body) : {},
      });
      if (url === "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions") {
        return jsonResponse(chatCompletionResponse(agentSuccessResponse()));
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: {
        ...agentEnv(),
        OPENAI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        OPENAI_MODEL: "qwen3-vl-plus",
        OPENAI_API_STYLE: "chat_completions",
      },
      seedUrl: "https://mp.weixin.qq.com/s/chat",
      runId: "agent-chat-openai-style",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls[0]).toMatchObject({
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      body: {
        model: "qwen3-vl-plus",
        response_format: { type: "json_object" },
      },
    });
    expect(result.uploadedIds.eventDraftId).toBe("id-6");
  });

  it("does not upload source-site image URLs as public poster URLs", async () => {
    const calls = [];
    const sourcePosterUrl = "https://mmbiz.qpic.cn/source-poster.png";
    const fetchImpl = async (url, init = {}) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body) : {},
      });
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(
          openaiResponse({
            ...agentSuccessResponse(),
            eventDraft: {
              ...agentSuccessResponse().eventDraft,
              posterImageUrl: sourcePosterUrl,
              posterImageAlt: "Agent Event poster",
            },
          }),
        );
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/agent",
      runId: "agent-run",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    const eventDraftUpload = calls.find((call) =>
      call.url.endsWith("/api/collector/event-draft"),
    );
    expect(eventDraftUpload.body.payload.posterImageUrl).toBeUndefined();
    expect(eventDraftUpload.body.payload.posterImageSourceUrl).toBe(
      sourcePosterUrl,
    );
    expect(eventDraftUpload.body.payload.posterImageAlt).toBe(
      "Agent Event poster",
    );
  });

  it("keeps app-owned public asset URLs as poster image URLs", async () => {
    const calls = [];
    const blobPosterUrl =
      "https://local-activities.public.blob.vercel-storage.com/event-posters/agent.png";
    const fetchImpl = async (url, init = {}) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body) : {},
      });
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(
          openaiResponse({
            ...agentSuccessResponse(),
            eventDraft: {
              ...agentSuccessResponse().eventDraft,
              posterImageUrl: blobPosterUrl,
              posterImageAlt: "Agent Event poster",
            },
          }),
        );
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/agent",
      runId: "agent-run",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    const eventDraftUpload = calls.find((call) =>
      call.url.endsWith("/api/collector/event-draft"),
    );
    expect(eventDraftUpload.body.payload.posterImageUrl).toBe(blobPosterUrl);
    expect(eventDraftUpload.body.payload.posterImageSourceUrl).toBeUndefined();
  });

  it("looks up event candidates for editor-agent captures before uploading drafts", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({
        url,
        headers: init.headers ?? {},
        body: init.body ? JSON.parse(init.body) : {},
      });
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(openaiResponse(agentSuccessResponse()));
      }
      if (url === "https://local-activities.example/api/collector/event-candidates") {
        return jsonResponse({
          ok: true,
          candidates: [
            {
              eventId: "event-1",
              title: "Agent Event",
              startsAt: "2026-06-06T06:00:00.000Z",
              timezone: "Asia/Shanghai",
              city: "Beijing",
              sourceUrl: "https://mp.weixin.qq.com/s/previous",
              status: "published",
            },
          ],
        });
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: {
        ...agentEnv(),
        AGENT_EVENT_CANDIDATE_LOOKUP: "true",
      },
      seedUrl: "https://mp.weixin.qq.com/s/agent",
      runId: "agent-run",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.openai.com/v1/responses",
      "https://local-activities.example/api/collector/source",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/evidence-asset",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-candidates",
      "https://local-activities.example/api/collector/event-draft",
    ]);
    expect(calls[5].body).toEqual({
      title: "Agent Event",
      organizer: "Official Cultural Center",
      startsAt: "2026-06-06T06:00:00.000Z",
      sourceUrl: "https://mp.weixin.qq.com/s/agent",
      limit: 10,
    });
    expect(result.eventCandidates).toEqual([
      {
        eventId: "event-1",
        title: "Agent Event",
        startsAt: "2026-06-06T06:00:00.000Z",
        timezone: "Asia/Shanghai",
        city: "Beijing",
        sourceUrl: "https://mp.weixin.qq.com/s/previous",
        status: "published",
      },
    ]);
    expect(result.uploadedIds.eventDraftId).toBe("id-7");
  });

  it("keeps uploading event drafts when candidate lookup fails", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body) : {},
      });
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(openaiResponse(agentSuccessResponse()));
      }
      if (url === "https://local-activities.example/api/collector/event-candidates") {
        return jsonResponse({ ok: false, error: "candidate_lookup_down" }, 503);
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: {
        ...agentEnv(),
        AGENT_EVENT_CANDIDATE_LOOKUP: "true",
      },
      seedUrl: "https://mp.weixin.qq.com/s/agent",
      runId: "agent-candidate-fail",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.map((call) => call.url)).toContain(
      "https://local-activities.example/api/collector/event-draft",
    );
    expect(result.uploadedIds).toMatchObject({
      eventDraftId: "id-7",
      eventCandidateLookupError:
        "upload_failed:/api/collector/event-candidates:503",
    });
  });

  it("submits semantic same-event resolutions without auto-publishing a duplicate draft", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({
        url,
        headers: init.headers ?? {},
        body: init.body ? JSON.parse(init.body) : {},
      });
      if (url === "https://api.openai.com/v1/responses") {
        const modelCallCount = calls.filter((call) =>
          call.url.endsWith("/responses"),
        ).length;
        return jsonResponse(
          openaiResponse(
            modelCallCount === 1
              ? agentSuccessResponse()
              : eventResolutionResponse(),
          ),
        );
      }
      if (url === "https://local-activities.example/api/collector/event-candidates") {
        return jsonResponse({
          ok: true,
          candidates: [
            {
              eventId: "event-existing",
              title: "Agent Event",
              startsAt: "2026-06-06T06:00:00.000Z",
              timezone: "Asia/Shanghai",
              city: "Beijing",
              sourceUrl: "https://mp.weixin.qq.com/s/previous",
              status: "published",
            },
          ],
        });
      }
      if (url === "https://local-activities.example/api/collector/event-resolution") {
        return jsonResponse({
          ok: true,
          resolution: {
            id: "mention-1",
            kind: "mention",
          },
        });
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: {
        ...agentEnv(),
        AGENT_EVENT_CANDIDATE_LOOKUP: "true",
        AGENT_EVENT_RESOLUTION_ENABLED: "true",
      },
      seedUrl: "https://mp.weixin.qq.com/s/agent",
      runId: "agent-resolution",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.openai.com/v1/responses",
      "https://local-activities.example/api/collector/source",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/evidence-asset",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-candidates",
      "https://api.openai.com/v1/responses",
      "https://local-activities.example/api/collector/event-draft",
      "https://local-activities.example/api/collector/event-resolution",
    ]);
    expect(calls[6].body.input[1].content).toContain("event-existing");
    expect(calls[7].body.payload.signals).toContain("possible_duplicate");
    expect(calls[8].body).toMatchObject({
      decision: "same_event",
      eventDraftId: expect.stringMatching(/^draft-[a-f0-9]{24}$/),
      canonicalEventId: "event-existing",
      confidence: 0.91,
      rationale: "Same title and overlapping time.",
    });
    expect(result.uploadedIds).toMatchObject({
      eventDraftId: "id-8",
      eventResolutionId: "mention-1",
      eventResolutionKind: "mention",
    });
    expect(result.eventResolution).toEqual({
      id: "mention-1",
      kind: "mention",
    });
  });

  it("runs a browser-only smoke path without OpenAI credentials", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: {
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "sandbox-job-1",
        COLLECTOR_BROWSER_SMOKE_ONLY: "true",
        COLLECTOR_BROWSER_RUNNER: "agent_browser",
      },
      seedUrl: "https://mp.weixin.qq.com/s/browser-smoke",
      runId: "browser-smoke-run",
      fetchImpl,
      browserObserver: async () =>
        pageObservation({
          finalUrl: "https://mp.weixin.qq.com/s/browser-smoke",
          canonicalUrl: "https://mp.weixin.qq.com/s/browser-smoke",
        }),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://local-activities.example/api/collector/source",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/article-snapshot",
    ]);
    expect(result.uploadedIds).toEqual({
      sourceId: "id-1",
      sourceRunId: "id-2",
      articleSnapshotId: "id-3",
    });
    expect(calls[1].body.payload).toMatchObject({
      status: "partial",
      draftCount: 0,
      failureCount: 0,
    });
    expect(calls[1].body.payload.diagnostics).toEqual(
      expect.arrayContaining([{ key: "browser_runner", value: "agent_browser" }]),
    );
  });

  it("retries invalid OpenAI responses before uploading a valid response", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://api.openai.com/v1/responses" && calls.length === 1) {
        return jsonResponse(openaiResponse({ status: "success" }));
      }
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(openaiResponse(agentSuccessResponse()));
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/retry",
      runId: "agent-retry",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.filter((call) => call.url.endsWith("/responses"))).toHaveLength(2);
    expect(result.uploadedIds.eventDraftId).toBe("id-7");
  });

  it("normalizes complete draft responses that miss top-level status fields", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(
          openaiResponse(withoutTopLevelStatus(agentSuccessResponse())),
        );
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/wrapperless",
      runId: "agent-wrapperless",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.filter((call) => call.url.endsWith("/responses"))).toHaveLength(
      1,
    );
    expect(result.uploadedIds.eventDraftId).toBe("id-6");
    expect(calls[2].body.payload.diagnostics).toEqual(
      expect.arrayContaining([
        { key: "disposition", value: "ready_for_review" },
      ]),
    );
  });

  it("uses the browser observation as article snapshot fallback when the model omits it", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://api.openai.com/v1/responses") {
        const { articleSnapshot: _articleSnapshot, ...response } =
          agentSuccessResponse();
        return jsonResponse(openaiResponse(response));
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const observation = pageObservation({
      finalUrl: "https://mp.weixin.qq.com/s/fallback-snapshot",
      canonicalUrl: "https://mp.weixin.qq.com/s/fallback-snapshot",
      title: "Fallback Snapshot Event",
      visibleText: "Fallback Snapshot Event\n2026-06-06\nCultural Center Hall",
    });

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/fallback-snapshot",
      runId: "agent-fallback-snapshot",
      fetchImpl,
      browserObserver: async () => observation,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    const snapshotUpload = calls.find((call) =>
      call.url.endsWith("/api/collector/article-snapshot"),
    );
    expect(snapshotUpload.body.payload).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/fallback-snapshot",
      finalUrl: "https://mp.weixin.qq.com/s/fallback-snapshot",
      title: "Fallback Snapshot Event",
      captureMode: "text_complete",
    });
    expect(result.uploadedIds).toMatchObject({
      articleSnapshotId: "id-5",
      eventDraftId: "id-6",
    });
  });

  it("defaults collector-owned event draft metadata from deterministic context", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://api.openai.com/v1/responses") {
        const {
          articleUrl: _articleUrl,
          extractionAttemptId: _extractionAttemptId,
          captureMode: _captureMode,
          timezone: _timezone,
          city: _city,
          confidence: _confidence,
          ...contentDraft
        } = agentSuccessResponse().eventDraft;
        const { articleSnapshot: _articleSnapshot, ...response } =
          agentSuccessResponse();
        return jsonResponse(
          openaiResponse({
            ...response,
            eventDraft: contentDraft,
          }),
        );
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const observation = pageObservation({
      finalUrl: "https://mp.weixin.qq.com/s/draft-defaults",
      canonicalUrl: "https://mp.weixin.qq.com/s/draft-defaults",
      title: "Draft Defaults Event",
    });

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/draft-defaults",
      runId: "agent-draft-defaults",
      fetchImpl,
      browserObserver: async () => observation,
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    const draftUpload = calls.find((call) =>
      call.url.endsWith("/api/collector/event-draft"),
    );
    expect(draftUpload.body.payload).toMatchObject({
      articleUrl: "https://mp.weixin.qq.com/s/draft-defaults",
      extractionAttemptId: "agent-draft-defaults-agent",
      captureMode: "text_complete",
      timezone: "Asia/Shanghai",
      city: "Beijing",
      confidence: 0.93,
      title: "Agent Event",
      scheduleText: "6月6日 14:00-16:00",
    });
    expect(result.uploadedIds.eventDraftId).toBe("id-6");
  });

  it("uploads a structured failure after OpenAI schema retry exhaustion", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(openaiResponse({ status: "success" }));
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
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.filter((call) => call.url.endsWith("/responses"))).toHaveLength(2);
    expect(result.uploadedIds).toEqual({
      sourceId: "id-3",
      sourceRunId: "id-4",
      failureId: "id-5",
    });
    expect(calls[4].body.payload).toMatchObject({
      articleUrl: "https://mp.weixin.qq.com/s/bad",
      stage: "agent_extraction",
      reason: "agent_response_invalid_schema",
      retryable: true,
    });
  });

  it("uploads model-reported structured failures without retrying non-retryable responses", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(openaiResponse({
          status: "failure",
          failure: {
            stage: "agent_extraction",
            reason: "captcha_required",
            message: "Captcha required by source page.",
            retryable: false,
          },
        }));
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/captcha",
      runId: "agent-captcha",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.filter((call) => call.url.endsWith("/responses"))).toHaveLength(1);
    expect(result.uploadedIds).toEqual({
      sourceId: "id-2",
      sourceRunId: "id-3",
      failureId: "id-4",
    });
    expect(calls[3].body.payload).toMatchObject({
      reason: "captcha_required",
      retryable: false,
    });
    expect(calls[3].body.payload.diagnostics).toEqual(
      expect.arrayContaining([
        { key: "browser_runner", value: "agent_browser" },
      ]),
    );
  });

  it("blocks WeChat verification pages before model extraction", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      if (url === "https://api.openai.com/v1/responses") {
        throw new Error("model_should_not_be_called");
      }
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/verification-blocked",
      runId: "agent-verification-blocked",
      fetchImpl,
      browserObserver: async () =>
        pageObservation({
          finalUrl:
            "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=redacted&target_url=https%3A%2F%2Fmp.weixin.qq.com%2Fs%2Fverification-blocked",
          canonicalUrl:
            "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=redacted&target_url=https%3A%2F%2Fmp.weixin.qq.com%2Fs%2Fverification-blocked",
          title: "微信公众平台",
          visibleText: "当前环境异常，请完成验证后继续访问",
        }),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://local-activities.example/api/collector/source",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/failure",
    ]);
    expect(result.uploadedIds).toEqual({
      sourceId: "id-1",
      sourceRunId: "id-2",
      failureId: "id-3",
    });
    expect(calls[2].body.payload).toMatchObject({
      articleUrl: "https://mp.weixin.qq.com/s/verification-blocked",
      stage: "page_fetch",
      reason: "captcha_required",
      retryable: true,
    });
    expect(calls[2].body.payload.diagnostics).toEqual(
      expect.arrayContaining([
        { key: "wechat_verification_page", value: "appmsgcaptcha" },
      ]),
    );
  });

  it("normalizes environment verification failures as captcha required", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(openaiResponse({
          status: "failure",
          disposition: "failed",
          failure: {
            stage: "agent_extraction",
            reason: "environment_verification",
            message: "Weixin redirected to an environment verification page.",
            retryable: true,
          },
        }));
      }
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    await runCollectorAgent({
      env: agentEnv(),
      seedUrl: "https://mp.weixin.qq.com/s/wechat-captcha",
      runId: "agent-wechat-captcha",
      fetchImpl,
      browserObserver: async () => pageObservation(),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    const failureCall = calls.find((call) => call.url.endsWith("/failure"));
    expect(failureCall.body.payload).toMatchObject({
      reason: "captcha_required",
      retryable: true,
    });
  });

  it("measures browser observations for benchmark runs without uploading", async () => {
    const result = await observePageForBenchmark({
      seedUrl: "https://mp.weixin.qq.com/s/benchmark",
      runner: "agent_browser",
      browserObserver: async () =>
        pageObservation({
          finalUrl: "https://mp.weixin.qq.com/s/benchmark",
          visibleText: "Benchmark page text",
          imageCandidates: [],
        }),
      now: new Date("2026-05-28T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      runner: "agent_browser",
      ok: true,
      finalUrl: "https://mp.weixin.qq.com/s/benchmark",
      visibleTextLength: "Benchmark page text".length,
      imageCandidateCount: 0,
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        { key: "browser_runner", value: "agent_browser" },
        { key: "benchmark_total_elapsed_ms", value: expect.any(String) },
      ]),
    );
  });
});

function agentEnv() {
  return {
    COLLECTOR_BASE_URL: "https://local-activities.example",
    COLLECTOR_API_KEY: "collector-secret",
    COLLECTOR_ID: "home-1",
    AGENT_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-secret",
    OPENAI_MODEL: "gpt-5-mini",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
  };
}

function pageObservation(overrides = {}) {
  return {
    canonicalUrl: "https://mp.weixin.qq.com/s/agent",
    finalUrl: "https://mp.weixin.qq.com/s/agent",
    title: "Agent Event",
    authorName: "意大利驻华使馆文化处",
    publishedAt: "2026-05-27T08:00:00.000Z",
    capturedAt: "2026-05-28T10:00:00.000Z",
    visibleText: "Agent Event\\n2026-06-06\\nCultural Center Hall",
    languageHints: ["zh-CN"],
    imageCandidates: [
      {
        url: "https://example.org/poster.png",
        width: 800,
        height: 1200,
      },
    ],
    sourceCandidate: {
      sourceKey: "wechat:italian-cultural-institute-beijing",
      name: "意大利驻华使馆文化处",
      seedUrl: "https://mp.weixin.qq.com/s/agent",
      platform: "wechat_official_account",
      confidence: 0.82,
      diagnostics: [
        { key: "source_name_evidence", value: "article author name" },
      ],
    },
    ...overrides,
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
      scheduleText: "6月6日 14:00-16:00",
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

function eventResolutionResponse() {
  return {
    decision: "same_event",
    canonicalEventId: "event-existing",
    confidence: 0.91,
    rationale: "Same title and overlapping time.",
    sourceEvidence: {
      title: ["Agent Event"],
    },
  };
}

function openaiResponse(payload) {
  return {
    output_text: JSON.stringify(payload),
  };
}

function chatCompletionResponse(payload) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(payload),
        },
      },
    ],
  };
}

function withoutTopLevelStatus(payload) {
  const copy = { ...payload };
  delete copy.status;
  delete copy.disposition;
  delete copy.confidence;
  return copy;
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
