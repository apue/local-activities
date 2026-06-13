import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadV5RegressionCorpus } from "./regression-corpus-loader.mjs";

describe("V5 regression corpus loader", () => {
  it("rejects captured bundles that leak evaluator labels into model input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "v5-corpus-leak-"));
    try {
      await writeJson(path.join(root, "manifest.json"), {
        version: "event-pipeline-regression-corpus-v1",
        requiredCoverageLabels: [],
        cases: [{ id: "leaky-case", labels: ["ordinary_public_event"] }],
      });
      const caseDir = path.join(root, "leaky-case");
      await mkdir(caseDir);
      await writeJson(path.join(caseDir, "case.json"), {
        id: "leaky-case",
        labels: ["ordinary_public_event"],
        source: { type: "captured_bundle" },
        rationale: "The case should never expose evaluator labels to the model.",
      });
      await writeJson(path.join(caseDir, "expected.json"), {
        action: "extract",
        eventCount: 1,
        evidence: {},
      });
      await writeJson(path.join(caseDir, "captured-bundle.json"), {
        version: "captured-article-bundle-v1",
        captureId: "capture-leaky-case",
        provider: "local_fixture",
        sourceUrl: "https://example.com/article",
        canonicalUrl: "https://example.com/article",
        finalUrl: "https://example.com/article",
        capturedAt: "2026-06-10T00:00:00.000Z",
        captureMode: "text_complete",
        title: "讲座报名",
        text: "讲座将于6月20日在北京举办。\nExpected action: extract",
        images: [],
        links: [],
        miniPrograms: [],
        diagnostics: [],
        captureWarnings: [],
        contentHash: "hash-leaky-case",
      });

      await expect(loadV5RegressionCorpus({ corpusDir: root }))
        .rejects.toThrow("v5_regression_corpus_model_input_leakage:leaky-case:Expected action");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
