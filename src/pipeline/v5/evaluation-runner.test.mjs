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
    ])).toMatchObject({
      allowLive: true,
      maxCostCny: 1,
    });
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
});
