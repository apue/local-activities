import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createCapturedArticleBundle,
  createCaptureFailureResult,
} from "../src/capture/article-bundle.mjs";
import {
  parsePromoteArgs,
  promoteRegressionCase,
} from "./regression-corpus-promote.mjs";

describe("regression corpus promotion", () => {
  it("promotes an already captured article bundle into a self-contained case", async () => {
    const corpusDir = await createTempCorpus();
    const bundleFile = path.join(corpusDir, "incoming-bundle.json");
    await writeJson(bundleFile, createBundle({ sourceUrl: "https://mp.weixin.qq.com/s/new-case" }));

    const result = await promoteRegressionCase({
      corpusDir,
      caseId: "new-bad-case",
      labels: ["ordinary_public_event", "qr_registration"],
      sourceUrl: "https://mp.weixin.qq.com/s/new-case",
      rationale: "Operator found a public event with QR registration handling risk.",
      bundleFile,
      expectedAction: "review",
      eventCount: 1,
    });

    expect(result.caseId).toBe("new-bad-case");
    await expect(readJson(path.join(result.caseDir, "case.json"))).resolves.toMatchObject({
      id: "new-bad-case",
      labels: ["ordinary_public_event", "qr_registration"],
      source: {
        type: "operator_bad_case",
        url: "https://mp.weixin.qq.com/s/new-case",
      },
    });
    await expect(readJson(path.join(result.caseDir, "captured-bundle.json"))).resolves.toMatchObject({
      version: "captured-article-bundle-v1",
      sourceUrl: "https://mp.weixin.qq.com/s/new-case",
    });
    await expect(readJson(path.join(result.caseDir, "expected.json"))).resolves.toMatchObject({
      action: "review",
      eventCount: 1,
      dedupe: { decision: "new_event" },
      publish: {
        state: "needs_review",
        reasons: ["operator_bad_case"],
      },
    });
    await expect(readJson(path.join(corpusDir, "manifest.json"))).resolves.toMatchObject({
      cases: [
        { id: "new-bad-case", labels: ["ordinary_public_event", "qr_registration"] },
      ],
    });
  });

  it("rejects duplicate case ids unless overwrite is explicit", async () => {
    const corpusDir = await createTempCorpus({
      cases: [{ id: "existing-case", labels: ["generic_not_event"] }],
    });
    const bundleFile = path.join(corpusDir, "incoming-bundle.json");
    await writeJson(bundleFile, createBundle({ sourceUrl: "https://mp.weixin.qq.com/s/existing" }));

    await expect(
      promoteRegressionCase({
        corpusDir,
        caseId: "existing-case",
        labels: ["generic_not_event"],
        sourceUrl: "https://mp.weixin.qq.com/s/existing",
        rationale: "Duplicate case id test.",
        bundleFile,
      }),
    ).rejects.toThrow("regression_promote_case_exists:existing-case");
  });

  it("rejects existing case directories unless overwrite is explicit", async () => {
    const corpusDir = await createTempCorpus();
    await mkdir(path.join(corpusDir, "orphan-case"), { recursive: true });
    const bundleFile = path.join(corpusDir, "incoming-bundle.json");
    await writeJson(bundleFile, createBundle({ sourceUrl: "https://mp.weixin.qq.com/s/orphan" }));

    await expect(
      promoteRegressionCase({
        corpusDir,
        caseId: "orphan-case",
        labels: ["ordinary_public_event"],
        sourceUrl: "https://mp.weixin.qq.com/s/orphan",
        rationale: "Existing directory should not be overwritten implicitly.",
        bundleFile,
        expectedAction: "extract",
        eventCount: 1,
      }),
    ).rejects.toThrow("regression_promote_case_exists:orphan-case");
  });

  it("requires event counts for promoted event actions", async () => {
    const corpusDir = await createTempCorpus();
    const bundleFile = path.join(corpusDir, "incoming-bundle.json");
    await writeJson(bundleFile, createBundle({ sourceUrl: "https://mp.weixin.qq.com/s/review-empty" }));

    await expect(
      promoteRegressionCase({
        corpusDir,
        caseId: "review-empty",
        labels: ["information_sparse_requires_review"],
        sourceUrl: "https://mp.weixin.qq.com/s/review-empty",
        rationale: "Review actions must exercise at least one event draft.",
        bundleFile,
        expectedAction: "review",
      }),
    ).rejects.toThrow("regression_promote_event_count_required_for_event_action");
  });

  it("rejects mismatched source urls before writing a promoted bundle case", async () => {
    const corpusDir = await createTempCorpus({
      cases: [{ id: "existing-case", labels: ["ordinary_public_event"] }],
    });
    const existingCaseDir = path.join(corpusDir, "existing-case");
    await mkdir(existingCaseDir, { recursive: true });
    await writeJson(path.join(existingCaseDir, "case.json"), {
      id: "existing-case",
      labels: ["ordinary_public_event"],
      source: {
        type: "operator_bad_case",
        url: "https://mp.weixin.qq.com/s/existing",
      },
      rationale: "Existing case should survive invalid overwrite.",
    });
    await writeJson(
      path.join(existingCaseDir, "captured-bundle.json"),
      createBundle({ sourceUrl: "https://mp.weixin.qq.com/s/existing" }),
    );
    await writeJson(path.join(existingCaseDir, "expected.json"), {
      action: "extract",
      eventCount: 1,
      evidence: {},
      dedupe: { decision: "new_event" },
      publish: { state: "public", reasons: ["existing"] },
      eventDrafts: [{ draftId: "existing-draft" }],
    });
    const bundleFile = path.join(corpusDir, "incoming-bundle.json");
    await writeJson(bundleFile, createBundle({ sourceUrl: "https://mp.weixin.qq.com/s/other" }));

    await expect(
      promoteRegressionCase({
        corpusDir,
        caseId: "existing-case",
        labels: ["ordinary_public_event"],
        sourceUrl: "https://mp.weixin.qq.com/s/existing",
        rationale: "Invalid overwrite should not mutate existing files.",
        bundleFile,
        expectedAction: "extract",
        eventCount: 1,
        overwrite: true,
      }),
    ).rejects.toThrow("regression_promote_bundle_source_url_mismatch");
    await expect(readJson(path.join(existingCaseDir, "expected.json"))).resolves.toMatchObject({
      publish: { state: "public", reasons: ["existing"] },
      eventDrafts: [{ draftId: "existing-draft" }],
    });
    await expect(readJson(path.join(existingCaseDir, "case.json"))).resolves.toMatchObject({
      rationale: "Existing case should survive invalid overwrite.",
    });
  });

  it("promotes typed capture failures without requiring a bundle", async () => {
    const corpusDir = await createTempCorpus();
    const captureResultFile = path.join(corpusDir, "capture-result.json");
    await writeJson(
      captureResultFile,
      createCaptureFailureResult({
        reason: "login_required",
        message: "Login expired during approved capture.",
        sourceUrl: "https://mp.weixin.qq.com/s/login-required",
      }),
    );

    const result = await promoteRegressionCase({
      corpusDir,
      caseId: "login-required-capture",
      labels: ["capture_failure"],
      sourceUrl: "https://mp.weixin.qq.com/s/login-required",
      rationale: "Approved capture could not proceed because login expired.",
      captureResultFile,
    });

    await expect(readJson(path.join(result.caseDir, "capture-result.json"))).resolves.toMatchObject({
      ok: false,
      failure: { reason: "login_required" },
    });
    await expect(readJson(path.join(result.caseDir, "expected.json"))).resolves.toEqual({
      action: "capture_failure",
      eventCount: 0,
      sourceHealth: {
        ok: false,
        failureReason: "login_required",
      },
      eventDrafts: [],
    });
  });

  it("rejects mismatched source urls for capture failures", async () => {
    const corpusDir = await createTempCorpus();
    const captureResultFile = path.join(corpusDir, "capture-result.json");
    await writeJson(
      captureResultFile,
      createCaptureFailureResult({
        reason: "fetch_blocked",
        message: "Blocked during approved capture.",
        sourceUrl: "https://mp.weixin.qq.com/s/blocked",
      }),
    );

    await expect(
      promoteRegressionCase({
        corpusDir,
        caseId: "blocked-capture",
        labels: ["capture_failure"],
        sourceUrl: "https://mp.weixin.qq.com/s/different",
        rationale: "Mismatch should be rejected.",
        captureResultFile,
      }),
    ).rejects.toThrow("regression_promote_capture_result_source_url_mismatch");
  });

  it("requires source urls on promoted capture failures", async () => {
    const corpusDir = await createTempCorpus();
    const captureResultFile = path.join(corpusDir, "capture-result.json");
    await writeJson(
      captureResultFile,
      {
        version: "capture-result-v1",
        ok: false,
        failure: {
          stage: "page_fetch",
          reason: "fetch_blocked",
          message: "Blocked during approved capture.",
          retryable: true,
          diagnostics: [],
        },
      },
    );

    await expect(
      promoteRegressionCase({
        corpusDir,
        caseId: "source-url-missing",
        labels: ["capture_failure"],
        sourceUrl: "https://mp.weixin.qq.com/s/source-url-missing",
        rationale: "Capture failure promotion must keep source attribution.",
        captureResultFile,
      }),
    ).rejects.toThrow("regression_promote_capture_result_source_url_required");
  });

  it("parses pnpm separator arguments for bundle promotion", () => {
    expect(
      parsePromoteArgs([
        "--",
        "--case-id",
        "new-case",
        "--label",
        "ordinary_public_event",
        "--label",
        "qr_registration",
        "--source-url",
        "https://mp.weixin.qq.com/s/new-case",
        "--rationale",
        "Operator bad case.",
        "--bundle-file",
        "bundle.json",
        "--event-count",
        "2",
        "--overwrite",
      ]),
    ).toMatchObject({
      caseId: "new-case",
      labels: ["ordinary_public_event", "qr_registration"],
      sourceUrl: "https://mp.weixin.qq.com/s/new-case",
      rationale: "Operator bad case.",
      bundleFile: "bundle.json",
      eventCount: 2,
      overwrite: true,
    });
  });
});

async function createTempCorpus({ cases = [] } = {}) {
  const corpusDir = await mkdtemp(path.join(os.tmpdir(), "regression-promote-"));
  await mkdir(corpusDir, { recursive: true });
  await writeJson(path.join(corpusDir, "manifest.json"), {
    version: "event-pipeline-regression-corpus-v1",
    cases,
  });
  return corpusDir;
}

function createBundle({ sourceUrl }) {
  return createCapturedArticleBundle({
    provider: "test",
    sourceUrl,
    canonicalUrl: sourceUrl,
    finalUrl: sourceUrl,
    capturedAt: "2026-06-08T00:00:00.000Z",
    text: "A captured event article used only for regression promotion tests.",
    images: [],
    links: [],
    miniPrograms: [],
    diagnostics: [],
    captureWarnings: [],
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
