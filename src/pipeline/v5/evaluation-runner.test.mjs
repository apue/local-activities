import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createMemoryV5EvaluationWriter,
  parseV5EvaluationArgs,
  runV5Evaluation,
} from "./evaluation-runner.mjs";

describe("V5 evaluation runner", () => {
  it("parses CLI args with deterministic default variants and live guards", () => {
    expect(parseV5EvaluationArgs([
      "--corpus-dir",
      "tests/regression-corpus",
      "--all",
      "--store",
      "memory",
    ])).toMatchObject({
      corpusDir: path.resolve("tests/regression-corpus"),
      all: true,
      store: "memory",
      variants: ["mock-expected-v1"],
    });

    expect(parseV5EvaluationArgs([
      "--corpus-dir",
      "tests/regression-corpus",
      "--case",
      "beiping-beer-festival-guide",
      "--store",
      "local",
      "--artifact-dir",
      "tmp/eval",
      "--variant",
      "mock-expected-v1",
      "--variant",
      "mock-underfilter-v1",
    ])).toMatchObject({
      corpusDir: path.resolve("tests/regression-corpus"),
      caseIds: ["beiping-beer-festival-guide"],
      store: "local",
      artifactDir: path.resolve("tmp/eval"),
      variants: ["mock-expected-v1", "mock-underfilter-v1"],
    });

    expect(() => parseV5EvaluationArgs(["--target", "production"])).toThrow(
      "v5_evaluation_refuses_production_target",
    );
    expect(() => parseV5EvaluationArgs([
      "--corpus-dir",
      "tests/regression-corpus",
      "--all",
      "--allow-live",
    ])).toThrow("v5_evaluation_live_requires_positive_max_cost_cny");
    expect(parseV5EvaluationArgs([
      "--corpus-dir",
      "tests/regression-corpus",
      "--all",
      "--allow-live",
      "--max-cost-cny",
      "1",
      "--env-file",
      ".env.local",
    ])).toMatchObject({
      allowLive: true,
      maxCostCny: 1,
      envFiles: [path.resolve(".env.local")],
    });
    expect(() => parseV5EvaluationArgs([
      "--corpus-dir",
      "tests/regression-corpus",
      "--all",
      "--variant",
      "live-configured",
    ])).toThrow("v5_evaluation_live_requires_allow_live");
    expect(() => parseV5EvaluationArgs([
      "--corpus-dir",
      "tests/regression-corpus",
      "--all",
      "--variant",
      "live-configured",
      "--allow-live",
    ])).toThrow("v5_evaluation_live_requires_positive_max_cost_cny");
  });

  it("runs the default deterministic baseline over fixture corpus with memory artifacts", async () => {
    const writer = createMemoryV5EvaluationWriter();

    const result = await runV5Evaluation({
      corpusDir: "tests/regression-corpus",
      all: true,
      writer,
      now: new Date("2026-06-10T05:00:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      store: "memory",
      runId: "v5-eval-20260610050000",
      corpusVersion: "event-pipeline-regression-corpus-v1",
      caseCount: 17,
      runCount: 17,
      passCount: 17,
      failCount: 0,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      totalUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costMicroCny: 0,
        latencyMs: 0,
      },
    });
    expect(result.summaryPath).toBe("runs/v5-eval-20260610050000/summary.json");
    expect(result.artifactPaths).toEqual(
      expect.arrayContaining([
        result.summaryPath,
        "runs/v5-eval-20260610050000/variants/mock-expected-v1/cases/beiping-beer-festival-guide.json",
      ]),
    );
    expect(result.variantSummaries).toHaveLength(1);
    expect(result.variantSummaries.find((item) => item.variant === "mock-expected-v1")).toMatchObject({
      passCount: 17,
      failCount: 0,
      actionAccuracy: 1,
      finalStateAccuracy: 1,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
    });
    expect(writer.state.artifacts.get(result.summaryPath)).toEqual(result);
  });

  it("scores overfilter and underfilter variants with false-negative and false-positive metrics", async () => {
    const result = await runV5Evaluation({
      corpusDir: "tests/regression-corpus",
      all: true,
      store: "memory",
      variants: ["mock-overfilter-v1", "mock-underfilter-v1"],
      now: new Date("2026-06-10T05:00:00.000Z"),
    });

    expect(result.variantSummaries.find((item) => item.variant === "mock-overfilter-v1")).toMatchObject({
      caseCount: 17,
      passCount: 7,
      failCount: 10,
      falsePositiveCount: 0,
      falseNegativeCount: 10,
      actionAccuracy: 7 / 17,
      finalStateAccuracy: 7 / 17,
    });
    expect(result.variantSummaries.find((item) => item.variant === "mock-underfilter-v1")).toMatchObject({
      caseCount: 17,
      passCount: 9,
      failCount: 8,
      falsePositiveCount: 8,
      falseNegativeCount: 0,
      actionAccuracy: 9 / 17,
      finalStateAccuracy: 9 / 17,
    });
  });

  it("writes local evaluation summary artifacts", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "v5-eval-"));
    try {
      const result = await runV5Evaluation({
        corpusDir: "tests/regression-corpus",
        caseIds: ["beiping-beer-festival-guide"],
        variants: ["mock-expected-v1"],
        store: "local",
        artifactDir,
        now: new Date("2026-06-10T05:00:00.000Z"),
      });

      expect(result).toMatchObject({
        ok: true,
        store: "local",
        artifactDir,
        caseCount: 1,
        runCount: 1,
        passCount: 1,
      });
      const summary = JSON.parse(await readFile(path.join(artifactDir, result.summaryPath), "utf8"));
      expect(summary).toMatchObject({
        ok: true,
        runId: result.runId,
        variantSummaries: [
          expect.objectContaining({
            variant: "mock-expected-v1",
            actionAccuracy: 1,
          }),
        ],
      });
      const caseArtifactPath = result.cases[0].artifactPath;
      expect(caseArtifactPath).toBe(
        "runs/v5-eval-20260610050000/variants/mock-expected-v1/cases/beiping-beer-festival-guide.json",
      );
      const caseArtifact = JSON.parse(await readFile(path.join(artifactDir, caseArtifactPath), "utf8"));
      expect(caseArtifact).toMatchObject({
        caseId: "beiping-beer-festival-guide",
        variant: "mock-expected-v1",
        status: "passed",
      });
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("refuses live-configured evaluation without provider configuration", async () => {
    await expect(runV5Evaluation({
      corpusDir: "tests/regression-corpus",
      caseIds: ["spanish-nantang-lecture"],
      variants: ["live-configured"],
      allowLive: true,
      maxCostCny: 1,
      env: {},
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
    })).rejects.toThrow("v5_evaluation_live_provider_config_missing:baseUrl,model,apiKey");
  });

  it("runs live-configured evaluation through injected provider config and budget", async () => {
    const fetchCalls = [];
    const fetchImpl = async (url, init) => {
      fetchCalls.push({ url, init });
      const body = fetchCalls.length === 1
        ? {
          decision: "event",
          events: [{
            title: "讲座《北京南堂的文化交流》",
            startsAt: "2026-06-10T18:30:00+08:00",
            city: "Beijing",
            venue: "北京南堂庞迪我会议室",
            registrationAction: "not_required",
            summary: "A public cultural lecture in Beijing.",
          }],
          publicEligibility: "public",
          publicEligibilityReason: "Open to the general public.",
          confidence: 0.91,
          reason: "Complete event facts extracted.",
        }
        : {
          displayTitle: "讲座《北京南堂的文化交流》",
          summary: "6月10日晚在北京南堂举办的公开文化讲座。",
          tags: ["talk", "culture"],
          category: "talk",
          audience: "general_public",
          audienceNote: "面向公众。",
          corrections: [],
          qualityIssues: [],
          editorDecision: "publish",
          reason: "Facts are complete and public.",
        };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify(body) } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
              cost_micro_cny: 20,
            },
          };
        },
      };
    };

    const result = await runV5Evaluation({
      corpusDir: "tests/regression-corpus",
      caseIds: ["spanish-nantang-lecture"],
      variants: ["live-configured"],
      allowLive: true,
      maxCostCny: 1,
      env: {
        V5_LIVE_PROVIDER: "test-openai-compatible",
        V5_LIVE_BASE_URL: "https://llm.example/v1",
        V5_LIVE_MODEL: "test-vl-model",
        V5_LIVE_API_KEY: "test-key",
      },
      fetchImpl,
      now: new Date("2026-06-10T05:00:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      caseCount: 1,
      runCount: 1,
      passCount: 1,
      failCount: 0,
      totalUsage: {
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        costMicroCny: 40,
      },
    });
    expect(result.cases[0]).toMatchObject({
      variant: "live-configured",
      predictedAction: "extract",
      predictedFinalState: "published",
      status: "passed",
    });
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].url).toBe("https://llm.example/v1/chat/completions");
  });
});
