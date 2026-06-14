import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAgentAuditPacket,
  inspectAgentEvent,
  inspectAgentFinding,
  inspectAgentSource,
  readAgentAuditPacket,
  writeAgentAuditPacket,
} from "./agent-audit.mjs";

describe("agent audit packet", () => {
  it("builds deterministic facts, candidates, public snapshot, and usage summary", async () => {
    const packet = await buildAgentAuditPacket({
      store: createAuditStore(),
      days: 7,
      monthlyBudgetCny: 1,
      outputDir: ".agent-runs/test-audit",
      now: new Date("2026-06-11T10:00:00.000Z"),
    });

    expect(packet.auditFacts).toMatchObject({
      kind: "agent_audit_facts",
      runId: "agent-audit-20260611100000",
      window: {
        days: 7,
        startsAt: "2026-06-04T10:00:00.000Z",
        endsAt: "2026-06-11T10:00:00.000Z",
      },
      pipelineFunnel: {
        byDataClass: {
          production: expect.objectContaining({
            totalLedgerCount: 4,
            publishedCount: 2,
            needsReviewCount: 1,
            failedCount: 1,
          }),
        },
      },
      publicVisibility: {
        gapEventIds: ["event-hidden"],
      },
    });
    expect(packet.auditFacts.sourceHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "source-a",
          sourceName: "Culture Source A",
        }),
      ]),
    );
    expect(packet.publicSnapshot).toMatchObject({
      kind: "agent_public_snapshot",
      counts: {
        publishedRows: 3,
        publicRenderableRows: 3,
        missingPosterCount: 3,
        missingRegistrationQrCount: 2,
      },
    });
    expect(packet.usageSummary).toMatchObject({
      kind: "agent_usage_summary",
      budget: {
        overWindowBudget: true,
      },
      totals: {
        requestCount: 2,
        errorCount: 1,
        totalTokens: 1400,
        costMicroCny: 2_000_000,
      },
    });
    expect(packet.auditFacts.feedback.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feedbackId: "feedback-eval-1",
          dataClass: "eval",
          evalRunId: "eval-run-1",
          caseId: "case-news-1",
        }),
      ]),
    );
    const candidateTypes = packet.candidateIndex.candidates.map((candidate) => candidate.candidateType);
    expect(candidateTypes).toEqual(expect.arrayContaining([
      "funnel_drop",
      "possible_duplicate_cluster",
      "missing_evidence_assets",
      "provider_error_cluster",
      "public_visibility_gap",
      "usage_spike",
      "review_backlog",
      "review_exception_contract_gap",
      "likely_editor_false_negative",
    ]));
    expect(packet.candidateIndex.candidates[0]).toMatchObject({
      candidateId: "finding-001",
      severityHint: expect.any(String),
      drilldownCommand: expect.stringContaining("pnpm agent:inspect-finding"),
    });
    expect(packet.candidateIndex.candidates[0].drilldownCommand).toContain(
      "--audit-dir .agent-runs/test-audit",
    );
    expect(packet.candidateIndex.candidates[0]).not.toHaveProperty("rootCause");
    expect(packet.auditBrief).toContain("These candidates are not final root causes");
  });

  it("writes audit artifacts and creates drilldown evidence packs from them", async () => {
    const auditDir = await mkdtemp(path.join(os.tmpdir(), "agent-audit-"));
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "agent-evidence-"));
    try {
      const packet = await buildAgentAuditPacket({
        store: createAuditStore(),
        days: 7,
        outputDir: auditDir,
        now: new Date("2026-06-11T10:00:00.000Z"),
      });
      const paths = await writeAgentAuditPacket({ packet, outputDir: auditDir });
      expect(Object.keys(paths)).toEqual(expect.arrayContaining([
        "auditFactsPath",
        "candidateIndexPath",
        "publicSnapshotPath",
        "usageSummaryPath",
        "auditBriefPath",
      ]));

      const reread = await readAgentAuditPacket(auditDir);
      const providerError = reread.candidateIndex.candidates.find((candidate) => {
        return candidate.candidateType === "provider_error_cluster";
      });
      const findingEvidence = await inspectAgentFinding({
        findingId: providerError.candidateId,
        auditDir,
        outputDir: evidenceDir,
        now: new Date("2026-06-11T10:10:00.000Z"),
      });
      expect(findingEvidence).toMatchObject({
        kind: "agent_audit_finding_evidence",
        findingId: providerError.candidateId,
        candidate: {
          candidateType: "provider_error_cluster",
        },
        usageRecords: [
          expect.objectContaining({
            status: "failed",
            responseArtifactPath: "eval-artifacts/production/run-failed/response.json",
          }),
        ],
      });
      expect(findingEvidence.llmArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            artifactPath: "eval-artifacts/production/run-failed/response.json",
          }),
        ]),
      );
      expect(findingEvidence.sourceBundle).toMatchObject({
        articleBundles: [
          expect.objectContaining({
            articleBundleId: "bundle-failed",
            storageBucket: "article-bundles",
          }),
        ],
      });
      expect(JSON.parse(await readFile(findingEvidence.evidencePath, "utf8"))).toMatchObject({
        kind: "agent_audit_finding_evidence",
      });

      const eventEvidence = await inspectAgentEvent({
        eventId: "event-duplicate",
        auditDir,
        outputDir: evidenceDir,
      });
      expect(eventEvidence.dbRows.publicEvents).toEqual([
        expect.objectContaining({ eventId: "event-duplicate" }),
      ]);

      const sourceEvidence = await inspectAgentSource({
        sourceId: "source-a",
        auditDir,
        outputDir: evidenceDir,
      });
      expect(sourceEvidence.dbRows.processingLedger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceId: "source-a" }),
        ]),
      );
    } finally {
      await rm(auditDir, { recursive: true, force: true });
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });
});

function createAuditStore() {
  const data = auditData();
  return {
    async listProcessingLedger({ dataClass }) {
      return data.processingLedger.filter((row) => row.dataClass === dataClass);
    },
    async listPipelineRuns({ dataClass }) {
      return data.pipelineRuns.filter((row) => row.dataClass === dataClass);
    },
    async listEventDrafts({ dataClass }) {
      return data.eventDrafts.filter((row) => row.dataClass === dataClass);
    },
    async listPublicEvents({ dataClass }) {
      return data.publicEvents.filter((row) => row.dataClass === dataClass);
    },
    async listFeedback({ dataClass }) {
      return data.feedback.filter((row) => (row.dataClass ?? row.data_class) === dataClass);
    },
    async listLlmUsage({ dataClass }) {
      return data.llmUsage.filter((row) => row.dataClass === dataClass);
    },
    async listSourceChannels({ dataClass }) {
      return data.sourceChannels.filter((row) => row.dataClass === dataClass);
    },
    async listSourceRuns({ dataClass }) {
      return data.sourceRuns.filter((row) => row.dataClass === dataClass);
    },
    async listCollectorFailures({ dataClass }) {
      return data.collectorFailures.filter((row) => row.dataClass === dataClass);
    },
    async listArticleBundles({ dataClass }) {
      return data.articleBundles.filter((row) => row.dataClass === dataClass);
    },
  };
}

function auditData() {
  return {
    sourceChannels: [
      {
        sourceId: "source-a",
        dataClass: "production",
        sourceProvider: "wechat2rss",
        sourceName: "Culture Source A",
        sourceUrl: "https://mp.weixin.qq.com/source-a",
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ],
    sourceRuns: [
      {
        runId: "source-run-1",
        sourceId: "source-c",
        dataClass: "production",
        status: "failed",
        startedAt: "2026-06-10T13:00:00.000Z",
        articleCount: 0,
        failureCount: 1,
        failureReason: "provider_error",
      },
    ],
    collectorFailures: [
      {
        failureId: "failure-1",
        sourceId: "source-c",
        dataClass: "production",
        stage: "analysis",
        reason: "provider_error",
        message: "provider rejected request",
        createdAt: "2026-06-10T13:01:00.000Z",
      },
    ],
    articleBundles: [
      {
        articleBundleId: "bundle-failed",
        dataClass: "production",
        sourceId: "source-c",
        sourceUrl: "https://mp.weixin.qq.com/s/fail",
        canonicalUrl: "https://mp.weixin.qq.com/s/fail",
        capturedAt: "2026-06-10T12:59:00.000Z",
        contentHash: "hash-failed",
        storageBucket: "article-bundles",
        storagePrefix: "article-bundles/production/bundle-failed",
        imageCount: 3,
        linkCount: 1,
      },
    ],
    processingLedger: [
      {
        ledgerId: "ledger-published",
        dataClass: "production",
        sourceId: "source-a",
        sourceUrl: "https://mp.weixin.qq.com/s/a",
        articleBundleId: "bundle-a",
        state: "published",
        canonicalEventId: "event-a",
        createdAt: "2026-06-10T10:00:00.000Z",
      },
      {
        ledgerId: "ledger-hidden",
        dataClass: "production",
        sourceId: "source-a",
        sourceUrl: "https://mp.weixin.qq.com/s/hidden",
        articleBundleId: "bundle-hidden",
        state: "published",
        canonicalEventId: "event-hidden",
        createdAt: "2026-06-10T11:00:00.000Z",
      },
      {
        ledgerId: "ledger-review",
        dataClass: "production",
        sourceId: "source-b",
        sourceUrl: "https://mp.weixin.qq.com/s/review",
        articleBundleId: "bundle-review",
        state: "needs_review",
        draftId: "draft-review",
        createdAt: "2026-06-10T12:00:00.000Z",
      },
      {
        ledgerId: "ledger-failed",
        dataClass: "production",
        sourceId: "source-c",
        sourceUrl: "https://mp.weixin.qq.com/s/fail",
        articleBundleId: "bundle-failed",
        state: "failed",
        errorDetails: { code: "provider_400" },
        createdAt: "2026-06-10T13:00:00.000Z",
      },
    ],
    pipelineRuns: [
      {
        runId: "run-failed",
        dataClass: "production",
        sourceId: "source-c",
        articleBundleId: "bundle-failed",
        status: "failed",
        startedAt: "2026-06-10T13:00:00.000Z",
        steps: [
          {
            stepId: "step-extract",
            nodeName: "full_extract",
            status: "failed",
            errorDetails: { code: "provider_400" },
          },
        ],
        artifacts: [
          {
            artifactId: "artifact-request",
            path: "eval-artifacts/production/run-failed/request.json",
            kind: "full_extract_request",
            bucket: "eval-artifacts",
          },
          {
            artifactId: "artifact-response",
            path: "eval-artifacts/production/run-failed/response.json",
            kind: "full_extract_raw_response",
            bucket: "eval-artifacts",
          },
        ],
      },
    ],
    eventDrafts: [
      {
        draftId: "draft-review",
        dataClass: "production",
        articleBundleId: "bundle-review",
        sourceId: "source-b",
        title: "Needs review event",
        organizer: "Culture Source B",
        startsAt: "2026-06-20T10:00:00.000Z",
        venueName: "Cultural Center",
        triageDecision: "possible_public_activity",
        publicEligibility: "public",
        eventKind: "single",
        scheduleKind: "single",
        confidence: 0.95,
        processingState: "draft",
        reviewState: "needs_review",
        createdAt: "2026-06-10T12:00:00.000Z",
      },
    ],
    publicEvents: [
      {
        eventId: "event-a",
        dataClass: "production",
        title: "Beijing Beer Festival",
        startsAt: "2026-06-20T10:00:00.000Z",
        venueName: "Taproom",
        reservationStatus: "required",
        registrationUrl: "https://example.com/register",
        sourceUrl: "https://mp.weixin.qq.com/s/a",
        status: "published",
        publicEligibility: "public",
        eventKind: "single",
      },
      {
        eventId: "event-duplicate",
        dataClass: "production",
        title: "Beijing Beer Festival",
        startsAt: "2026-06-20T10:00:00.000Z",
        venueName: "Taproom",
        reservationStatus: "required",
        sourceUrl: "https://mp.weixin.qq.com/s/dup",
        status: "published",
        publicEligibility: "public",
        eventKind: "single",
      },
      {
        eventId: "event-unsupported-kind",
        dataClass: "production",
        title: "World Cup Viewing Party",
        startsAt: "2026-06-19T09:00:00.000Z",
        venueName: "Gran Moji",
        reservationStatus: "not_required",
        sourceUrl: "https://mp.weixin.qq.com/s/world-cup",
        status: "published",
        publicEligibility: "public",
        eventKind: "unsupported",
      },
    ],
    feedback: [
      {
        feedbackId: "feedback-1",
        dataClass: "production",
        feedbackType: "missing_qr",
        eventId: "event-a",
        status: "open",
        createdBy: "operator",
        createdAt: "2026-06-10T14:00:00.000Z",
      },
      {
        feedback_id: "feedback-eval-1",
        data_class: "eval",
        feedback_type: "not_event",
        eval_run_id: "eval-run-1",
        case_id: "case-news-1",
        event_id: "event-eval-1",
        status: "open",
        created_by: "operator",
        created_at: "2026-06-10T14:05:00.000Z",
      },
    ],
    llmUsage: [
      {
        usageId: "usage-failed",
        dataClass: "production",
        recordedAt: "2026-06-10T13:00:00.000Z",
        operation: "full_extract",
        provider: "aliyun",
        model: "qwen3-vl-plus",
        status: "failed",
        errorCode: "provider_400",
        articleBundleId: "bundle-failed",
        sourceId: "source-c",
        responseArtifactPath: "eval-artifacts/production/run-failed/response.json",
        totalTokens: 400,
        costMicroCny: 500_000,
      },
      {
        usageId: "usage-ok",
        dataClass: "production",
        recordedAt: "2026-06-10T10:00:00.000Z",
        operation: "editor_pass",
        provider: "aliyun",
        model: "qwen3-vl-plus",
        status: "succeeded",
        articleBundleId: "bundle-a",
        sourceId: "source-a",
        totalTokens: 1000,
        costMicroCny: 1_500_000,
      },
    ],
  };
}
