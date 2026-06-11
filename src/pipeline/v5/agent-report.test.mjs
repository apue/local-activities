import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  generateAgentAuditReport,
  writeAgentAuditReport,
} from "./agent-report.mjs";

describe("agent audit report", () => {
  it("summarizes audit, eval, and finding artifacts into action-oriented reports", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "agent-report-"));
    const auditDir = path.join(rootDir, "audit");
    const outputDir = path.join(rootDir, "report");
    const evalSummaryPath = path.join(rootDir, "eval", "summary.json");
    const comparisonPath = path.join(rootDir, "eval", "comparison.json");
    const findingPath = path.join(rootDir, "evidence", "finding-001.json");
    try {
      await writeJson(path.join(auditDir, "audit-facts.json"), fakeAuditFacts());
      await writeJson(path.join(auditDir, "candidate-index.json"), fakeCandidateIndex());
      await writeJson(path.join(auditDir, "public-snapshot.json"), fakePublicSnapshot());
      await writeJson(path.join(auditDir, "usage-summary.json"), fakeUsageSummary());
      await writeFile(path.join(auditDir, "audit-brief.md"), "Existing brief");
      await writeJson(evalSummaryPath, fakeEvalSummary());
      await writeJson(comparisonPath, fakeComparison());
      await writeJson(findingPath, fakeFindingEvidence());

      const { report, paths } = await generateAgentAuditReport({
        auditDir,
        evalSummaryPath,
        comparisonPath,
        findingPaths: [findingPath],
        outputDir,
        now: new Date("2026-06-11T12:00:00.000Z"),
      });

      expect(report).toMatchObject({
        kind: "agent_audit_report",
        generatedAt: "2026-06-11T12:00:00.000Z",
        summary: {
          status: "attention_needed",
          candidateCount: 2,
          highSeverityCount: 1,
          evalFailCount: 1,
          openFeedbackCount: 1,
        },
        suspectedAreas: expect.arrayContaining([
          expect.objectContaining({
            module: "model-provider/live-harness",
            uncertainty: "medium",
          }),
          expect.objectContaining({
            module: "storage/evidence-assets",
            uncertainty: "medium",
          }),
          expect.objectContaining({
            module: "prompt-model-config/eval-gates",
            uncertainty: "low",
          }),
        ]),
        nextActions: expect.arrayContaining([
          expect.objectContaining({
            priority: "high",
            suspectedModule: "model-provider/live-harness",
            evidenceLinks: expect.arrayContaining([
              expect.objectContaining({ path: findingPath }),
            ]),
          }),
          expect.objectContaining({
            title: "Do not activate candidate config until eval gates pass",
            suspectedModule: "prompt-model-config/eval-gates",
          }),
        ]),
      });
      expect(report.evidenceLinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "audit facts" }),
          expect.objectContaining({ label: "eval summary", path: evalSummaryPath }),
          expect.objectContaining({ label: "eval comparison", path: comparisonPath }),
          expect.objectContaining({ label: "finding evidence", path: findingPath }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("do not inline raw response");
      expect(paths).toEqual({
        jsonPath: path.join(outputDir, "agent-report.json"),
        markdownPath: path.join(outputDir, "agent-report.md"),
      });

      const markdown = await readFile(paths.markdownPath, "utf8");
      expect(markdown).toContain("# Agent Audit Report");
      expect(markdown).toContain("finding-001");
      expect(markdown).toContain("model-provider/live-harness");
      expect(markdown).toContain("pnpm agent:inspect-finding");
      expect(markdown).not.toContain("do not inline raw response");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("writes a provided report without needing live services", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "agent-report-write-"));
    try {
      const paths = await writeAgentAuditReport({
        outputDir,
        report: {
          kind: "agent_audit_report",
          generatedAt: "2026-06-11T12:00:00.000Z",
          summary: { status: "ok" },
          nextActions: [],
          evidenceLinks: [],
          suspectedAreas: [],
          markdown: "# Agent Audit Report\n\nNo action.",
        },
      });

      expect(JSON.parse(await readFile(paths.jsonPath, "utf8"))).toMatchObject({
        kind: "agent_audit_report",
        summary: { status: "ok" },
      });
      expect(await readFile(paths.markdownPath, "utf8")).toContain("No action.");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeAuditFacts() {
  return {
    kind: "agent_audit_facts",
    runId: "agent-audit-1",
    generatedAt: "2026-06-11T10:00:00.000Z",
    window: {
      days: 7,
      startsAt: "2026-06-04T10:00:00.000Z",
      endsAt: "2026-06-11T10:00:00.000Z",
    },
    pipelineFunnel: {
      byDataClass: {
        production: {
          totalLedgerCount: 4,
          publishedCount: 1,
          needsReviewCount: 1,
          excludedCount: 1,
          failedCount: 1,
        },
      },
    },
    feedback: {
      totalCount: 2,
      openCount: 1,
      byType: {
        missing_qr: 1,
        not_event: 1,
      },
    },
  };
}

function fakeCandidateIndex() {
  return {
    kind: "agent_candidate_index",
    runId: "agent-audit-1",
    candidates: [
      {
        candidateId: "finding-001",
        candidateType: "provider_error_cluster",
        severityHint: "high",
        reason: "Two full_extract provider calls failed.",
        signals: {
          provider: "dashscope",
          model: "qwen3-vl-plus",
          failedCount: 2,
        },
        drilldownCommand:
          "pnpm agent:inspect-finding -- --finding-id finding-001 --audit-dir .agent-runs/audit",
      },
      {
        candidateId: "finding-002",
        candidateType: "missing_evidence_assets",
        severityHint: "medium",
        reason: "Published events are missing poster or QR assets.",
        affectedEventIds: ["event-1"],
        drilldownCommand:
          "pnpm agent:inspect-finding -- --finding-id finding-002 --audit-dir .agent-runs/audit",
      },
    ],
  };
}

function fakePublicSnapshot() {
  return {
    kind: "agent_public_snapshot",
    counts: {
      publishedRows: 2,
      publicRenderableRows: 1,
      missingPosterCount: 1,
      missingRegistrationQrCount: 1,
    },
  };
}

function fakeUsageSummary() {
  return {
    kind: "agent_usage_summary",
    totals: {
      requestCount: 4,
      errorCount: 1,
      costMicroCny: 250_000,
    },
    budget: {
      overWindowBudget: false,
    },
    recentFailures: [
      {
        id: "usage-1",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        operation: "full_extract",
        status: "failed",
        responseArtifactPath: "runs/eval/live/full_extract/raw.json",
      },
    ],
  };
}

function fakeEvalSummary() {
  return {
    ok: false,
    runId: "v5-eval-1",
    corpusVersion: "event-pipeline-regression-corpus-v1",
    caseCount: 3,
    runCount: 3,
    passCount: 2,
    failCount: 1,
    falsePositiveCount: 1,
    falseNegativeCount: 0,
    actionAccuracy: 0.66,
    finalStateAccuracy: 0.66,
    artifactPaths: ["runs/v5-eval-1/summary.json", "runs/v5-eval-1/cases/bad.json"],
  };
}

function fakeComparison() {
  return {
    kind: "v5_baseline_candidate_eval_comparison",
    runId: "v5-eval-1",
    recommended: false,
    recommendation: {
      status: "not_recommended",
      failedGates: ["false_positive_rate"],
      reasons: ["Candidate false positive rate is too high."],
    },
    gates: [
      {
        name: "false_positive_rate",
        passed: false,
        reason: "Candidate false positive rate is too high.",
      },
    ],
    artifactPaths: ["runs/v5-eval-1/comparison.json"],
  };
}

function fakeFindingEvidence() {
  return {
    kind: "agent_audit_finding_evidence",
    findingId: "finding-001",
    generatedAt: "2026-06-11T10:05:00.000Z",
    evidencePath: "evidence/finding-001.json",
    candidate: {
      candidateType: "provider_error_cluster",
    },
    usageRecords: [
      {
        provider: "dashscope",
        model: "qwen3-vl-plus",
        responseArtifactPath: "runs/eval/live/full_extract/raw.json",
      },
    ],
    rawResponse: "do not inline raw response",
  };
}
