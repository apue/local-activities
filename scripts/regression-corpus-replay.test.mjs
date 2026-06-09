import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  requiredCoverageLabels,
  assertOfflineReplayTarget,
  loadRegressionCorpus,
  parseRegressionReplayArgs,
  replayRegressionCase,
  runRegressionReplay,
} from "./regression-corpus-replay.mjs";

describe("event pipeline regression corpus replay", () => {
  it("loads an explicit real-bundle corpus and validates required coverage", async () => {
    const corpusDir = await createValidCorpus();
    const corpus = await loadRegressionCorpus({ corpusDir });

    expect(corpus.manifest.version).toBe("event-pipeline-regression-corpus-v1");
    expect(corpus.cases).toHaveLength(3);
    for (const label of requiredCoverageLabels) {
      expect(corpus.coverageLabels).toContain(label);
    }
  });

  it("refuses live, hosted, and production replay targets", async () => {
    for (const target of ["live_wechat", "live_llm", "hosted_supabase", "production"]) {
      expect(() => assertOfflineReplayTarget({ target })).toThrow(
        `regression_replay_refuses_live_or_production_target:${target}`,
      );
    }
  });

  it("parses pnpm separator arguments for explicit all-cases commands", () => {
    expect(parseRegressionReplayArgs([
      "--",
      "--all",
      "--corpus-dir",
      "/tmp/regression-corpus",
    ])).toEqual({
      all: true,
      corpusDir: "/tmp/regression-corpus",
      target: "offline",
    });
  });

  it("runs all explicit cases through CI-safe reset replay", async () => {
    const corpusDir = await createValidCorpus();
    const result = await runRegressionReplay({ all: true, corpusDir });

    expect(result).toMatchObject({
      ok: true,
      target: "offline",
      caseCount: 3,
    });
    expect(result.cases).toContainEqual(
      expect.objectContaining({
        caseId: "ordinary-public-event",
        eventCount: 1,
        evidenceSummary: expect.objectContaining({ posterCount: 1 }),
        sourceHealth: { ok: true },
      }),
    );
    expect(result.cases).toContainEqual(
      expect.objectContaining({
        caseId: "capture-fetch-blocked",
        status: "failed",
        sourceHealth: expect.objectContaining({ ok: false, failureReason: "fetch_blocked" }),
      }),
    );
    expect(result.cases).toContainEqual(
      expect.objectContaining({
        caseId: "qr-present-not-registration",
        eventCount: 0,
        evidenceSummary: expect.objectContaining({
          qrCodeCount: 0,
          nonRegistrationImageCount: 1,
        }),
      }),
    );
  });

  it("reports missing corpus files with case and file names", async () => {
    const corpusDir = await createMissingFileCorpus();

    await expect(loadRegressionCorpus({ corpusDir })).rejects.toThrow(
      "regression_corpus_file_missing:missing-case:expected.json",
    );
  });

  it("requires an explicit corpus directory", async () => {
    await expect(loadRegressionCorpus()).rejects.toThrow("regression_corpus_dir_required");
    await expect(runRegressionReplay({ all: true })).rejects.toThrow(
      "regression_corpus_dir_required",
    );
  });

  it("replays one explicit case by id", async () => {
    const corpusDir = await createValidCorpus();

    await expect(
      replayRegressionCase({ caseId: "ordinary-public-event", corpusDir }),
    ).resolves.toMatchObject({
      caseId: "ordinary-public-event",
      eventCount: 1,
      stageStatuses: {
        offline_sink: "skipped",
      },
    });
  });
});

async function createValidCorpus() {
  const corpusDir = await makeCorpusDir("regression-corpus-valid");
  const positiveLabels = [
    "ordinary_public_event",
    "registration_required",
    "qr_registration",
    "poster_or_image_dominant",
    "mini_program_action_registration",
    "multi_event_article",
    "recurring_or_multiple_occurrences",
    "long_running_exhibition",
    "duplicate_or_update",
    "information_sparse_requires_review",
  ];
  const negativeLabels = [
    "official_visit_non_public_news",
    "not_general_public",
    "generic_not_event",
    "not_beijing",
    "qr_present_not_registration",
  ];
  await writeManifest(corpusDir, [
    { id: "ordinary-public-event", labels: positiveLabels },
    { id: "qr-present-not-registration", labels: negativeLabels },
    { id: "capture-fetch-blocked", labels: ["capture_failure"] },
  ]);
  await writeSuccessCase({
    corpusDir,
    id: "ordinary-public-event",
    labels: positiveLabels,
    bundle: bundleFixture({
      id: "ordinary-public-event",
      text: "Public event in Beijing. Scan QR to register.",
      images: [
        { id: "poster-1", role: "poster", sourceUrl: "https://mmbiz.qpic.cn/poster.jpg" },
        {
          id: "qr-1",
          role: "registration",
          alt: "扫码报名",
          sourceUrl: "https://mmbiz.qpic.cn/qr.jpg",
        },
      ],
    }),
    expected: {
      action: "extract",
      eventCount: 1,
      evidence: { posterCount: 1, qrCodeCount: 1 },
      eventDrafts: [{ title: "Public event", draftId: "draft-1" }],
      dedupe: { decision: "new_event" },
      publish: { state: "needs_review" },
    },
  });
  await writeSuccessCase({
    corpusDir,
    id: "qr-present-not-registration",
    labels: negativeLabels,
    bundle: bundleFixture({
      id: "qr-present-not-registration",
      text: "News article with account follow QR.",
      images: [
        {
          id: "footer-qr",
          role: "qr",
          alt: "关注公众号",
          sourceUrl: "https://mmbiz.qpic.cn/follow-qr.jpg",
        },
      ],
    }),
    expected: {
      action: "exclude",
      eventCount: 0,
      evidence: { qrCodeCount: 0, nonRegistrationImageCount: 1 },
      eventDrafts: [],
      dedupe: { decision: "insufficient_info" },
      publish: { state: "excluded" },
    },
  });
  await writeFailureCase({ corpusDir, id: "capture-fetch-blocked" });
  return corpusDir;
}

async function createMissingFileCorpus() {
  const corpusDir = await makeCorpusDir("regression-corpus-missing");
  const caseId = "missing-case";
  await writeManifest(corpusDir, [
    { id: caseId, labels: requiredCoverageLabels },
  ]);
  await mkdir(path.join(corpusDir, caseId), { recursive: true });
  await writeJson(path.join(corpusDir, caseId, "case.json"), {
    id: caseId,
    labels: requiredCoverageLabels,
    source: { type: "captured_bundle", url: "https://mp.weixin.qq.com/s/missing" },
    rationale: "Missing expected file test case.",
  });
  await writeJson(
    path.join(corpusDir, caseId, "captured-bundle.json"),
    bundleFixture({ id: caseId }),
  );
  return corpusDir;
}

async function makeCorpusDir(prefix) {
  return await mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function writeManifest(corpusDir, cases) {
  await mkdir(corpusDir, { recursive: true });
  await writeJson(path.join(corpusDir, "manifest.json"), {
    version: "event-pipeline-regression-corpus-v1",
    description: "Temporary contract-valid corpus for replay tests.",
    cases,
  });
}

async function writeSuccessCase({ corpusDir, id, labels, bundle, expected }) {
  const caseDir = path.join(corpusDir, id);
  await mkdir(caseDir, { recursive: true });
  await writeJson(path.join(caseDir, "case.json"), {
    id,
    labels,
    source: { type: "captured_bundle", url: bundle.sourceUrl },
    rationale: `Temporary ${id} replay case.`,
  });
  await writeJson(path.join(caseDir, "captured-bundle.json"), bundle);
  await writeJson(path.join(caseDir, "expected.json"), expected);
}

async function writeFailureCase({ corpusDir, id }) {
  const caseDir = path.join(corpusDir, id);
  await mkdir(caseDir, { recursive: true });
  await writeJson(path.join(caseDir, "case.json"), {
    id,
    labels: ["capture_failure"],
    source: { type: "capture_failure", url: "https://mp.weixin.qq.com/s/blocked" },
    rationale: "Temporary capture failure replay case.",
  });
  await writeJson(path.join(caseDir, "capture-result.json"), {
    version: "capture-result-v1",
    ok: false,
    failure: {
      stage: "page_fetch",
      reason: "fetch_blocked",
      message: "Fetch blocked by source.",
      retryable: true,
      sourceUrl: "https://mp.weixin.qq.com/s/blocked",
      diagnostics: [],
    },
    diagnostics: [],
    captureWarnings: [],
  });
  await writeJson(path.join(caseDir, "expected.json"), {
    action: "capture_failure",
    eventCount: 0,
    sourceHealth: { failureReason: "fetch_blocked" },
  });
}

function bundleFixture({ id, text = "Temporary replay case.", images = [] }) {
  return {
    version: "captured-article-bundle-v1",
    captureId: `capture-${id}`,
    provider: "local_fixture",
    sourceUrl: `https://mp.weixin.qq.com/s/${id}`,
    canonicalUrl: `https://mp.weixin.qq.com/s/${id}`,
    finalUrl: `https://mp.weixin.qq.com/s/${id}`,
    capturedAt: "2026-06-08T00:00:00.000Z",
    captureMode: "html_complete",
    text,
    html: `<article>${text}</article>`,
    images,
    links: [],
    miniPrograms: [],
    diagnostics: [],
    captureWarnings: [],
    contentHash: `sha256-${id}`,
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
