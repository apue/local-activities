import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCapturedArticleBundle } from "../../capture/article-bundle.mjs";
import { loadV5RegressionCorpus } from "./regression-corpus-loader.mjs";
import {
  assertNoPrivateCorpusLabelLeakage,
  exportPrivateCorpusCase,
} from "./private-corpus-builder.mjs";

describe("private corpus builder", () => {
  it("exports a V5-compatible private case from feedback without leaking expected labels into captured bundle", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "private-corpus-"));
    try {
      const store = privateCorpusStore({
        feedback: {
          id: "feedback-1",
          dataClass: "production",
          feedbackType: "missing_qr",
          articleBundleId: "bundle-1",
          draftId: "draft-1",
          fieldName: "registrationQrAssetId",
          oldValue: null,
          correctedValue: "qr-001",
          reason: "The QR code is visible in the article poster.",
          createdBy: "admin",
          status: "open",
          metadata: {},
          createdAt: "2026-06-11T10:00:00.000Z",
          updatedAt: "2026-06-11T10:00:00.000Z",
        },
        bundle: fixtureBundle(),
      });

      const result = await exportPrivateCorpusCase({
        feedbackId: "feedback-1",
        outputDir: tmpDir,
        store,
        now: new Date("2026-06-11T10:30:00.000Z"),
      });

      expect(result).toMatchObject({
        caseId: "wechat-event-feedback-1",
        caseDir: path.join(tmpDir, "wechat-event-feedback-1"),
      });
      await expect(
        stat(path.join(result.caseDir, "assets", "poster-1.png")),
      ).resolves.toMatchObject({ size: 4 });

      const manifest = JSON.parse(
        await readFile(path.join(tmpDir, "manifest.json"), "utf8"),
      );
      expect(manifest).toMatchObject({
        version: "event-pipeline-regression-corpus-v1",
        cases: [
          {
            id: "wechat-event-feedback-1",
            labels: ["qr_registration"],
          },
        ],
        requiredCoverageLabels: ["qr_registration"],
      });

      const caseJson = JSON.parse(
        await readFile(path.join(result.caseDir, "case.json"), "utf8"),
      );
      expect(caseJson).toMatchObject({
        id: "wechat-event-feedback-1",
        expected_action: "extract",
        expected_event_count: 1,
        known_failure_type: "missing_qr",
        created_from_feedback_id: "feedback-1",
        source: {
          type: "captured_bundle",
          provider: "wechat2rss",
          sourceName: "Test Culture Center",
          url: "https://mp.weixin.qq.com/s/test-event",
        },
      });

      const capturedBundleText = await readFile(
        path.join(result.caseDir, "captured-bundle.json"),
        "utf8",
      );
      expect(capturedBundleText).not.toMatch(/Expected action|expected_event/i);
      expect(capturedBundleText).toContain("Culture talk registration opens now.");
      expect(capturedBundleText).toContain("assets/poster-1.png");

      const corpus = await loadV5RegressionCorpus({ corpusDir: tmpDir });
      expect(corpus.cases).toHaveLength(1);
      expect(corpus.cases[0]).toMatchObject({
        case: {
          id: "wechat-event-feedback-1",
          expected_action: "extract",
        },
        expected: {
          action: "extract",
          eventCount: 1,
        },
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses captured bundle model input containing judge-only labels", async () => {
    expect(() =>
      assertNoPrivateCorpusLabelLeakage({
        text: "EXPECTED_ACTION: extract\nexpected action: extract\nRationale: judge label",
      }),
    ).toThrow("private_corpus_model_input_leakage:");

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "private-corpus-"));
    try {
      await expect(
        exportPrivateCorpusCase({
          articleBundleId: "bundle-1",
          outputDir: tmpDir,
          expected: { action: "extract", eventCount: 1 },
          store: privateCorpusStore({
            bundle: {
              ...fixtureBundle(),
              text: "Expected action: extract\nCulture talk registration opens now.",
            },
          }),
        }),
      ).rejects.toThrow("private_corpus_model_input_leakage:Expected action");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe explicit case ids that would escape the private corpus directory", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "private-corpus-"));
    try {
      await expect(
        exportPrivateCorpusCase({
          articleBundleId: "bundle-1",
          outputDir: tmpDir,
          caseId: "../../escape",
          expected: { action: "extract", eventCount: 1 },
          store: privateCorpusStore({
            bundle: fixtureBundle(),
          }),
        }),
      ).rejects.toThrow("private_corpus_case_id_invalid");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("exports from a pipeline run or article bundle with explicit expected behavior", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "private-corpus-"));
    try {
      const store = privateCorpusStore({
        pipelineRun: {
          runId: "pipe-1",
          dataClass: "eval",
          articleBundleId: "bundle-1",
          decision: "needs_review",
          reason: "Operator wants a regression case.",
        },
        bundle: fixtureBundle(),
      });

      const fromRun = await exportPrivateCorpusCase({
        pipelineRunId: "pipe-1",
        outputDir: tmpDir,
        expected: { action: "review", eventCount: 1 },
        store,
      });
      const fromRunCase = JSON.parse(
        await readFile(path.join(fromRun.caseDir, "case.json"), "utf8"),
      );
      expect(fromRunCase).toMatchObject({
        created_from_pipeline_run_id: "pipe-1",
        expected_action: "review",
      });

      const fromBundle = await exportPrivateCorpusCase({
        articleBundleId: "bundle-1",
        outputDir: tmpDir,
        expected: { action: "extract", eventCount: 1 },
        caseId: "explicit-bundle-case",
        store,
      });
      expect(fromBundle.caseId).toBe("explicit-bundle-case");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

function privateCorpusStore({ feedback, pipelineRun, bundle } = {}) {
  return {
    async getFeedbackById(feedbackId) {
      return feedback?.id === feedbackId ? feedback : null;
    },
    async getPipelineRunById(runId) {
      return pipelineRun?.runId === runId ? pipelineRun : null;
    },
    async getArticleBundleById(bundleId) {
      if (bundleId !== "bundle-1") return null;
      return {
        bundleId,
        capturedBundle: bundle,
        sourceMetadata: {
          sourceName: bundle.sourceName,
          sourceUrl: bundle.sourceUrl,
          publishedAt: bundle.publishedAt,
        },
      };
    },
  };
}

function fixtureBundle() {
  return createCapturedArticleBundle({
    captureId: "capture-test-1",
    sourceId: "source-1",
    sourceName: "Test Culture Center",
    provider: "wechat2rss",
    sourceUrl: "https://mp.weixin.qq.com/s/test-event",
    canonicalUrl: "https://mp.weixin.qq.com/s/test-event",
    finalUrl: "https://mp.weixin.qq.com/s/test-event",
    title: "Culture Talk",
    authorName: "Test Culture Center",
    publishedAt: "2026-06-10T09:00:00.000Z",
    capturedAt: "2026-06-11T09:00:00.000Z",
    text: "Culture talk registration opens now.",
    html: "<article><p>Culture talk registration opens now.</p></article>",
    images: [
      {
        id: "poster-1",
        role: "poster",
        sourceUrl: "https://mmbiz.qpic.cn/test-poster.png",
        contentType: "image/png",
        body: Buffer.from([1, 2, 3, 4]),
        alt: "Culture talk poster with QR code",
      },
    ],
    links: [
      {
        url: "https://example.com/register",
        text: "Register",
        role: "registration",
      },
    ],
    miniPrograms: [
      {
        appId: "wx-test",
        path: "pages/register",
        text: "Mini program registration",
        actionType: "registration",
      },
    ],
  });
}
