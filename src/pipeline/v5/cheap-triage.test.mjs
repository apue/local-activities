import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildCandidatePacket } from "./candidate-packet.mjs";
import {
  cheapTriageVersion,
  createCheapTriageBudgetGuard,
  createLiveCheapTriageProvider,
  createMockCheapTriageProvider,
  resolveCheapTriageProvider,
  runCheapTriage,
} from "./cheap-triage.mjs";
import { cleanCapturedArticleBundle } from "./content-cleaner.mjs";
import { scoreNormalizedContent } from "./signal-scorer.mjs";

const fixedNow = "2026-06-10T02:30:00.000Z";

describe("V5 cheap triage", () => {
  it("uses the deterministic mock provider by default without calling a live provider", async () => {
    const liveCall = vi.fn(() => {
      throw new Error("live provider should not be called");
    });
    const provider = resolveCheapTriageProvider({ liveCall });

    const result = await runCheapTriage({
      packet: packetFromText("## Signals\nDecision: possible\nPositive: none\nNegative: none"),
      provider,
      context: { dataClass: "test", runId: "cheap-triage-default" },
      now: fixedNow,
    });

    expect(provider.live).toBe(false);
    expect(liveCall).not.toHaveBeenCalled();
    expect(result.provider).toBe("mock");
    expect(result.decision).toBe("uncertain");
  });

  it("routes a public event packet as a candidate", async () => {
    const packet = await packetFromCorpus("beiping-beer-festival-guide");

    const result = await runCheapTriage({
      packet,
      context: { dataClass: "test", runId: "cheap-triage-event" },
      now: fixedNow,
    });

    expect(result.version).toBe(cheapTriageVersion);
    expect(result.decision).toBe("candidate");
    expect(result.needsVision).toBe(false);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.riskFlags).toEqual([]);
  });

  it("routes official meeting news as non_event", async () => {
    const packet = await packetFromCorpus("turkey-president-meeting-news");

    const result = await runCheapTriage({
      packet,
      context: { dataClass: "test", runId: "cheap-triage-news" },
      now: fixedNow,
    });

    expect(result.decision).toBe("non_event");
    expect(result.needsVision).toBe(false);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.riskFlags).toEqual(expect.arrayContaining(["official_news"]));
  });

  it("routes image-heavy QR packets to needs_vision when text evidence is unresolved", async () => {
    const packet = packetFromText([
      "## Metadata",
      "Title: 海报报名活动",
      "## Signals",
      "Decision: possible",
      "Positive: s1:registration:扫码报名 | s2:activity:活动",
      "Negative: none",
      "## Images",
      "1. id=poster role=poster alt=activity poster with QR code sourceUrl=https://cdn.example/poster.jpg",
      "2. id=qr role=qr text=二维码",
      "## Tail",
      "详情见海报二维码，文字暂未提供时间地点。",
    ].join("\n"));

    const result = await runCheapTriage({
      packet,
      context: { dataClass: "test", runId: "cheap-triage-vision" },
      now: fixedNow,
    });

    expect(result.decision).toBe("needs_vision");
    expect(result.needsVision).toBe(true);
    expect(result.riskFlags).toEqual(expect.arrayContaining(["image_heavy", "qr_unresolved"]));
  });

  it("keeps ambiguous packets uncertain instead of excluding them", async () => {
    const packet = packetFromText([
      "## Metadata",
      "Title: Newsletter update",
      "## Signals",
      "Decision: possible",
      "Positive: none",
      "Negative: none",
      "## Tail",
      "本周文化中心动态稍后发布，敬请关注。",
    ].join("\n"));

    const result = await runCheapTriage({
      packet,
      context: { dataClass: "test", runId: "cheap-triage-uncertain" },
      now: fixedNow,
    });

    expect(result.decision).toBe("uncertain");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("requires explicit live opt-in, budget, and call function for live providers", () => {
    expect(() =>
      createLiveCheapTriageProvider({ maxCostMicroCny: 100, call: vi.fn() }),
    ).toThrow("cheap_triage_live_requires_allow_live");
    expect(() =>
      createLiveCheapTriageProvider({ allowLive: true, call: vi.fn() }),
    ).toThrow("cheap_triage_live_budget_required");
    expect(() =>
      createLiveCheapTriageProvider({ allowLive: true, maxCostMicroCny: 0, call: vi.fn() }),
    ).toThrow("cheap_triage_live_budget_required");
    expect(() =>
      createLiveCheapTriageProvider({ allowLive: true, maxCostMicroCny: 100 }),
    ).toThrow("cheap_triage_live_call_required");

    const provider = createLiveCheapTriageProvider({
      allowLive: true,
      maxCostMicroCny: 100,
      providerName: "example-live",
      model: "cheap-model",
      call: vi.fn(),
    });

    expect(provider).toMatchObject({
      live: true,
      provider: "example-live",
      model: "cheap-model",
    });
  });

  it("tracks budget spend and fails closed when the next cost exceeds the cap", () => {
    const guard = createCheapTriageBudgetGuard({ maxCostMicroCny: 10 });

    expect(guard.getSpentCostMicroCny()).toBe(0);
    expect(guard.recordCost(4)).toMatchObject({
      spentCostMicroCny: 4,
      remainingCostMicroCny: 6,
      maxCostMicroCny: 10,
    });
    expect(guard.recordCost({ costMicroCny: 6 })).toMatchObject({
      spentCostMicroCny: 10,
      remainingCostMicroCny: 0,
      maxCostMicroCny: 10,
    });
    expect(() => guard.recordCost(1)).toThrow("cheap_triage_budget_exceeded");
    expect(guard.getSpentCostMicroCny()).toBe(10);
  });

  it("does not call a live provider after its budget is exhausted", async () => {
    const liveCall = vi.fn(async () => ({
      decision: "candidate",
      confidence: 0.7,
      reason: "stubbed",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costMicroCny: 10, latencyMs: 0 },
    }));
    const provider = createLiveCheapTriageProvider({
      allowLive: true,
      maxCostMicroCny: 10,
      providerName: "example-live",
      model: "cheap-model",
      call: liveCall,
    });

    await runCheapTriage({
      packet: packetFromText("报名"),
      provider,
      context: { dataClass: "test", runId: "cheap-triage-budget-preflight" },
      now: fixedNow,
    });

    await expect(runCheapTriage({
      packet: packetFromText("报名"),
      provider,
      context: { dataClass: "test", runId: "cheap-triage-budget-preflight" },
      now: fixedNow,
    })).rejects.toThrow("cheap_triage_budget_exceeded");
    expect(liveCall).toHaveBeenCalledTimes(1);
  });

  it("returns provider, prompt, schema, usage, and attempt metadata", async () => {
    const provider = createMockCheapTriageProvider();

    const result = await runCheapTriage({
      packet: packetFromText("## Signals\nDecision: likely_event\nPositive: date:6月20日 | place:北京文化中心 | registration:报名"),
      provider,
      context: { dataClass: "test", runId: "cheap-triage-metadata" },
      now: fixedNow,
    });

    expect(result).toMatchObject({
      version: cheapTriageVersion,
      decision: "candidate",
      provider: "mock",
      model: "mock-cheap-triage",
      promptVersion: "v5-cheap-triage.mock-prompt.v1",
      schemaVersion: "v5-cheap-triage-result.v1",
      createdAt: fixedNow,
      usage: {
        costMicroCny: 0,
        latencyMs: 0,
      },
    });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBe(result.usage.inputTokens + result.usage.outputTokens);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        attempt: 1,
        provider: "mock",
        model: "mock-cheap-triage",
        promptVersion: "v5-cheap-triage.mock-prompt.v1",
        schemaVersion: "v5-cheap-triage-result.v1",
        usage: result.usage,
        startedAt: fixedNow,
        finishedAt: fixedNow,
        reason: expect.any(String),
        validatorIssues: [],
      }),
    ]);
  });
});

function packetFromText(packetText) {
  return {
    version: "v5-candidate-packet.v1",
    packetText,
    includedSections: ["metadata", "signals", "tail"],
    droppedSections: [],
    sourceSignalIds: [],
    estimatedTokens: Math.max(1, Math.ceil(String(packetText).length / 4)),
  };
}

async function packetFromCorpus(caseId) {
  const normalized = cleanCapturedArticleBundle(await readCorpusBundle(caseId));
  const signalScore = scoreNormalizedContent(normalized);
  return buildCandidatePacket({ normalized, signalScore });
}

async function readCorpusBundle(caseId) {
  const filePath = path.resolve("tests/regression-corpus", caseId, "captured-bundle.json");
  return JSON.parse(await readFile(filePath, "utf8"));
}
