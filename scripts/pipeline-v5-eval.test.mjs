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
});
