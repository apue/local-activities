import { mkdir, writeFile } from "node:fs/promises";
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
  it("loads the committed manifest and validates required coverage", async () => {
    const corpus = await loadRegressionCorpus();

    expect(corpus.manifest.version).toBe("event-pipeline-regression-corpus-v1");
    expect(corpus.cases.length).toBeGreaterThanOrEqual(15);
    expect(corpus.cases.length).toBeLessThanOrEqual(25);
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

  it("parses pnpm separator arguments for the all-cases command", () => {
    expect(parseRegressionReplayArgs(["--", "--all"])).toEqual({
      all: true,
      target: "offline",
    });
  });

  it("runs all committed cases through CI-safe mock E2E replay", async () => {
    const result = await runRegressionReplay({ all: true });

    expect(result).toMatchObject({
      ok: true,
      target: "offline",
      caseCount: expect.any(Number),
    });
    expect(result.cases).toContainEqual(
      expect.objectContaining({
        caseId: "korean-red-flavor",
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
    expect(result.cases).toContainEqual(
      expect.objectContaining({
        caseId: "sparse-poster-review",
        expectedAction: "review",
        eventCount: 1,
        publishDecisions: [
          expect.objectContaining({ state: "needs_review" }),
        ],
      }),
    );
  });

  it("replays capture failure cases through the orchestrator failure path", async () => {
    const result = await replayRegressionCase({ caseId: "capture-fetch-blocked" });

    expect(result).toMatchObject({
      caseId: "capture-fetch-blocked",
      status: "failed",
      stageStatuses: {
        capture: "failed",
        cleanup: "success",
      },
      sourceHealth: {
        ok: false,
        failureReason: "fetch_blocked",
      },
    });
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        stage: "page_fetch",
        reason: "fetch_blocked",
      }),
    );
  });

  it("asserts evidence expectations from captured bundles", async () => {
    await expect(replayRegressionCase({ caseId: "qr-registration-poster" })).resolves.toMatchObject({
      caseId: "qr-registration-poster",
      eventCount: 1,
      evidenceSummary: {
        posterCount: 1,
        qrCodeCount: 1,
        registrationUrlCount: 0,
        miniProgramActionCount: 0,
      },
    });

    await expect(
      replayRegressionCase({ caseId: "beiping-beer-festival" }),
    ).resolves.toMatchObject({
      caseId: "beiping-beer-festival",
      eventCount: 1,
      stageStatuses: {
        ingest: "skipped",
      },
      dedupeDecisions: [expect.objectContaining({ decision: "same_event" })],
    });
  });

  it("reports missing corpus files with case and file names", async () => {
    const corpusDir = await createMinimalCorpus({ omitFile: "expected.json" });

    await expect(loadRegressionCorpus({ corpusDir })).rejects.toThrow(
      "regression_corpus_file_missing:missing-case:expected.json",
    );
  });
});

async function createMinimalCorpus({ omitFile }) {
  const corpusDir = path.join(os.tmpdir(), `regression-corpus-${Date.now()}`);
  const caseId = "missing-case";
  await mkdir(path.join(corpusDir, caseId), { recursive: true });
  await writeFile(
    path.join(corpusDir, "manifest.json"),
    JSON.stringify({
      version: "event-pipeline-regression-corpus-v1",
      cases: [{ id: caseId, labels: ["ordinary_public_event"] }],
    }),
  );
  await writeFile(
    path.join(corpusDir, caseId, "case.json"),
    JSON.stringify({
      id: caseId,
      labels: ["ordinary_public_event"],
      source: { type: "local_fixture", url: "https://mp.weixin.qq.com/s/missing" },
      rationale: "Missing expected file test case.",
    }),
  );
  if (omitFile !== "expected.json") {
    await writeFile(
      path.join(corpusDir, caseId, "expected.json"),
      JSON.stringify({
        action: "extract",
        eventCount: 0,
        evidence: {},
        dedupe: { decision: "new_event" },
        publish: { state: "needs_review" },
      }),
    );
  }
  await writeFile(
    path.join(corpusDir, caseId, "captured-bundle.json"),
    JSON.stringify({
      version: "captured-article-bundle-v1",
      captureId: "capture-missing-case",
      provider: "local_fixture",
      sourceUrl: "https://mp.weixin.qq.com/s/missing",
      canonicalUrl: "https://mp.weixin.qq.com/s/missing",
      finalUrl: "https://mp.weixin.qq.com/s/missing",
      capturedAt: "2026-06-08T00:00:00.000Z",
      captureMode: "text_complete",
      text: "Minimal missing-file test bundle.",
      images: [],
      links: [],
      miniPrograms: [],
      diagnostics: [],
      captureWarnings: [],
      contentHash: "minimal-missing-file",
    }),
  );
  return corpusDir;
}
