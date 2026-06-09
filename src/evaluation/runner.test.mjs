import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadRegressionCorpus } from "../../scripts/regression-corpus-replay.mjs";
import {
  createConfiguredLiveVariant,
  createLocalEvaluationWriter,
  createMemoryEvaluationWriter,
  createSupabaseEvaluationWriter,
  resolveExtractorVariants,
  runEvaluation,
  scoreEvaluationCase,
} from "./runner.mjs";

describe("evaluation runner", () => {
  it("scores false negatives and false positives as hard failures", async () => {
    const corpus = await loadRegressionCorpus();
    const positive = corpus.cases.find((item) => item.case.id === "korean-red-flavor");
    const negative = corpus.cases.find((item) => item.case.id === "official-visit-news");

    expect(
      scoreEvaluationCase({
        caseItem: positive,
        output: {
          decision: "excluded",
          reason: "bad filter",
          confidence: 0.5,
          events: [],
          dedupe: { decision: "insufficient_info" },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      }),
    ).toMatchObject({
      passed: false,
      actualAction: "exclude",
      scores: { falseNegative: true },
      errors: expect.arrayContaining(["action_mismatch", "event_count_mismatch"]),
    });

    expect(
      scoreEvaluationCase({
        caseItem: negative,
        output: {
          decision: "published",
          reason: "bad extraction",
          confidence: 0.9,
          events: [{ title: "Wrong public event" }],
          dedupe: { decision: "new_event" },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      }),
    ).toMatchObject({
      passed: false,
      actualAction: "extract",
      scores: { falsePositive: true },
      errors: expect.arrayContaining(["action_mismatch", "event_count_mismatch"]),
    });
  });

  it("compares two deterministic mock extractor variants without production writes", async () => {
    const corpus = await loadRegressionCorpus();
    const writer = createMemoryEvaluationWriter();

    const result = await runEvaluation({
      corpus,
      writer,
      variantIds: ["mock-expected-v1", "mock-overfilter-v1"],
      now: new Date("2026-06-08T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      runCount: 2,
      caseCount: 15,
    });
    const rows = writer.state.rows;
    expect(rows.evaluation_runs).toHaveLength(2);
    expect(rows.evaluation_case_results).toHaveLength(30);
    expect(rows.llm_usage_ledger).toHaveLength(30);
    expect(Object.keys(rows)).toEqual([
      "evaluation_runs",
      "evaluation_case_results",
      "llm_usage_ledger",
    ]);
    expect(rows.evaluation_runs[0]).toMatchObject({
      run_id: "eval-mock-expected-v1-20260608120000",
      status: "completed",
      pass_count: 15,
      fail_count: 0,
    });
    expect(rows.evaluation_runs[1].summary.falseNegativeCount).toBeGreaterThan(0);
    expect(rows.llm_usage_ledger.every((row) => row.mode === "eval")).toBe(true);
    expect(rows.llm_usage_ledger.every((row) => row.operation === "evaluation_case")).toBe(true);
    expect([...writer.artifacts().keys()]).toContain(
      "runs/eval-mock-expected-v1-20260608120000/report.json",
    );
  });

  it("writes local evaluation artifacts for reports and per-case details", async () => {
    const corpus = await loadRegressionCorpus();
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "evaluation-artifacts-"));
    const writer = createLocalEvaluationWriter({ artifactDir });

    await runEvaluation({
      corpus,
      writer,
      variantIds: ["mock-expected-v1"],
      caseIds: ["korean-red-flavor"],
      now: new Date("2026-06-08T12:30:00.000Z"),
    });

    const reportPath = path.join(
      artifactDir,
      "runs/eval-mock-expected-v1-20260608123000/report.json",
    );
    const casePath = path.join(
      artifactDir,
      "runs/eval-mock-expected-v1-20260608123000/cases/korean-red-flavor.json",
    );
    await expect(readJson(reportPath)).resolves.toMatchObject({
      run: {
        run_id: "eval-mock-expected-v1-20260608123000",
        case_count: 1,
        pass_count: 1,
      },
    });
    await expect(readJson(casePath)).resolves.toMatchObject({
      case: { id: "korean-red-flavor" },
      actual: { action: "extract" },
      scores: { actionMatch: true },
    });
  });

  it("guards live variants unless explicitly enabled", () => {
    expect(() => resolveExtractorVariants({ variantIds: ["live-configured"] }))
      .toThrow("evaluation_live_variant_requires_allow_live");
  });

  it("requires live pricing so budget guards can estimate spend", () => {
    expect(() =>
      createConfiguredLiveVariant({
        env: {
          ANALYSIS_LLM_BASE_URL: "https://provider.example/v1",
          ANALYSIS_LLM_API_KEY: "test-key",
          ANALYSIS_LLM_MODEL: "vision-model",
        },
        fetchImpl: async () => {
          throw new Error("should_not_fetch");
        },
      })
    ).toThrow("evaluation_live_pricing_required");
  });

  it("uses the production analysis prompt and declared analysis image assets for live evaluation", async () => {
    const requests = [];
    const variant = createConfiguredLiveVariant({
      env: {
        ANALYSIS_LLM_BASE_URL: "https://provider.example/v1",
        ANALYSIS_LLM_API_KEY: "test-key",
        ANALYSIS_LLM_MODEL: "vision-model",
        EVALUATION_INPUT_TOKEN_MICRO_CNY: "1",
        EVALUATION_OUTPUT_TOKEN_MICRO_CNY: "1",
      },
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  decision: "excluded",
                  reason: "Not a public event.",
                  confidence: 0.9,
                  events: [],
                  excludedArticle: {
                    triageDecision: "not_event",
                    exclusionReason: "Not a public event.",
                    publicSignals: [],
                    exclusionSignals: [],
                  },
                  dedupe: { decision: "insufficient_info", confidence: 0.9 },
                }),
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await variant.analyze({
      context: {
        mode: "eval",
        runId: "eval-test-run",
      },
      caseItem: {
        case: { id: "live-input-test", labels: [] },
        expected: { action: "exclude", eventCount: 0, evidence: {} },
        bundle: {
          text: "Public activity. Scan the poster QR code to register.",
          html: "<article><img src=\"https://cdn.example/poster.jpg\"></article>",
          links: [],
          diagnostics: [],
          images: [{
            sourceUrl: "https://upstream.example/poster.jpg",
            id: "source-reference-only",
            role: "poster",
          }, {
            publicUrl: "https://cdn.example/assets/poster.jpg",
            sourceUrl: "https://upstream.example/public-poster.jpg",
            id: "public-poster",
            role: "poster",
          }, {
            dataUrl: "data:image/png;base64,aGVsbG8=",
            sourceUrl: "https://upstream.example/qr.jpg",
            id: "data-url-qr",
            role: "registration_qr",
          }],
        },
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0].content).toContain(
      "You analyze official Beijing cultural activity articles",
    );
    expect(requests[0].messages[0].content).not.toContain(
      "You evaluate a captured Beijing cultural activity article",
    );
    const imageUrls = requests[0].messages[1].content
      .filter((part) => part.type === "image_url")
      .map((part) => part.image_url.url);
    expect(imageUrls).toEqual([
      "https://cdn.example/assets/poster.jpg",
      "data:image/png;base64,aGVsbG8=",
    ]);
    expect(JSON.stringify(requests[0])).toContain("Image metadata:");
  });

  it("marks vision live eval cases without consumable assets invalid before provider calls", async () => {
    const corpus = await loadRegressionCorpus();
    const writer = createMemoryEvaluationWriter();
    let fetchCount = 0;
    const variant = createConfiguredLiveVariant({
      env: {
        ANALYSIS_LLM_BASE_URL: "https://provider.example/v1",
        ANALYSIS_LLM_API_KEY: "test-key",
        ANALYSIS_LLM_MODEL: "vision-model",
        EVALUATION_INPUT_TOKEN_MICRO_CNY: "1",
        EVALUATION_OUTPUT_TOKEN_MICRO_CNY: "1",
      },
      fetchImpl: async () => {
        fetchCount += 1;
        throw new Error("provider_should_not_be_called");
      },
    });

    await runEvaluation({
      corpus,
      writer,
      variants: [variant],
      caseIds: ["qr-registration-poster"],
      maxCostCny: 1,
      now: new Date("2026-06-08T14:00:00.000Z"),
    });

    expect(fetchCount).toBe(0);
    expect(writer.state.rows.evaluation_case_results[0]).toMatchObject({
      actual_action: "failed",
      passed: false,
      errors: expect.arrayContaining([{ reason: "invalid_input" }]),
    });
    expect(writer.state.rows.llm_usage_ledger[0]).toMatchObject({
      status: "failed",
      total_tokens: 0,
    });
  });

  it("marks a run failed when live budget checks abort after the run starts", async () => {
    const corpus = await loadRegressionCorpus();
    const writer = createMemoryEvaluationWriter();
    const liveVariant = {
      id: "live-test",
      provider: "mock-live",
      model: "live-budget",
      promptVersion: "live-test",
      schemaVersion: "analysis-output-v1",
      live: true,
      parameters: {
        inputTokenMicroCny: 2_000_000,
        outputTokenMicroCny: 2_000_000,
      },
      async analyze({ caseItem }) {
        return {
          decision: "excluded",
          reason: "expensive result",
          confidence: 0.9,
          events: [],
          dedupe: { decision: "insufficient_info" },
          usage: {
            inputTokens: 2,
            outputTokens: 2,
            totalTokens: 4,
          },
        };
      },
    };

    await expect(
      runEvaluation({
        corpus,
        writer,
        variants: [liveVariant],
        caseIds: ["korean-red-flavor", "official-visit-news"],
        maxCostCny: 1,
        now: new Date("2026-06-08T13:00:00.000Z"),
      }),
    ).rejects.toThrow("evaluation_live_budget_exhausted");
    expect(writer.state.rows.evaluation_runs).toContainEqual(
      expect.objectContaining({
        run_id: "eval-live-test-20260608130000",
        status: "failed",
        summary: expect.objectContaining({
          failure: expect.objectContaining({
            message: "evaluation_live_budget_exhausted",
          }),
        }),
      }),
    );
  });

  it("uses only eval-scoped tables and storage in the Supabase writer", async () => {
    const calls = [];
    const storageCalls = [];
    const client = {
      from(table) {
        return {
          upsert(row, options) {
            calls.push({ table, row, options });
            return { error: null };
          },
        };
      },
      storage: {
        from(bucket) {
          return {
            upload(artifactPath, body, options) {
              storageCalls.push({ bucket, artifactPath, body, options });
              return { error: null };
            },
          };
        },
      },
    };
    const writer = await createSupabaseEvaluationWriter({ client });

    await writer.writeEvaluationRun({ run_id: "eval-1", status: "completed" });
    await writer.writeEvaluationCaseResult({
      run_id: "eval-1",
      case_id: "case-1",
      result_id: "result-1",
    });
    await writer.writeUsage({
      usage_id: "usage-1",
      mode: "eval",
      evaluation_run_id: "eval-1",
    });
    await writer.writeArtifact("runs/eval-1/report.json", { ok: true });

    expect(calls.map((item) => item.table)).toEqual([
      "evaluation_runs",
      "evaluation_case_results",
      "llm_usage_ledger",
    ]);
    expect(calls.map((item) => item.options.onConflict)).toEqual([
      "run_id",
      "run_id,case_id",
      "usage_id",
    ]);
    expect(storageCalls).toEqual([
      expect.objectContaining({
        bucket: "eval-artifacts",
        artifactPath: "runs/eval-1/report.json",
        options: expect.objectContaining({ contentType: "application/json", upsert: true }),
      }),
    ]);
  });

  it("enforces eval bucket and usage scoping in the Supabase writer", async () => {
    await expect(
      createSupabaseEvaluationWriter({
        artifactBucket: "article-bundles",
        client: {},
      }),
    ).rejects.toThrow("evaluation_artifact_bucket_forbidden:article-bundles");

    const writer = await createSupabaseEvaluationWriter({
      client: {
        from() {
          return {
            upsert() {
              return { error: null };
            },
          };
        },
        storage: {
          from() {
            return {
              upload() {
                return { error: null };
              },
            };
          },
        },
      },
    });

    await expect(writer.writeUsage({ usage_id: "usage-1", mode: "production" }))
      .rejects.toThrow("evaluation_usage_mode_required");
    await expect(writer.writeUsage({ usage_id: "usage-2", mode: "eval" }))
      .rejects.toThrow("evaluation_usage_run_id_required");
  });
});

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
