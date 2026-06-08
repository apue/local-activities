import { describe, expect, it } from "vitest";

import { createCapturedArticleBundle } from "../../capture/article-bundle.mjs";
import { runArticlePipelineOnce } from "./pipeline.mjs";

const now = new Date("2026-06-08T02:30:00.000Z");

describe("article pipeline orchestrator", () => {
  it("runs capture, evidence, mocked extraction, dedupe, publish policy, and fake ingest", async () => {
    const calls = [];
    const report = await runArticlePipelineOnce({
      env: { COLLECTOR_ID: "collector-test" },
      runId: "pipeline-e2e",
      sourceUrl: "https://mp.weixin.qq.com/s/e2e",
      now,
      capture: async () => {
        calls.push("capture");
        return { ok: true, bundle: articleBundle() };
      },
      extractEvidence: async ({ bundle }) => {
        calls.push("evidence");
        return {
          version: "evidence-set-v1",
          articleUrl: bundle.sourceUrl,
          evidenceAssets: [{ assetId: "asset-poster", role: "poster" }],
          summary: { posterCount: 1 },
        };
      },
      extractEvents: async ({ articleSnapshot, evidenceAssets, upload }) => {
        calls.push("extract");
        expect(upload).toBe(false);
        expect(articleSnapshot.title).toBe("Embassy film night");
        expect(evidenceAssets).toEqual([{ assetId: "asset-poster", role: "poster" }]);
        return {
          kind: "drafts",
          runId: "pipeline-e2e",
          eventDrafts: [eventDraft("draft-1")],
          evidenceAssets: [],
          failures: [],
        };
      },
      resolveDedupe: async ({ eventDraft }) => {
        calls.push("dedupe");
        return { action: "new", eventDraftId: eventDraft.payload.draftId };
      },
      decidePublish: async ({ dedupeDecision }) => {
        calls.push("publish");
        return { state: "needs_review", reasons: [dedupeDecision.action] };
      },
      ingest: async ({ sourceRun, articleSnapshots, evidenceAssets, extractionResults }) => {
        calls.push("ingest");
        return {
          sourceRunId: sourceRun.runId,
          uploadedArticleSnapshotIds: articleSnapshots.map((item) => item.payload.contentHash),
          uploadedEvidenceAssetCount: evidenceAssets.length,
          uploadedEventDraftCount: extractionResults[0].eventDrafts.length,
        };
      },
    });

    expect(calls).toEqual([
      "capture",
      "evidence",
      "extract",
      "dedupe",
      "publish",
      "ingest",
    ]);
    expect(report).toMatchObject({
      kind: "uploaded",
      status: "success",
      runId: "pipeline-e2e",
      sourceUrl: "https://mp.weixin.qq.com/s/e2e",
      articleTitle: "Embassy film night",
      sourceHealth: { ok: true },
      stageStatuses: {
        capture: "success",
        evidence: "success",
        extraction: "success",
        dedupe: "success",
        publish_policy: "success",
        ingest: "success",
        cleanup: "success",
      },
      ingest: {
        sourceRunId: "pipeline-e2e",
        uploadedEventDraftCount: 1,
      },
    });
    expect(report.dedupeDecisions).toEqual([
      { action: "new", eventDraftId: "draft-1" },
    ]);
    expect(report.publishDecisions).toEqual([
      { state: "needs_review", reasons: ["new"] },
    ]);
    expect(report.failures).toEqual([]);
  });

  it("surfaces capture blocked as source health and skips downstream stages", async () => {
    const report = await runArticlePipelineOnce({
      runId: "capture-blocked",
      sourceUrl: "https://mp.weixin.qq.com/s/blocked",
      now,
      capture: async () => ({
        ok: false,
        failure: {
          stage: "page_fetch",
          reason: "fetch_blocked",
          message: "source returned 429",
          retryable: true,
          sourceUrl: "https://mp.weixin.qq.com/s/blocked",
          diagnostics: [{ key: "status", value: "429" }],
        },
      }),
      extractEvidence: async () => {
        throw new Error("evidence_should_not_run");
      },
    });

    expect(report).toMatchObject({
      kind: "failed",
      status: "failed",
      sourceHealth: {
        ok: false,
        failureReason: "fetch_blocked",
      },
      stageStatuses: {
        capture: "failed",
        cleanup: "success",
      },
    });
    expect(report.failures).toEqual([
      expect.objectContaining({
        stage: "page_fetch",
        reason: "fetch_blocked",
        message: "source returned 429",
        diagnostics: [{ key: "status", value: "429" }],
      }),
    ]);
  });

  it("reports schema parse failures from extraction output", async () => {
    const report = await runArticlePipelineOnce({
      env: { COLLECTOR_ID: "collector-test" },
      runId: "schema-failed",
      sourceUrl: "https://mp.weixin.qq.com/s/schema",
      now,
      capture: async () => ({ ok: true, bundle: articleBundle() }),
      extractEvents: async () => ({
        kind: "failed",
        runId: "schema-failed",
        eventDrafts: [],
        evidenceAssets: [],
        failures: [
          {
            collectorId: "collector-test",
            runId: "schema-failed",
            observedAt: now.toISOString(),
            payloadVersion: "2026-05-collector-v1",
            payload: {
              articleUrl: "https://mp.weixin.qq.com/s/e2e",
              stage: "llm_parse",
              reason: "agent_response_invalid_schema",
              message: "missing events array",
              retryable: true,
            },
          },
        ],
      }),
    });

    expect(report).toMatchObject({
      kind: "failed",
      status: "failed",
      stageStatuses: {
        capture: "success",
        evidence: "success",
        extraction: "failed",
        cleanup: "success",
      },
    });
    expect(report.failures).toContainEqual(
      expect.objectContaining({
        stage: "llm_parse",
        reason: "agent_response_invalid_schema",
      }),
    );
  });

  it("reports storage failure and keeps it in the run report", async () => {
    const report = await runArticlePipelineOnce({
      runId: "storage-failed",
      sourceUrl: "https://mp.weixin.qq.com/s/storage",
      now,
      capture: async () => ({ ok: true, bundle: articleBundle() }),
      extractEvidence: async () => ({
        version: "evidence-set-v1",
        evidenceAssets: [{ assetId: "asset-poster", role: "poster" }],
      }),
      storeEvidenceAssets: async () => {
        throw Object.assign(new Error("blob write failed"), {
          reason: "storage_failed",
          retryable: true,
        });
      },
    });

    expect(report).toMatchObject({
      kind: "failed",
      status: "failed",
      stageStatuses: {
        capture: "success",
        evidence: "success",
        storage: "failed",
        cleanup: "success",
      },
    });
    expect(report.failures).toContainEqual(
      expect.objectContaining({
        stage: "storage",
        reason: "storage_failed",
        message: "blob write failed",
      }),
    );
  });

  it("routes duplicate decisions without ingesting duplicate drafts by default", async () => {
    const ingestCalls = [];
    const report = await runArticlePipelineOnce({
      runId: "duplicate",
      sourceUrl: "https://mp.weixin.qq.com/s/duplicate",
      now,
      capture: async () => ({ ok: true, bundle: articleBundle() }),
      extractEvents: async () => ({
        kind: "drafts",
        runId: "duplicate",
        eventDrafts: [eventDraft("draft-duplicate")],
        evidenceAssets: [],
        failures: [],
      }),
      resolveDedupe: async () => ({ action: "same", canonicalEventId: "event-1" }),
      decidePublish: async () => ({ state: "blocked", reasons: ["duplicate_same_event"] }),
      ingest: async () => {
        ingestCalls.push("ingest");
        return {};
      },
    });

    expect(ingestCalls).toEqual([]);
    expect(report).toMatchObject({
      kind: "duplicate",
      status: "success",
      stageStatuses: {
        dedupe: "success",
        publish_policy: "success",
        ingest: "skipped",
        cleanup: "success",
      },
    });
    expect(report.dedupeDecisions).toEqual([
      { action: "same", canonicalEventId: "event-1" },
    ]);
    expect(report.publishDecisions).toEqual([
      { state: "blocked", reasons: ["duplicate_same_event"] },
    ]);
  });

  it("runs cleanup in finally after extraction errors", async () => {
    const calls = [];
    const report = await runArticlePipelineOnce({
      runId: "cleanup",
      sourceUrl: "https://mp.weixin.qq.com/s/cleanup",
      now,
      capture: async () => {
        calls.push("capture");
        return { ok: true, bundle: articleBundle() };
      },
      extractEvents: async () => {
        calls.push("extract");
        throw Object.assign(new Error("provider exploded"), {
          reason: "agent_request_failed",
          retryable: true,
        });
      },
      cleanup: async () => {
        calls.push("cleanup");
      },
    });

    expect(calls).toEqual(["capture", "extract", "cleanup"]);
    expect(report).toMatchObject({
      kind: "failed",
      status: "failed",
      stageStatuses: {
        extraction: "failed",
        cleanup: "success",
      },
    });
    expect(report.failures).toContainEqual(
      expect.objectContaining({
        stage: "extraction",
        reason: "agent_request_failed",
        message: "provider exploded",
      }),
    );
  });
});

function articleBundle() {
  return createCapturedArticleBundle({
    provider: "url_browser",
    sourceUrl: "https://mp.weixin.qq.com/s/e2e",
    canonicalUrl: "https://mp.weixin.qq.com/s/e2e",
    finalUrl: "https://mp.weixin.qq.com/s/e2e",
    title: "Embassy film night",
    authorName: "Embassy Cultural Office",
    capturedAt: now.toISOString(),
    text: "Embassy film night\nJune 10, 2026 19:00\nRegistration required",
    images: [
      {
        id: "poster",
        sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
        role: "poster",
      },
    ],
  });
}

function eventDraft(draftId) {
  return {
    collectorId: "collector-test",
    runId: "pipeline-e2e",
    observedAt: now.toISOString(),
    payloadVersion: "2026-05-collector-v1",
    payload: {
      draftId,
      articleUrl: "https://mp.weixin.qq.com/s/e2e",
      title: "Embassy film night",
      startsAt: "2026-06-10T19:00:00+08:00",
      venueName: "Embassy Cultural Office",
      confidence: 0.9,
    },
  };
}