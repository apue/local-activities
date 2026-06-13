import { describe, expect, it, vi } from "vitest";

import { createLiveModelBudgetGuard } from "./model-provider.mjs";
import { createLiveArtifactRecorder } from "./live-artifact-recorder.mjs";
import { createMemoryLlmCallLedger } from "./llm-call-ledger.mjs";
import {
  runLiveEditorPass,
  runLiveFullExtract,
} from "./live-harnesses.mjs";

const fixedNow = "2026-06-10T04:00:00.000Z";

const normalized = Object.freeze({
  title: "文化中心讲座报名",
  sourceName: "Example Cultural Center",
  sourceUrl: "https://mp.weixin.qq.com/s/example",
  publishedAt: "2026-06-09T12:00:00.000Z",
  markdown: "6月20日在北京文化中心举办讲座，需报名。",
});

const packet = Object.freeze({
  version: "v5-candidate-packet.v1",
  packetText: "Title: 文化中心讲座报名\n报名\n北京文化中心",
  estimatedTokens: 20,
});

const triage = Object.freeze({
  decision: "candidate",
  confidence: 0.86,
  reason: "candidate event",
});

describe("V5 live Full Extract and Editor harnesses", () => {
  it("refuses live full extract without an explicit positive budget", async () => {
    const provider = fakeProvider([
      { json: { decision: "event", events: [] }, usage: { costMicroCny: 1 } },
    ]);

    await expect(runLiveFullExtract({
      normalized,
      packet,
      triage,
      provider,
      now: fixedNow,
    })).rejects.toThrow("live_model_budget_required");
    expect(provider.completeJson).not.toHaveBeenCalled();
  });

  it("sends a strict extraction schema prompt that forbids wrapper keys", async () => {
    const provider = fakeProvider([
      {
        json: {
          decision: "event",
          events: [{
            title: "文化中心讲座",
            startsAt: "2026-06-20T10:00:00+08:00",
            city: "Beijing",
            venue: "北京文化中心",
          }],
          publicEligibility: "public",
          publicEligibilityReason: "open signup",
          confidence: 0.9,
          reason: "schema followed",
        },
        usage: { costMicroCny: 1 },
      },
    ]);

    await runLiveFullExtract({
      normalized,
      packet,
      triage,
      provider,
      budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 10 }),
      now: fixedNow,
    });

    const [{ messages, responseFormat }] = provider.completeJson.mock.calls[0];
    expect(responseFormat).toEqual({ type: "json_object" });
    expect(messages[0].content).toContain("\"decision\": \"event\" | \"non_event\" | \"needs_review\" | \"failed\"");
    expect(messages[0].content).toContain("\"events\"");
    expect(messages[0].content).toContain("\"publicEligibility\"");
    expect(messages[0].content).toContain("Do not invent wrapper keys like event/source/metadata");
    expect(messages[0].content).toContain("Ignore evaluator labels such as Expected action, Rationale, or Review/exclusion reasons");
  });

  it("sends eligible image evidence as vision input and preserves registration evidence fields", async () => {
    const provider = fakeProvider([
      {
        json: {
          decision: "event",
          events: [{
            title: "文化中心讲座",
            startsAt: "2026-06-20T10:00:00+08:00",
            city: "Beijing",
            venue: "北京文化中心",
            registrationAction: "qr_code",
            registrationQrUrl: "https://images.example/qr.jpg",
            registrationEvidence: "image-001",
            miniProgramPath: "pages/register",
            miniProgramAppId: "wx123",
            evidence: [{ imageId: "image-001", role: "qr", confidence: 0.91 }],
          }],
          publicEligibility: "public",
          publicEligibilityReason: "open signup",
          confidence: 0.96,
          reason: "vision evidence used",
        },
        usage: { costMicroCny: 1 },
      },
    ]);

    const result = await runLiveFullExtract({
      normalized: {
        ...normalized,
        images: [{
          id: "image-001",
          role: "qr",
          sourceUrl: "https://images.example/qr.jpg",
          alt: "报名二维码",
        }],
      },
      packet,
      triage,
      imageEvidence: [{
        id: "image-001",
        role: "qr",
        sourceUrl: "https://images.example/qr.jpg",
        alt: "报名二维码",
      }],
      provider,
      budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 10 }),
      now: fixedNow,
    });

    const [{ messages }] = provider.completeJson.mock.calls[0];
    expect(messages[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "image_url",
          image_url: { url: "https://images.example/qr.jpg" },
        }),
      ]),
    );
    expect(messages[0].content).toContain("\"registrationQrUrl\": string optional");
    expect(messages[0].content).toContain("\"evidence\": [{ \"imageId\": string");
    expect(result.events[0]).toMatchObject({
      registrationAction: "qr_code",
      registrationQrUrl: "https://images.example/qr.jpg",
      registrationEvidence: "image-001",
      miniProgramPath: "pages/register",
      miniProgramAppId: "wx123",
      evidence: [{ imageId: "image-001", role: "qr", confidence: 0.91 }],
    });
  });

  it("runs bounded repair attempts and records validator issues in attempt traces", async () => {
    const provider = fakeProvider([
      {
        json: {
          decision: "event",
          events: [{ title: "文化中心讲座" }],
          publicEligibility: "public",
          publicEligibilityReason: "open signup",
          confidence: 0.7,
          reason: "first extraction missing venue",
        },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicroCny: 4, latencyMs: 8 },
      },
      {
        json: {
          decision: "event",
          events: [{
            title: "文化中心讲座",
            startsAt: "2026-06-20T10:00:00+08:00",
            venue: "北京文化中心",
            city: "Beijing",
          }],
          publicEligibility: "public",
          publicEligibilityReason: "open signup",
          confidence: 0.84,
          reason: "repaired missing venue",
        },
        usage: { inputTokens: 9, outputTokens: 6, totalTokens: 15, costMicroCny: 5, latencyMs: 7 },
      },
    ]);
    const validator = vi.fn(({ extraction }) => {
      if (!extraction.events[0]?.venue) {
        return {
          status: "needs_info",
          issues: [{
            code: "event_venue_missing",
            severity: "soft",
            repairable: true,
            message: "Venue is missing.",
          }],
        };
      }
      return { status: "valid", issues: [] };
    });

    const result = await runLiveFullExtract({
      normalized,
      packet,
      triage,
      provider,
      validator,
      maxAttempts: 2,
      budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 20 }),
      now: fixedNow,
    });

    expect(provider.completeJson).toHaveBeenCalledTimes(2);
    expect(validator).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      version: "v5-live-full-extract.v1",
      decision: "event",
      publicEligibility: "public",
      provider: "fake-provider",
      model: "fake-model",
      promptVersion: "v5-full-extract.live-prompt.v1",
      schemaVersion: "v5-extraction-result.v1",
      usage: { costMicroCny: 9 },
      errors: [],
    });
    expect(result.events[0]).toMatchObject({
      title: "文化中心讲座",
      venue: "北京文化中心",
    });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({
      attempt: 1,
      reason: "validator_repair_requested",
      validatorIssues: [expect.objectContaining({ code: "event_venue_missing" })],
      usage: { costMicroCny: 4 },
    });
    expect(result.attempts[1]).toMatchObject({
      attempt: 2,
      reason: "validator_passed",
      validatorIssues: [],
      usage: { costMicroCny: 5 },
    });
  });

  it("persists sanitized full-extract request, raw response, normalized response, attempts, issues, and usage artifacts", async () => {
    const writer = memoryArtifactWriter();
    const llmCallLedger = createMemoryLlmCallLedger();
    const artifactRecorder = createLiveArtifactRecorder({
      writer,
      basePath: "runs/live/case-1/full_extract",
      dataClass: "eval",
    });
    const provider = fakeProvider([
      {
        json: {
          decision: "event",
          events: [{
            title: "文化中心讲座",
            startsAt: "2026-06-20T10:00:00+08:00",
            city: "Beijing",
            venue: "北京文化中心",
          }],
          publicEligibility: "public",
          publicEligibilityReason: "open signup",
          confidence: 0.9,
          reason: "schema followed",
        },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicroCny: 4, latencyMs: 8 },
        raw: {
          authorization: "Bearer secret-provider-token",
          headers: {
            cookie: "session=secret-cookie",
            "x-api-key": "secret-key",
          },
          choices: [{ message: { content: "{\"decision\":\"event\"}" } }],
        },
      },
    ]);
    const validator = vi.fn(() => ({
      status: "valid",
      issues: [{ code: "soft_note", severity: "info" }],
    }));

    const result = await runLiveFullExtract({
      normalized,
      packet,
      triage,
      provider,
      validator,
      budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 20 }),
      now: fixedNow,
      artifactRecorder,
      llmCallLedger,
      ledgerContext: {
        dataClass: "eval",
        runId: "pipe-1",
        sourceId: "source-1",
        sourceUrl: "https://mp.weixin.qq.com/s/example",
        articleBundleId: "bundle-1",
      },
    });

    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "full_extract_request" }),
        expect.objectContaining({ kind: "full_extract_raw_response" }),
        expect.objectContaining({ kind: "full_extract_normalized_response" }),
        expect.objectContaining({ kind: "full_extract_validator_issues" }),
        expect.objectContaining({ kind: "full_extract_attempts" }),
        expect.objectContaining({ kind: "full_extract_usage" }),
      ]),
    );
    const requestArtifact = findArtifact(writer, "full_extract_request");
    expect(requestArtifact).toMatchObject({
      dataClass: "eval",
      operation: "full_extract",
      provider: "fake-provider",
      model: "fake-model",
      metadata: {
        promptVersion: "v5-full-extract.live-prompt.v1",
        schemaVersion: "v5-extraction-result.v1",
        attempt: 1,
      },
    });
    const rawArtifact = findArtifact(writer, "full_extract_raw_response");
    expect(JSON.stringify(rawArtifact)).not.toContain("secret-provider-token");
    expect(JSON.stringify(rawArtifact)).not.toContain("secret-cookie");
    expect(JSON.stringify(rawArtifact)).not.toContain("secret-key");
    expect(rawArtifact.raw).toMatchObject({
      authorization: "[REDACTED]",
      headers: {
        cookie: "[REDACTED]",
        "x-api-key": "[REDACTED]",
      },
    });
    expect(findArtifact(writer, "full_extract_normalized_response")).toMatchObject({
      normalizedResponse: expect.objectContaining({
        decision: "event",
        events: [expect.objectContaining({ title: "文化中心讲座" })],
      }),
    });
    expect(findArtifact(writer, "full_extract_validator_issues")).toMatchObject({
      validatorIssues: [expect.objectContaining({ code: "soft_note" })],
    });
    expect(findArtifact(writer, "full_extract_usage")).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicroCny: 4, latencyMs: 8 },
    });
    expect(llmCallLedger.rows).toEqual([
      expect.objectContaining({
        callId: "pipe-1-bundle-1-full_extract-1",
        dataClass: "eval",
        operation: "full_extract",
        provider: "fake-provider",
        model: "fake-model",
        promptVersion: "v5-full-extract.live-prompt.v1",
        schemaVersion: "v5-extraction-result.v1",
        status: "succeeded",
        requestArtifactPath: expect.stringContaining("full_extract_request"),
        responseArtifactPath: expect.stringContaining("full_extract_raw_response"),
        sourceId: "source-1",
        articleBundleId: "bundle-1",
      }),
    ]);
  });

  it("returns deterministic malformed-output result when provider output cannot be parsed", async () => {
    const writer = memoryArtifactWriter();
    const llmCallLedger = createMemoryLlmCallLedger();
    const artifactRecorder = createLiveArtifactRecorder({
      writer,
      basePath: "runs/live/case-1/full_extract_failure",
      dataClass: "eval",
    });
    const provider = {
      provider: "fake-provider",
      model: "fake-model",
      promptVersion: "prompt",
      schemaVersion: "schema",
      completeJson: vi.fn(async () => {
        const error = new Error("bad json");
        error.name = "LiveModelProviderError";
        error.code = "model_provider_malformed_json";
        error.raw = { choices: [{ message: { content: "{bad" } }] };
        throw error;
      }),
    };

    const result = await runLiveFullExtract({
      normalized,
      packet,
      triage,
      provider,
      budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 10 }),
      now: fixedNow,
      artifactRecorder,
      llmCallLedger,
      ledgerContext: { dataClass: "eval", runId: "pipe-1" },
    });

    expect(result).toMatchObject({
      decision: "failed",
      reason: "model_provider_malformed_json",
      errors: [expect.objectContaining({
        code: "model_provider_malformed_json",
        raw: expect.any(Object),
      })],
      attempts: [expect.objectContaining({
        reason: "model_provider_malformed_json",
      })],
    });
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "full_extract_request" }),
        expect.objectContaining({ kind: "full_extract_raw_response" }),
        expect.objectContaining({ kind: "full_extract_normalized_response" }),
        expect.objectContaining({ kind: "full_extract_attempts" }),
        expect.objectContaining({ kind: "full_extract_usage" }),
      ]),
    );
    expect(findArtifact(writer, "full_extract_normalized_response")).toMatchObject({
      error: expect.objectContaining({ code: "model_provider_malformed_json" }),
    });
    expect(llmCallLedger.rows[0]).toMatchObject({
      status: "failed",
      errorCode: "model_provider_malformed_json",
      requestArtifactPath: expect.stringContaining("full_extract_request"),
      responseArtifactPath: expect.stringContaining("full_extract_raw_response"),
    });
  });

  it("records budget and timeout-like live failures in the LLM call ledger", async () => {
    const budgetLedger = createMemoryLlmCallLedger();
    const provider = fakeProvider([
      {
        json: { decision: "event", events: [] },
        usage: { costMicroCny: 1 },
      },
    ]);

    await runLiveFullExtract({
      normalized,
      packet,
      triage,
      provider,
      budgetGuard: {
        assertCanSpend() {
          throw new Error("live_model_budget_exceeded");
        },
        recordUsage() {
          throw new Error("should_not_record_usage");
        },
      },
      now: fixedNow,
      llmCallLedger: budgetLedger,
      ledgerContext: { dataClass: "eval", runId: "pipe-budget" },
    });

    expect(provider.completeJson).not.toHaveBeenCalled();
    expect(budgetLedger.rows[0]).toMatchObject({
      status: "failed",
      errorCode: "live_model_budget_exceeded",
      usage: { totalTokens: 0, costMicroCny: 0 },
    });

    const timeoutLedger = createMemoryLlmCallLedger();
    await runLiveFullExtract({
      normalized,
      packet,
      triage,
      provider: {
        provider: "fake-provider",
        model: "fake-model",
        completeJson: vi.fn(async () => {
          const error = new Error("provider timed out");
          error.code = "model_provider_timeout";
          throw error;
        }),
      },
      budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 10 }),
      now: fixedNow,
      llmCallLedger: timeoutLedger,
      ledgerContext: { dataClass: "eval", runId: "pipe-timeout" },
    });

    expect(timeoutLedger.rows[0]).toMatchObject({
      callId: "pipe-timeout-call-full_extract-1",
      status: "failed",
      errorCode: "model_provider_timeout",
    });
  });

  it("parses editor output, records usage and preserves corrections as traceable changes", async () => {
    const provider = fakeProvider([
      {
        json: {
          displayTitle: "文化中心讲座",
          summary: "6月20日在北京文化中心举办的公开讲座。",
          tags: ["talk", "culture"],
          category: "talk",
          audienceNote: "面向公众，需报名。",
          audience: "general_public",
          corrections: [{
            field: "displayTitle",
            from: "文化中心讲座报名",
            to: "文化中心讲座",
            reason: "remove signup wording",
          }],
          qualityIssues: [],
          editorDecision: "publish",
          reason: "facts are complete",
        },
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20, costMicroCny: 6, latencyMs: 5 },
      },
    ]);

    const result = await runLiveEditorPass({
      normalized,
      extraction: {
        decision: "event",
        events: [{ title: "文化中心讲座报名", startsAt: "2026-06-20T10:00:00+08:00", venue: "北京文化中心" }],
      },
      validation: { status: "valid", issues: [] },
      provider,
      budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 20 }),
      now: fixedNow,
    });

    expect(provider.completeJson).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      version: "v5-live-editor-pass.v1",
      displayTitle: "文化中心讲座",
      summary: "6月20日在北京文化中心举办的公开讲座。",
      tags: ["talk", "culture"],
      category: "talk",
      audienceNote: "面向公众，需报名。",
      audience: "general_public",
      editorDecision: "publish",
      provider: "fake-provider",
      model: "fake-model",
      usage: { costMicroCny: 6 },
      errors: [],
    });
    expect(result.corrections).toEqual([
      expect.objectContaining({
        field: "displayTitle",
        from: "文化中心讲座报名",
        to: "文化中心讲座",
      }),
    ]);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      attempt: 1,
      reason: "editor_pass_completed",
      usage: { costMicroCny: 6 },
      validatorIssues: [],
    });
  });

  it("persists sanitized editor request, raw response, normalized response, quality issues, attempts, and usage artifacts", async () => {
    const writer = memoryArtifactWriter();
    const artifactRecorder = createLiveArtifactRecorder({
      writer,
      basePath: "runs/live/case-1/editor_pass",
      dataClass: "eval",
    });
    const provider = fakeProvider([
      {
        json: {
          displayTitle: "文化中心讲座",
          summary: "6月20日在北京文化中心举办的公开讲座。",
          tags: ["talk", "culture"],
          category: "talk",
          audience: "general_public",
          corrections: [],
          qualityIssues: [{ code: "summary_short", severity: "info" }],
          editorDecision: "publish",
          reason: "facts are complete",
        },
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20, costMicroCny: 6, latencyMs: 5 },
        raw: {
          cookie: "session=secret-cookie",
          choices: [{ message: { content: "{\"editorDecision\":\"publish\"}" } }],
        },
      },
    ]);

    const result = await runLiveEditorPass({
      normalized,
      extraction: {
        decision: "event",
        events: [{ title: "文化中心讲座报名", startsAt: "2026-06-20T10:00:00+08:00", venue: "北京文化中心" }],
      },
      validation: { status: "valid", issues: [] },
      provider,
      budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 20 }),
      now: fixedNow,
      artifactRecorder,
    });

    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "editor_pass_request" }),
        expect.objectContaining({ kind: "editor_pass_raw_response" }),
        expect.objectContaining({ kind: "editor_pass_normalized_response" }),
        expect.objectContaining({ kind: "editor_pass_quality_issues" }),
        expect.objectContaining({ kind: "editor_pass_attempts" }),
        expect.objectContaining({ kind: "editor_pass_usage" }),
      ]),
    );
    expect(JSON.stringify(findArtifact(writer, "editor_pass_raw_response"))).not.toContain("secret-cookie");
    expect(findArtifact(writer, "editor_pass_normalized_response")).toMatchObject({
      normalizedResponse: expect.objectContaining({
        editorDecision: "publish",
        qualityIssues: [expect.objectContaining({ code: "summary_short" })],
      }),
    });
  });

  it("sends a strict editor schema prompt with publish guidance", async () => {
    const provider = fakeProvider([
      {
        json: {
          displayTitle: "文化中心讲座",
          summary: "6月20日在北京文化中心举办的公开讲座。",
          tags: ["talk"],
          category: "talk",
          audience: "general_public",
          corrections: [],
          qualityIssues: [],
          editorDecision: "publish",
          reason: "valid extraction and validation",
        },
        usage: { costMicroCny: 1 },
      },
    ]);

    await runLiveEditorPass({
      normalized,
      extraction: {
        decision: "event",
        events: [{ title: "文化中心讲座", startsAt: "2026-06-20T10:00:00+08:00", venue: "北京文化中心" }],
      },
      validation: { status: "valid", issues: [] },
      provider,
      budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 10 }),
      now: fixedNow,
    });

    const [{ messages, responseFormat }] = provider.completeJson.mock.calls[0];
    expect(responseFormat).toEqual({ type: "json_object" });
    expect(messages[0].content).toContain("\"editorDecision\": \"publish\" | \"exclude\" | \"needs_info\" | \"review\" | \"failed\"");
    expect(messages[0].content).toContain("If extraction is event and validation.status is valid, return editorDecision=\"publish\"");
    expect(messages[0].content).toContain("Do not invent wrapper keys");
  });

  it("default mock-like path can be provided without network-capable global fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("global fetch should not be called");
    });
    try {
      const provider = fakeProvider([
        {
          json: {
            decision: "non_event",
            events: [],
            publicEligibility: "not_public",
            publicEligibilityReason: "not an event",
            confidence: 0.4,
            reason: "not an event",
          },
          usage: { costMicroCny: 0 },
        },
      ]);

      const result = await runLiveFullExtract({
        normalized,
        packet,
        triage,
        provider,
        budgetGuard: createLiveModelBudgetGuard({ maxCostMicroCny: 1 }),
        now: fixedNow,
      });

      expect(result.decision).toBe("non_event");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function fakeProvider(outputs) {
  let index = 0;
  return {
    provider: "fake-provider",
    model: "fake-model",
    promptVersion: "fake-prompt",
    schemaVersion: "fake-schema",
    completeJson: vi.fn(async () => {
      const output = outputs[index];
      index += 1;
      if (!output) throw new Error("unexpected_provider_call");
      return {
        provider: "fake-provider",
        model: "fake-model",
        json: output.json,
        usage: {
          inputTokens: output.usage?.inputTokens ?? 0,
          outputTokens: output.usage?.outputTokens ?? 0,
          totalTokens: output.usage?.totalTokens ?? 0,
          costMicroCny: output.usage?.costMicroCny ?? 0,
          latencyMs: output.usage?.latencyMs ?? 0,
        },
        latencyMs: output.usage?.latencyMs ?? 0,
        raw: output.raw ?? { choices: [{ message: { content: JSON.stringify(output.json) } }] },
      };
    }),
  };
}

function memoryArtifactWriter() {
  const artifacts = new Map();
  return {
    state: { artifacts },
    async writeArtifact(artifactPath, value) {
      artifacts.set(artifactPath, value);
    },
  };
}

function findArtifact(writer, kind) {
  const match = [...writer.state.artifacts.values()].find((artifact) => artifact.kind === kind);
  if (!match) throw new Error(`artifact_missing:${kind}`);
  return match;
}
