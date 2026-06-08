import {
  articleBundleToArticleSnapshot,
  validateCapturedArticleBundle,
} from "../../capture/article-bundle.mjs";
import { extractEvidenceFromArticleBundle } from "../evidence/extractor.mjs";

const collectorPayloadVersion = "2026-05-collector-v1";
const duplicateActionsSkippedByDefault = new Set([
  "same",
  "same_event",
  "reject",
]);

export async function runArticlePipelineOnce({
  env = process.env,
  sourceUrl,
  now = new Date(),
  runId = createRunId(now),
  fetchImpl = fetch,
  upload = false,
  capture,
  extractEvidence = defaultExtractEvidence,
  storeEvidenceAssets,
  extractEvents = defaultExtractEvents,
  resolveDedupe = defaultResolveDedupe,
  decidePublish = defaultDecidePublish,
  ingest,
  cleanup,
}) {
  if (!sourceUrl) throw new Error("pipeline_source_url_required");
  if (typeof capture !== "function") throw new Error("pipeline_capture_required");
  if (upload) throw new Error("pipeline_upload_removed_use_supabase_edge_analysis");

  const observedAt = now.toISOString();
  const report = {
    kind: "failed",
    status: "failed",
    runId,
    sourceUrl,
    observedAt,
    stages: [],
    stageStatuses: {},
    sourceHealth: { ok: true },
    failures: [],
    dedupeDecisions: [],
    publishDecisions: [],
  };

  let bundle;
  let articleSnapshot;
  let evidenceSet;
  let sourceEvidenceAssets = [];
  let extraction;

  try {
    const captureResult = await runStage(report, "capture", async () =>
      capture({ env, sourceUrl, runId, now, fetchImpl }),
    );
    report.captureResult = captureResult;

    if (!captureResult?.ok) {
      const failure = normalizeFailure({
        stage: captureResult?.failure?.stage ?? "capture",
        reason: captureResult?.failure?.reason ?? "fetch_blocked",
        message: captureResult?.failure?.message ?? "Capture failed.",
        retryable: captureResult?.failure?.retryable ?? true,
        sourceUrl,
        diagnostics: captureResult?.failure?.diagnostics ?? [],
      });
      report.sourceHealth = {
        ok: false,
        failureReason: failure.reason,
        diagnostics: failure.diagnostics,
      };
      addFailure(report, failure);
      markStageFailed(report, "capture", failure);
      report.extraction = captureFailureExtraction({
        env,
        runId,
        observedAt,
        sourceUrl,
        failure,
      });
      finishReport(report);
      return report;
    }

    bundle = captureResult.bundle;
    validateCapturedArticleBundle(bundle);
    report.articleBundle = bundle;
    report.articleTitle = bundle.title;
    articleSnapshot = articleBundleToArticleSnapshot(bundle);
    report.articleSnapshot = articleSnapshot;

    evidenceSet = await runStage(report, "evidence", async () =>
      extractEvidence({ env, bundle, runId, now, fetchImpl }),
    );
    report.evidenceSet = evidenceSet;
    sourceEvidenceAssets = evidenceSet?.evidenceAssets ?? [];

    if (storeEvidenceAssets) {
      sourceEvidenceAssets = await runStage(report, "storage", async () =>
        storeEvidenceAssets({
          env,
          bundle,
          evidenceSet,
          evidenceAssets: sourceEvidenceAssets,
          runId,
          now,
          fetchImpl,
        }),
      );
    }
    articleSnapshot = {
      ...articleSnapshot,
      evidenceAssetIds: sourceEvidenceAssets
        .map((asset) => asset.assetId)
        .filter(Boolean),
    };
    report.articleSnapshot = articleSnapshot;
    report.sourceEvidenceAssets = sourceEvidenceAssets;

    extraction = await runStage(report, "extraction", async () =>
      extractEvents({
        env,
        bundle,
        evidenceSet: {
          ...evidenceSet,
          evidenceAssets: sourceEvidenceAssets,
        },
        articleSnapshot,
        evidenceAssets: sourceEvidenceAssets,
        runId,
        now,
        fetchImpl,
        upload: false,
      }),
    );
    report.extraction = extraction;
    addExtractionFailures(report, extraction);
    if (extraction?.kind === "failed" || extractionFailureCount(extraction) > 0) {
      markStageFailed(report, "extraction");
      finishReport(report);
      return report;
    }

    const eventDrafts = extraction?.eventDrafts ?? [];
    for (const eventDraft of eventDrafts) {
      const dedupeDecision = await resolveDedupe({
        env,
        eventDraft,
        articleSnapshot,
        evidenceSet,
        runId,
        now,
      });
      report.dedupeDecisions.push(dedupeDecision);
    }
    markStage(report, "dedupe", "success", {
      decisionCount: report.dedupeDecisions.length,
    });

    for (let index = 0; index < eventDrafts.length; index += 1) {
      const publishDecision = await decidePublish({
        env,
        eventDraft: eventDrafts[index],
        dedupeDecision: report.dedupeDecisions[index],
        articleSnapshot,
        evidenceSet,
        runId,
        now,
      });
      report.publishDecisions.push(publishDecision);
    }
    markStage(report, "publish_policy", "success", {
      decisionCount: report.publishDecisions.length,
    });

    const shouldSkipIngest = report.dedupeDecisions.some((decision) =>
      duplicateActionsSkippedByDefault.has(dedupeDecisionKind(decision)),
    );
    if (shouldSkipIngest) {
      markStage(report, "ingest", "skipped", { reason: "duplicate_decision" });
      finishReport(report);
      report.kind = "duplicate";
      report.status = "success";
      return report;
    }

    if (ingest) {
      const sourceRun = sourceRunEnvelope({
        collectorId: collectorIdFromEnv(env),
        runId,
        observedAt,
        payload: sourceRunPayload({
          status: "success",
          sourceUrl,
          observedAt,
          articleCount: bundle ? 1 : 0,
          draftCount: eventDrafts.length,
          failureCount: extractionFailureCount(extraction),
        }),
      });
      const articleSnapshots = [
        envelope({
          collectorId: collectorIdFromEnv(env),
          runId,
          observedAt,
          payload: articleSnapshot,
        }),
      ];
      const evidenceAssets = sourceEvidenceAssets.map((payload) =>
        envelope({
          collectorId: collectorIdFromEnv(env),
          runId,
          observedAt,
          payload,
        }),
      );
      const ingestResult = await runStage(report, "ingest", async () =>
        ingest({
          env,
          fetchImpl,
          sourceRun,
          articleSnapshots,
          evidenceAssets,
          extractionResults: extraction ? [extraction] : [],
          runId,
          now,
        }),
      );
      report.ingest = ingestResult;
      finishReport(report);
      report.kind = "uploaded";
      report.status = "success";
      return report;
    }

    markStage(report, "ingest", "skipped", { reason: "dry_run" });
    finishReport(report);
    report.kind = "completed";
    report.status = "success";
    return report;
  } catch (error) {
    const failedStage = currentFailedStage(report);
    const failure = normalizeFailure({
      stage: failedStage,
      reason: error?.reason ?? reasonForStage(failedStage),
      message: error instanceof Error ? error.message : String(error),
      retryable: error?.retryable ?? true,
      sourceUrl,
      diagnostics: error?.diagnostics ?? [],
    });
    addFailure(report, failure);
    markStageFailed(report, failedStage, failure);
    finishReport(report);
    return report;
  } finally {
    if (cleanup) {
      try {
        await cleanup({ env, sourceUrl, runId, now, fetchImpl });
        markStage(report, "cleanup", "success");
      } catch (error) {
        const failure = normalizeFailure({
          stage: "cleanup",
          reason: "cleanup_failed",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
          sourceUrl,
          diagnostics: error?.diagnostics ?? [],
        });
        addFailure(report, failure);
        markStage(report, "cleanup", "failed", { failure });
      }
    } else {
      markStage(report, "cleanup", "success");
    }
  }
}

export function sourceRunEnvelope({ collectorId, runId, observedAt, payload }) {
  return envelope({ collectorId, runId, observedAt, payload });
}

function defaultExtractEvidence({ bundle }) {
  return extractEvidenceFromArticleBundle(bundle);
}

function defaultExtractEvents() {
  throw Object.assign(
    new Error("pipeline_extract_events_required"),
    { reason: "analysis_adapter_missing", retryable: false },
  );
}

function defaultResolveDedupe({ eventDraft }) {
  return {
    action: "new",
    eventDraftId: eventDraft?.payload?.draftId,
  };
}

function defaultDecidePublish({ dedupeDecision }) {
  const kind = dedupeDecisionKind(dedupeDecision);
  return {
    state: ["new", "new_event", "review"].includes(kind)
      ? "needs_review"
      : "blocked",
    reasons: [kind],
  };
}

function dedupeDecisionKind(decision) {
  return decision?.decision ?? decision?.action ?? "unknown";
}

async function runStage(report, stage, fn) {
  markStage(report, stage, "running");
  const value = await fn();
  markStage(report, stage, "success");
  return value;
}

function markStage(report, stage, status, details = {}) {
  report.stageStatuses[stage] = status;
  const existing = report.stages.find((item) => item.stage === stage);
  if (existing) {
    Object.assign(existing, { status }, details);
    return;
  }
  report.stages.push({ stage, status, ...details });
}

function markStageFailed(report, stage, failure) {
  markStage(report, stage, "failed", failure ? { failure } : {});
}

function currentFailedStage(report) {
  const running = [...report.stages].reverse().find((stage) => stage.status === "running");
  return running?.stage ?? "pipeline";
}

function finishReport(report) {
  report.failureCount = report.failures.length;
  if (report.failures.length > 0) {
    report.kind = "failed";
    report.status = "failed";
  }
}

function addExtractionFailures(report, extraction) {
  for (const failure of extraction?.failures ?? []) {
    addFailure(report, normalizeFailure(failure.payload ?? failure));
  }
}

function extractionFailureCount(extraction) {
  return extraction?.failures?.length ?? 0;
}

function addFailure(report, failure) {
  report.failures.push(failure);
}

function normalizeFailure({
  stage,
  reason,
  message,
  retryable = true,
  sourceUrl,
  diagnostics = [],
}) {
  return {
    stage: clean(stage) ?? "pipeline",
    reason: clean(reason) ?? "pipeline_failed",
    message: clean(message) ?? "Pipeline stage failed.",
    retryable: Boolean(retryable),
    sourceUrl: clean(sourceUrl),
    diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
  };
}

function captureFailureExtraction({ env, runId, observedAt, sourceUrl, failure }) {
  return {
    kind: "failed",
    runId,
    eventDrafts: [],
    evidenceAssets: [],
    llmUsage: [],
    failures: [
      envelope({
        collectorId: collectorIdFromEnv(env) ?? "unknown-collector",
        runId,
        observedAt,
        payload: {
          articleUrl: sourceUrl,
          stage: failure.stage,
          reason: failure.reason,
          message: failure.message,
          retryable: failure.retryable,
          diagnostics: failure.diagnostics,
        },
      }),
    ],
  };
}

function sourceRunPayload({
  status,
  sourceUrl,
  observedAt,
  articleCount,
  draftCount,
  failureCount,
}) {
  return {
    status,
    startedAt: observedAt,
    finishedAt: observedAt,
    checkedUrlCount: 1,
    articleCount,
    draftCount,
    failureCount,
    diagnostics: [{ key: "source_url", value: sourceUrl }],
  };
}

function envelope({ collectorId, runId, observedAt, payload }) {
  return {
    collectorId,
    runId,
    observedAt,
    payloadVersion: collectorPayloadVersion,
    payload,
  };
}

function collectorIdFromEnv(env) {
  return clean(env.COLLECTOR_ID) ?? "unknown-collector";
}

function reasonForStage(stage) {
  if (stage === "storage") return "storage_failed";
  if (stage === "extraction") return "analysis_request_failed";
  if (stage === "ingest") return "collector_upload_failed";
  return "pipeline_stage_failed";
}

function createRunId(now) {
  return `pipeline-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function clean(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
