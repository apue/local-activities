import { describe, expect, it } from "vitest";

import {
  buildEditorCaptureEnv,
  extractCaptureInputUrl,
  extractCaptureInputUrls,
  formatEditorCaptureSummary,
  parseArgs,
  runEditorCaptureBatch,
  runEditorCapture,
} from "./editor-agent-capture.mjs";

describe("editor agent capture", () => {
  it("extracts the first URL from pasted shared text", () => {
    expect(
      extractCaptureInputUrl(
        "复制这段内容后打开小红书 https://example.com/post/1 ，查看更多",
      ),
    ).toBe("https://example.com/post/1");
  });

  it("extracts all URLs from pasted shared text in order", () => {
    expect(
      extractCaptureInputUrls(
        [
          "第一个 https://example.com/post/1 ，查看更多",
          "第二个 https://mp.weixin.qq.com/s/abc。",
          "重复的 https://example.com/post/1 不需要再次处理",
        ].join("\n"),
      ),
    ).toEqual([
      "https://example.com/post/1",
      "https://mp.weixin.qq.com/s/abc",
    ]);
  });

  it("maps editor provider aliases onto the collector agent env", () => {
    expect(
      buildEditorCaptureEnv({
        NEXT_PUBLIC_APP_URL: "https://local-activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        EDITOR_AGENT_API_BASE_URL: "https://api.deepseek.example/v1",
        EDITOR_AGENT_API_KEY: "provider-secret",
        EDITOR_AGENT_MODEL: "deepseek-reasoner",
        EDITOR_AGENT_API_STYLE: "chat_completions",
      }),
    ).toMatchObject({
      COLLECTOR_BASE_URL: "https://local-activities.example",
      COLLECTOR_ID: "local-editor",
      COLLECTOR_API_KEY: "collector-secret",
      AGENT_PROVIDER: "openai",
      OPENAI_BASE_URL: "https://api.deepseek.example/v1",
      OPENAI_API_KEY: "provider-secret",
      OPENAI_MODEL: "deepseek-reasoner",
      AGENT_API_STYLE: "chat_completions",
      COLLECTOR_BROWSER_RUNNER: "agent_browser",
    });
  });

  it("runs one local capture without reporting a Vercel job", async () => {
    const calls = [];

    const result = await runEditorCapture({
      input: "https://mp.weixin.qq.com/s/local",
      env: {
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_ID: "home-1",
        COLLECTOR_API_KEY: "collector-secret",
        AGENT_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-secret",
        OPENAI_MODEL: "gpt-5-mini",
      },
      now: new Date("2026-05-29T09:00:00.000Z"),
      runCollectorAgentImpl: async (input) => {
        calls.push(input);
        return {
          kind: "uploaded",
          runId: input.runId,
          uploadedIds: {
            sourceRunId: "101",
            articleSnapshotId: "201",
            eventDraftId: "301",
          },
        };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      seedUrl: "https://mp.weixin.qq.com/s/local",
      runId: "editor-20260529T090000000Z-1100e993",
      reportVercelJob: false,
    });
    expect(calls[0].env).toMatchObject({
      COLLECTOR_BROWSER_RUNNER: "agent_browser",
      AGENT_EVENT_CANDIDATE_LOOKUP: "true",
      AGENT_EVENT_RESOLUTION_ENABLED: "true",
    });
    expect(result).toMatchObject({
      outcome: "event_submitted",
      seedUrl: "https://mp.weixin.qq.com/s/local",
      runId: "editor-20260529T090000000Z-1100e993",
      uploadedIds: {
        eventDraftId: "301",
      },
    });
  });

  it("includes event candidates returned by the processor", async () => {
    await expect(
      runEditorCapture({
        input: "https://mp.weixin.qq.com/s/local",
        env: {
          COLLECTOR_BASE_URL: "https://local-activities.example",
          COLLECTOR_ID: "home-1",
          COLLECTOR_API_KEY: "collector-secret",
          AGENT_PROVIDER: "openai",
          OPENAI_API_KEY: "openai-secret",
          OPENAI_MODEL: "gpt-5-mini",
        },
        runCollectorAgentImpl: async () => ({
          kind: "uploaded",
          uploadedIds: {
            eventDraftId: "draft-1",
            eventCandidateCount: 1,
          },
          eventCandidates: [
            {
              eventId: "event-1",
              title: "Existing event",
            },
          ],
        }),
      }),
    ).resolves.toMatchObject({
      outcome: "event_submitted",
      uploadedIds: {
        eventCandidateCount: 1,
      },
      eventCandidates: [
        {
          eventId: "event-1",
          title: "Existing event",
        },
      ],
    });
  });

  it("includes event resolution returned by the processor", async () => {
    await expect(
      runEditorCapture({
        input: "https://mp.weixin.qq.com/s/local",
        env: {
          COLLECTOR_BASE_URL: "https://local-activities.example",
          COLLECTOR_ID: "home-1",
          COLLECTOR_API_KEY: "collector-secret",
          AGENT_PROVIDER: "openai",
          OPENAI_API_KEY: "openai-secret",
          OPENAI_MODEL: "gpt-5-mini",
        },
        runCollectorAgentImpl: async () => ({
          kind: "uploaded",
          uploadedIds: {
            eventDraftId: "draft-1",
            eventResolutionId: "mention-1",
            eventResolutionKind: "mention",
          },
          eventResolution: {
            id: "mention-1",
            kind: "mention",
          },
        }),
      }),
    ).resolves.toMatchObject({
      uploadedIds: {
        eventResolutionId: "mention-1",
      },
      eventResolution: {
        id: "mention-1",
        kind: "mention",
      },
    });
  });

  it("runs a batch sequentially and preserves per-item failures", async () => {
    const calls = [];

    const result = await runEditorCaptureBatch({
      input: [
        "https://mp.weixin.qq.com/s/first",
        "https://mp.weixin.qq.com/s/second",
      ].join("\n"),
      env: {
        COLLECTOR_BASE_URL: "https://local-activities.example",
        COLLECTOR_ID: "home-1",
        COLLECTOR_API_KEY: "collector-secret",
        AGENT_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-secret",
        OPENAI_MODEL: "gpt-5-mini",
      },
      now: new Date("2026-05-29T09:00:00.000Z"),
      runCollectorAgentImpl: async (input) => {
        calls.push(input.seedUrl);
        if (input.seedUrl.endsWith("/first")) {
          return {
            kind: "uploaded",
            runId: input.runId,
            uploadedIds: {
              eventDraftId: "draft-1",
            },
          };
        }
        throw new Error("network_error");
      },
    });

    expect(calls).toEqual([
      "https://mp.weixin.qq.com/s/first",
      "https://mp.weixin.qq.com/s/second",
    ]);
    expect(result).toMatchObject({
      kind: "batch",
      totalCount: 2,
      succeededCount: 1,
      failedCount: 1,
      results: [
        {
          ok: true,
          outcome: "event_submitted",
          seedUrl: "https://mp.weixin.qq.com/s/first",
        },
        {
          ok: false,
          seedUrl: "https://mp.weixin.qq.com/s/second",
          error: "network_error",
        },
      ],
    });
  });

  it("reports missing local provider config before invoking the processor", async () => {
    await expect(
      runEditorCapture({
        input: "https://mp.weixin.qq.com/s/missing",
        env: {
          COLLECTOR_BASE_URL: "https://local-activities.example",
          COLLECTOR_ID: "home-1",
          COLLECTOR_API_KEY: "collector-secret",
        },
        runCollectorAgentImpl: async () => {
          throw new Error("should_not_run");
        },
      }),
    ).rejects.toThrow(
      "missing_editor_agent_config:EDITOR_AGENT_API_KEY|OPENAI_API_KEY,EDITOR_AGENT_MODEL|OPENAI_MODEL",
    );
  });

  it("summarizes structured failures for operator use", () => {
    expect(
      formatEditorCaptureSummary({
        outcome: "structured_failure",
        seedUrl: "https://mp.weixin.qq.com/s/captcha",
        runId: "editor-run",
        uploadedIds: {
          sourceRunId: "101",
          failureId: "401",
        },
      }),
    ).toContain(
      "Editor capture finished outcome=structured_failure seedUrl=https://mp.weixin.qq.com/s/captcha runId=editor-run sourceRunId=101 failureId=401",
    );
  });

  it("summarizes batch results for operator use", () => {
    expect(
      formatEditorCaptureSummary({
        kind: "batch",
        totalCount: 2,
        succeededCount: 1,
        failedCount: 1,
        results: [
          {
            ok: true,
            outcome: "event_submitted",
            seedUrl: "https://example.com/one",
            runId: "run-1",
            uploadedIds: {
              eventDraftId: "draft-1",
            },
          },
          {
            ok: false,
            seedUrl: "https://example.com/two",
            error: "network_error",
          },
        ],
      }),
    ).toBe(
      [
        "Editor capture batch finished total=2 succeeded=1 failed=1",
        "[1] ok outcome=event_submitted seedUrl=https://example.com/one runId=run-1 eventDraftId=draft-1",
        "[2] failed seedUrl=https://example.com/two error=network_error",
      ].join("\n"),
    );
  });

  it("parses the documented pnpm argument separator before options", () => {
    expect(
      parseArgs([
        "--",
        "--env-file",
        ".env.local",
        "--json",
        "https://example.com/event",
      ]),
    ).toMatchObject({
      envFile: ".env.local",
      json: true,
      input: "https://example.com/event",
    });
  });
});
