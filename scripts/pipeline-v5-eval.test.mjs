import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import { runV5EvaluationCli } from "./pipeline-v5-eval.mjs";

describe("pipeline-v5-eval CLI", () => {
  it("is exposed through the package script", () => {
    expect(packageJson.scripts["pipeline:v5:eval"]).toBe("node scripts/pipeline-v5-eval.mjs");
  });

  it("prints JSON summary for memory evaluation", async () => {
    let printed = "";
    const result = await runV5EvaluationCli(
      [
        "--corpus-dir",
        "tests/regression-corpus",
        "--case",
        "beiping-beer-festival-guide",
        "--store",
        "memory",
        "--variant",
        "mock-expected-v1",
      ],
      {
        log: (value) => {
          printed += value;
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(printed)).toMatchObject({
      ok: true,
      store: "memory",
      caseCount: 1,
      runCount: 1,
      passCount: 1,
      failCount: 0,
      reviewMetrics: {
        registrationSuccessRate: 1,
        humanFeedbackCount: 0,
      },
      totalUsage: {
        totalTokens: 0,
        costMicroCny: 0,
        latencyMs: 0,
      },
      artifactPaths: [
        expect.stringContaining("/summary.json"),
        expect.stringContaining("/variants/mock-expected-v1/cases/beiping-beer-festival-guide.json"),
      ],
    });
  });

  it("prints JSON comparison report for baseline and candidate variants", async () => {
    let printed = "";
    const result = await runV5EvaluationCli(
      [
        "--corpus-dir",
        "tests/regression-corpus",
        "--all",
        "--store",
        "memory",
        "--baseline-config-id",
        "baseline-active",
        "--baseline-variant",
        "mock-expected-v1",
        "--candidate-config-id",
        "candidate-underfilter",
        "--candidate-variant",
        "mock-underfilter-v1",
      ],
      {
        log: (value) => {
          printed += value;
        },
      },
    );

    const output = JSON.parse(printed);
    expect(result.kind).toBe("v5_baseline_candidate_eval_comparison");
    expect(output).toMatchObject({
      kind: "v5_baseline_candidate_eval_comparison",
      recommended: false,
      baseline: {
        configId: "baseline-active",
        variant: "mock-expected-v1",
      },
      candidate: {
        configId: "candidate-underfilter",
        variant: "mock-underfilter-v1",
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          name: "false_positive_rate",
          passed: false,
        }),
      ]),
      regressions: expect.arrayContaining([
        expect.objectContaining({
          failureTypes: expect.arrayContaining(["false_positive"]),
        }),
      ]),
      comparisonPath: expect.stringContaining("/comparison.json"),
    });
  });

  it("requires explicit baseline and candidate config ids for comparison mode", async () => {
    await expect(runV5EvaluationCli(
      [
        "--corpus-dir",
        "tests/regression-corpus",
        "--all",
        "--store",
        "memory",
        "--baseline-variant",
        "mock-expected-v1",
        "--candidate-config-id",
        "candidate",
        "--candidate-variant",
        "mock-expected-v1",
      ],
      { log: () => {} },
    )).rejects.toThrow("v5_evaluation_baseline_config_id_required");
  });

  it("loads env files before running explicit live-configured evaluation", async () => {
    let loadedEnvFile = "";
    let printed = "";
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

    const result = await runV5EvaluationCli(
      [
        "--corpus-dir",
        "tests/regression-corpus",
        "--case",
        "spanish-nantang-lecture",
        "--store",
        "memory",
        "--variant",
        "live-configured",
        "--allow-live",
        "--max-cost-cny",
        "1",
        "--env-file",
        ".env.live",
      ],
      {
        log: (value) => {
          printed += value;
        },
      },
      {
        env: {},
        loadEnvFileImpl: (envFile) => {
          loadedEnvFile = envFile;
          return {
            V5_LIVE_PROVIDER: "test-openai-compatible",
            V5_LIVE_BASE_URL: "https://llm.example/v1",
            V5_LIVE_MODEL: "test-vl-model",
            V5_LIVE_API_KEY: "test-key",
          };
        },
        fetchImpl,
      },
    );

    expect(loadedEnvFile).toMatch(/\.env\.live$/);
    expect(fetchCalls).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(JSON.parse(printed)).toMatchObject({
      ok: true,
      store: "memory",
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
      variantSummaries: [
        expect.objectContaining({
          variant: "live-configured",
          passCount: 1,
        }),
      ],
    });
  });
});
