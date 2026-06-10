#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCaptureFailureResult,
  validateCapturedArticleBundle,
  validateCaptureResult,
} from "../src/capture/article-bundle.mjs";
import { extractEvidenceFromArticleBundle } from "../src/collector/evidence/extractor.mjs";

export const requiredCoverageLabels = [
  "ordinary_public_event",
  "registration_required",
  "qr_registration",
  "poster_or_image_dominant",
  "mini_program_action_registration",
  "multi_event_article",
  "recurring_or_multiple_occurrences",
  "long_running_exhibition",
  "duplicate_or_update",
  "official_visit_non_public_news",
  "not_general_public",
  "generic_not_event",
  "not_beijing",
  "qr_present_not_registration",
  "information_sparse_requires_review",
  "capture_failure",
];

const manifestFileName = "manifest.json";
const successCaseFiles = ["case.json", "captured-bundle.json", "expected.json"];
const failureCaseFiles = ["case.json", "capture-result.json", "expected.json"];
const refusedTargets = new Set([
  "live_wechat",
  "live_llm",
  "hosted_supabase",
  "production",
]);

export function assertOfflineReplayTarget({ target = "offline" } = {}) {
  if (refusedTargets.has(target)) {
    throw new Error(`regression_replay_refuses_live_or_production_target:${target}`);
  }
  return true;
}

export async function loadRegressionCorpus({ corpusDir } = {}) {
  if (!corpusDir) throw new Error("regression_corpus_dir_required");
  const manifestPath = path.join(corpusDir, manifestFileName);
  const manifest = await readJson(manifestPath);
  validateManifest(manifest);

  const cases = [];
  for (const entry of manifest.cases) {
    cases.push(await loadRegressionCase({ caseId: entry.id, corpusDir, manifestEntry: entry }));
  }

  const coverageLabels = [...new Set(cases.flatMap((item) => item.case.labels ?? []))].sort();
  const manifestRequiredCoverageLabels = manifest.requiredCoverageLabels ?? requiredCoverageLabels;
  const missingCoverage = manifestRequiredCoverageLabels.filter(
    (label) => !coverageLabels.includes(label),
  );
  if (missingCoverage.length) {
    throw new Error(`regression_corpus_coverage_missing:${missingCoverage.join(",")}`);
  }

  return {
    manifest,
    cases,
    coverageLabels,
    requiredCoverageLabels: manifestRequiredCoverageLabels,
    knownCoverageGaps: manifest.knownCoverageGaps ?? [],
  };
}

export async function replayRegressionCase({
  caseId,
  corpusDir,
  target = "offline",
} = {}) {
  assertOfflineReplayTarget({ target });
  if (!caseId) throw new Error("regression_case_id_required");

  const corpus = await loadRegressionCorpus({ corpusDir });
  const item = corpus.cases.find((candidate) => candidate.case.id === caseId);
  if (!item) throw new Error(`regression_case_unknown:${caseId}`);

  return replayLoadedCase(item);
}

export async function runRegressionReplay({
  all = false,
  caseId,
  corpusDir,
  target = "offline",
} = {}) {
  assertOfflineReplayTarget({ target });
  if (!all && !caseId) throw new Error("regression_replay_case_or_all_required");

  const corpus = await loadRegressionCorpus({ corpusDir });
  const selectedCases = all
    ? corpus.cases
    : corpus.cases.filter((item) => item.case.id === caseId);
  if (!selectedCases.length) throw new Error(`regression_case_unknown:${caseId}`);

  const cases = [];
  for (const item of selectedCases) {
    cases.push(await replayLoadedCase(item));
  }

  return {
    ok: cases.every((item) => item.status === "success" || item.expectedAction === "capture_failure"),
    target,
    caseCount: cases.length,
    cases,
  };
}

export function parseRegressionReplayArgs(argv = process.argv.slice(2)) {
  const options = { target: "offline" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--all") options.all = true;
    else if (arg === "--case") options.caseId = argv[++index];
    else if (arg === "--corpus-dir") options.corpusDir = argv[++index];
    else if (arg === "--target") options.target = argv[++index];
    else throw new Error(`regression_replay_arg_unknown:${arg}`);
  }
  return options;
}

export async function runRegressionReplayCli(argv = process.argv.slice(2)) {
  const result = await runRegressionReplay(parseRegressionReplayArgs(argv));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function loadRegressionCase({ caseId, corpusDir, manifestEntry }) {
  const caseDir = path.join(corpusDir, caseId);
  const fileNames = await readdir(caseDir).catch(() => {
    throw new Error(`regression_corpus_case_dir_missing:${caseId}`);
  });
  const hasCaptureResult = fileNames.includes("capture-result.json");
  const requiredFiles = hasCaptureResult ? failureCaseFiles : successCaseFiles;
  for (const fileName of requiredFiles) {
    if (!fileNames.includes(fileName)) {
      throw new Error(`regression_corpus_file_missing:${caseId}:${fileName}`);
    }
  }

  const caseMeta = await readJson(path.join(caseDir, "case.json"));
  const expected = await readJson(path.join(caseDir, "expected.json"));
  validateCaseMeta({ caseMeta, manifestEntry, caseId });
  validateExpected({ expected, caseId });

  if (hasCaptureResult) {
    const captureResult = await readJson(path.join(caseDir, "capture-result.json"));
    validateCaptureResult(captureResult);
    if (captureResult.ok !== false) {
      throw new Error(`regression_corpus_capture_result_not_failure:${caseId}`);
    }
    return { case: caseMeta, expected, captureResult };
  }

  const bundle = await resolveCaseLocalImageAssets({
    bundle: await readJson(path.join(caseDir, "captured-bundle.json")),
    caseDir,
    caseId,
  });
  validateCapturedArticleBundle(bundle);
  return { case: caseMeta, expected, bundle };
}

async function resolveCaseLocalImageAssets({ bundle, caseDir, caseId }) {
  if (!Array.isArray(bundle.images) || bundle.images.length === 0) return bundle;
  const images = [];
  for (const image of bundle.images) {
    images.push(await resolveCaseLocalImageAsset({ image, caseDir, caseId }));
  }
  return { ...bundle, images };
}

async function resolveCaseLocalImageAsset({ image, caseDir, caseId }) {
  if (image.dataUrl || image.publicUrl) return image;
  const imagePath = String(image.path ?? "").trim();
  if (!imagePath.startsWith("assets/")) return image;
  if (path.isAbsolute(imagePath) || imagePath.split(/[\\/]+/).includes("..")) {
    throw new Error(`regression_corpus_asset_path_invalid:${caseId}:${image.id ?? imagePath}`);
  }
  const resolvedPath = path.resolve(caseDir, imagePath);
  const resolvedCaseDir = path.resolve(caseDir);
  if (!resolvedPath.startsWith(`${resolvedCaseDir}${path.sep}`)) {
    throw new Error(`regression_corpus_asset_path_invalid:${caseId}:${image.id ?? imagePath}`);
  }
  let bytes;
  try {
    bytes = await readFile(resolvedPath);
  } catch {
    throw new Error(`regression_corpus_asset_missing:${caseId}:${imagePath}`);
  }
  const contentType = image.contentType ?? contentTypeFromPath(imagePath);
  if (!contentType) {
    throw new Error(`regression_corpus_asset_content_type_required:${caseId}:${imagePath}`);
  }
  return {
    ...image,
    contentType,
    dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
  };
}

function contentTypeFromPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return undefined;
}

async function replayLoadedCase(item) {
  const expected = item.expected;
  const sourceUrl =
    item.bundle?.sourceUrl ??
    item.captureResult?.failure?.sourceUrl ??
    item.case.source?.url;
  const report = runOfflineResetReplayPipeline({
    item,
    expected,
    sourceUrl,
    runId: `regression-${item.case.id}`,
  });

  const result = summarizeReport({ item, report });
  assertExpectedReplay({ item, result });
  return result;
}

function runOfflineResetReplayPipeline({ item, expected, sourceUrl, runId }) {
  const capturedAt = "2026-06-08T00:00:00.000Z";
  const report = {
    kind: "failed",
    status: "failed",
    runId,
    sourceUrl,
    observedAt: capturedAt,
    sourceHealth: { ok: true },
    stageStatuses: {},
    failures: [],
    dedupeDecisions: [],
    publishDecisions: [],
  };

  try {
    markStage(report, "capture_contract", "success");
    const captureResult = captureResultForCase(item);
    report.captureResult = captureResult;

    if (!captureResult.ok) {
      const failure = {
        stage: captureResult.failure.stage,
        reason: captureResult.failure.reason,
        message: captureResult.failure.message,
        retryable: captureResult.failure.retryable,
        sourceUrl: captureResult.failure.sourceUrl,
        diagnostics: captureResult.failure.diagnostics ?? [],
      };
      report.sourceHealth = {
        ok: false,
        failureReason: failure.reason,
        diagnostics: failure.diagnostics,
      };
      report.failures.push(failure);
      markStage(report, "capture_contract", "failed");
      markStage(report, "offline_sink", "skipped");
      markStage(report, "cleanup", "success");
      return report;
    }

    const bundle = captureResult.bundle;
    validateCapturedArticleBundle(bundle);
    report.articleBundle = bundle;
    report.articleTitle = bundle.title;

    const evidenceSet = extractEvidenceFromArticleBundle(bundle);
    report.evidenceSet = evidenceSet;
    markStage(report, "evidence_contract", "success");

    const eventDrafts = (expected.eventDrafts ?? []).map((payload, index) =>
      eventDraftEnvelope({ payload, runId, index })
    );
    report.extraction = {
      kind: "mocked_analysis",
      runId,
      eventDrafts,
      evidenceAssets: evidenceSet.evidenceAssets ?? [],
      failures: [],
    };
    markStage(report, "mock_analysis", "success");

    report.dedupeDecisions = eventDrafts.map((eventDraft) => ({
      ...(expected.dedupe ?? { decision: "new_event" }),
      eventDraftId: eventDraft.payload.draftId,
    }));
    markStage(report, "dedupe_policy", "success");

    report.publishDecisions = eventDrafts.map(() =>
      expected.publish ?? { state: "needs_review", reasons: [] }
    );
    markStage(report, "publish_policy", "success");

    const duplicate = report.dedupeDecisions.some((decision) =>
      ["same", "same_event", "reject"].includes(decision.decision ?? decision.action)
    );
    markStage(report, "offline_sink", "skipped");
    markStage(report, "cleanup", "success");
    report.kind = duplicate ? "duplicate" : "offline_replayed";
    report.status = "success";
    return report;
  } catch (error) {
    report.failures.push({
      stage: "offline_replay",
      reason: "regression_replay_failed",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
      sourceUrl,
      diagnostics: [],
    });
    markStage(report, "offline_replay", "failed");
    markStage(report, "cleanup", "success");
    return report;
  }
}

function markStage(report, stage, status) {
  report.stageStatuses[stage] = status;
}

function captureResultForCase(item) {
  if (item.captureResult?.ok === false) {
    return createCaptureFailureResult(item.captureResult.failure);
  }
  return {
    version: "capture-result-v1",
    ok: true,
    bundle: item.bundle,
    diagnostics: [],
    captureWarnings: [],
  };
}

function summarizeReport({ item, report }) {
  const evidenceSummary = report.evidenceSet?.summary ?? {};
  return {
    caseId: item.case.id,
    expectedAction: item.expected.action,
    status: report.status,
    kind: report.kind,
    eventCount: report.extraction?.eventDrafts?.length ?? 0,
    evidenceSummary,
    sourceHealth: report.sourceHealth,
    stageStatuses: report.stageStatuses,
    dedupeDecisions: report.dedupeDecisions,
    publishDecisions: report.publishDecisions,
    failures: report.failures,
  };
}

function assertExpectedReplay({ item, result }) {
  const expected = item.expected;
  if (expected.action === "capture_failure") {
    if (result.status !== "failed") {
      throw new Error(`regression_case_expected_capture_failure:${item.case.id}`);
    }
    if (result.sourceHealth?.failureReason !== expected.sourceHealth?.failureReason) {
      throw new Error(`regression_case_source_health_mismatch:${item.case.id}`);
    }
    return;
  }

  if (result.eventCount !== expected.eventCount) {
    throw new Error(`regression_case_event_count_mismatch:${item.case.id}`);
  }
  for (const [key, value] of Object.entries(expected.evidence ?? {})) {
    if ((result.evidenceSummary?.[key] ?? 0) !== value) {
      throw new Error(`regression_case_evidence_mismatch:${item.case.id}:${key}`);
    }
  }
  const expectedDedupe = expected.dedupe?.decision;
  const actualDedupe = result.dedupeDecisions[0]?.decision ?? result.dedupeDecisions[0]?.action;
  if (expectedDedupe && expected.eventCount > 0 && actualDedupe !== expectedDedupe) {
    throw new Error(`regression_case_dedupe_mismatch:${item.case.id}`);
  }
  const expectedPublish = expected.publish?.state;
  const actualPublish = result.publishDecisions[0]?.state;
  if (expectedPublish && expected.eventCount > 0 && actualPublish !== expectedPublish) {
    throw new Error(`regression_case_publish_mismatch:${item.case.id}`);
  }
}

function validateManifest(manifest) {
  if (manifest?.version !== "event-pipeline-regression-corpus-v1") {
    throw new Error("regression_corpus_manifest_version_invalid");
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error("regression_corpus_manifest_cases_required");
  }
  const ids = new Set();
  for (const entry of manifest.cases) {
    if (!entry?.id) throw new Error("regression_corpus_manifest_case_id_required");
    if (ids.has(entry.id)) throw new Error(`regression_corpus_manifest_case_duplicate:${entry.id}`);
    ids.add(entry.id);
    if (!Array.isArray(entry.labels) || entry.labels.length === 0) {
      throw new Error(`regression_corpus_manifest_case_labels_required:${entry.id}`);
    }
  }
  if (manifest.requiredCoverageLabels !== undefined) {
    validateStringArray(
      manifest.requiredCoverageLabels,
      "regression_corpus_manifest_required_coverage_invalid",
    );
  }
  if (manifest.knownCoverageGaps !== undefined) {
    if (!Array.isArray(manifest.knownCoverageGaps)) {
      throw new Error("regression_corpus_manifest_known_gaps_invalid");
    }
    for (const gap of manifest.knownCoverageGaps) {
      if (!clean(gap?.label) || !clean(gap?.reason)) {
        throw new Error("regression_corpus_manifest_known_gap_invalid");
      }
    }
  }
}

function validateStringArray(value, errorCode) {
  if (!Array.isArray(value) || value.some((item) => !clean(item))) {
    throw new Error(errorCode);
  }
}

function validateCaseMeta({ caseMeta, manifestEntry, caseId }) {
  if (caseMeta?.id !== caseId) throw new Error(`regression_corpus_case_id_mismatch:${caseId}`);
  if (!Array.isArray(caseMeta.labels) || caseMeta.labels.length === 0) {
    throw new Error(`regression_corpus_case_labels_required:${caseId}`);
  }
  for (const label of manifestEntry.labels) {
    if (!caseMeta.labels.includes(label)) {
      throw new Error(`regression_corpus_case_manifest_label_missing:${caseId}:${label}`);
    }
  }
  if (!caseMeta.source?.type) throw new Error(`regression_corpus_case_source_required:${caseId}`);
  validateCaseEvaluationMeta({ caseMeta, caseId });
  if (!caseMeta.rationale) throw new Error(`regression_corpus_case_rationale_required:${caseId}`);
}

function validateCaseEvaluationMeta({ caseMeta, caseId }) {
  if (caseMeta.evaluation === undefined) return;
  if (!caseMeta.evaluation || typeof caseMeta.evaluation !== "object") {
    throw new Error(`regression_corpus_case_evaluation_invalid:${caseId}`);
  }
  if (
    caseMeta.evaluation.liveVisionEligible !== undefined &&
    typeof caseMeta.evaluation.liveVisionEligible !== "boolean"
  ) {
    throw new Error(`regression_corpus_case_live_vision_eligible_invalid:${caseId}`);
  }
  if (
    caseMeta.evaluation.liveVisionEligible === false &&
    !String(caseMeta.evaluation.liveVisionReason ?? "").trim()
  ) {
    throw new Error(`regression_corpus_case_live_vision_reason_required:${caseId}`);
  }
}

function validateExpected({ expected, caseId }) {
  if (!["extract", "exclude", "review", "capture_failure"].includes(expected?.action)) {
    throw new Error(`regression_corpus_expected_action_invalid:${caseId}`);
  }
  if (!Number.isInteger(expected.eventCount) || expected.eventCount < 0) {
    throw new Error(`regression_corpus_expected_event_count_invalid:${caseId}`);
  }
  if (expected.action !== "capture_failure" && !expected.evidence) {
    throw new Error(`regression_corpus_expected_evidence_required:${caseId}`);
  }
}

function eventDraftEnvelope({ payload, runId, index }) {
  return {
    evaluatorId: "regression-corpus",
    runId,
    observedAt: "2026-06-08T00:00:00.000Z",
    payloadVersion: "reset-regression-replay-v1",
    payload: {
      draftId: payload.draftId ?? `draft-${index + 1}`,
      ...payload,
    },
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRegressionReplayCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
