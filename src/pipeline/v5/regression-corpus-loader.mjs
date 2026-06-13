import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  validateCapturedArticleBundle,
  validateCaptureResult,
} from "../../capture/article-bundle.mjs";

export const requiredV5CoverageLabels = [
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
const successCaseFiles = ["case.json", "captured-bundle.json"];
const failureCaseFiles = ["case.json", "capture-result.json"];
const modelInputLeakagePatterns = [
  "Expected action",
  "Expected Action",
  "Rationale:",
  "Review/exclusion reasons",
  "This case is retained",
  "original article content is not mirrored",
];

export async function loadV5RegressionCorpus({ corpusDir } = {}) {
  if (!corpusDir) throw new Error("v5_regression_corpus_dir_required");
  const manifestPath = path.join(corpusDir, manifestFileName);
  const manifest = await readJson(manifestPath);
  validateManifest(manifest);

  const cases = [];
  for (const entry of manifest.cases) {
    cases.push(await loadRegressionCase({ caseId: entry.id, corpusDir, manifestEntry: entry }));
  }

  const coverageLabels = [...new Set(cases.flatMap((item) => item.case.labels ?? []))].sort();
  const manifestRequiredCoverageLabels = manifest.requiredCoverageLabels ?? requiredV5CoverageLabels;
  const missingCoverage = manifestRequiredCoverageLabels.filter(
    (label) => !coverageLabels.includes(label),
  );
  if (missingCoverage.length) {
    throw new Error(`v5_regression_corpus_coverage_missing:${missingCoverage.join(",")}`);
  }

  return {
    manifest,
    cases,
    coverageLabels,
    requiredCoverageLabels: manifestRequiredCoverageLabels,
    knownCoverageGaps: manifest.knownCoverageGaps ?? [],
  };
}

async function loadRegressionCase({ caseId, corpusDir, manifestEntry }) {
  const caseDir = path.join(corpusDir, caseId);
  const fileNames = await readdir(caseDir).catch(() => {
    throw new Error(`v5_regression_corpus_case_dir_missing:${caseId}`);
  });
  const hasCaptureResult = fileNames.includes("capture-result.json");
  const requiredFiles = hasCaptureResult ? failureCaseFiles : successCaseFiles;
  for (const fileName of requiredFiles) {
    if (!fileNames.includes(fileName)) {
      throw new Error(`v5_regression_corpus_file_missing:${caseId}:${fileName}`);
    }
  }

  const caseMeta = await readJson(path.join(caseDir, "case.json"));
  const expected = fileNames.includes("expected.json")
    ? await readJson(path.join(caseDir, "expected.json"))
    : expectedFromCaseMeta({ caseMeta, caseId });
  validateCaseMeta({ caseMeta, manifestEntry, caseId });
  validateExpected({ expected, caseId });

  if (hasCaptureResult) {
    const captureResult = await readJson(path.join(caseDir, "capture-result.json"));
    validateCaptureResult(captureResult);
    if (captureResult.ok !== false) {
      throw new Error(`v5_regression_corpus_capture_result_not_failure:${caseId}`);
    }
    return { case: caseMeta, expected, captureResult };
  }

  const bundle = await resolveCaseLocalImageAssets({
    bundle: await readJson(path.join(caseDir, "captured-bundle.json")),
    caseDir,
    caseId,
  });
  validateCapturedArticleBundle(bundle);
  validateNoModelInputLeakage({ bundle, caseId });
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
    throw new Error(`v5_regression_corpus_asset_path_invalid:${caseId}:${image.id ?? imagePath}`);
  }
  const resolvedPath = path.resolve(caseDir, imagePath);
  const resolvedCaseDir = path.resolve(caseDir);
  if (!resolvedPath.startsWith(`${resolvedCaseDir}${path.sep}`)) {
    throw new Error(`v5_regression_corpus_asset_path_invalid:${caseId}:${image.id ?? imagePath}`);
  }
  let bytes;
  try {
    bytes = await readFile(resolvedPath);
  } catch {
    throw new Error(`v5_regression_corpus_asset_missing:${caseId}:${imagePath}`);
  }
  const contentType = image.contentType ?? contentTypeFromPath(imagePath);
  if (!contentType) {
    throw new Error(`v5_regression_corpus_asset_content_type_required:${caseId}:${imagePath}`);
  }
  return {
    ...image,
    contentType,
    dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
  };
}

function expectedFromCaseMeta({ caseMeta, caseId }) {
  const expected = caseMeta.expected && typeof caseMeta.expected === "object"
    ? caseMeta.expected
    : {};
  const action =
    expected.action ??
    caseMeta.expected_action ??
    caseMeta.expectedAction;
  const eventCount =
    expected.eventCount ??
    expected.event_count ??
    caseMeta.expected_event_count ??
    caseMeta.expectedEventCount;
  if (!action) {
    throw new Error(`v5_regression_corpus_expected_action_required:${caseId}`);
  }
  return {
    action,
    eventCount,
    evidence: expected.evidence ?? {},
    eventDrafts: expected.eventDrafts ?? [],
    dedupe: expected.dedupe,
    publish: expected.publish,
  };
}

function validateManifest(manifest) {
  if (manifest?.version !== "event-pipeline-regression-corpus-v1") {
    throw new Error("v5_regression_corpus_manifest_version_invalid");
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error("v5_regression_corpus_manifest_cases_required");
  }
  const ids = new Set();
  for (const entry of manifest.cases) {
    if (!entry?.id) throw new Error("v5_regression_corpus_manifest_case_id_required");
    if (ids.has(entry.id)) throw new Error(`v5_regression_corpus_manifest_case_duplicate:${entry.id}`);
    ids.add(entry.id);
    if (!Array.isArray(entry.labels) || entry.labels.length === 0) {
      throw new Error(`v5_regression_corpus_manifest_case_labels_required:${entry.id}`);
    }
  }
  if (manifest.requiredCoverageLabels !== undefined) {
    validateStringArray(
      manifest.requiredCoverageLabels,
      "v5_regression_corpus_manifest_required_coverage_invalid",
    );
  }
  if (manifest.knownCoverageGaps !== undefined) {
    if (!Array.isArray(manifest.knownCoverageGaps)) {
      throw new Error("v5_regression_corpus_manifest_known_gaps_invalid");
    }
    for (const gap of manifest.knownCoverageGaps) {
      if (!clean(gap?.label) || !clean(gap?.reason)) {
        throw new Error("v5_regression_corpus_manifest_known_gap_invalid");
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
  if (caseMeta?.id !== caseId) throw new Error(`v5_regression_corpus_case_id_mismatch:${caseId}`);
  if (!Array.isArray(caseMeta.labels) || caseMeta.labels.length === 0) {
    throw new Error(`v5_regression_corpus_case_labels_required:${caseId}`);
  }
  for (const label of manifestEntry.labels) {
    if (!caseMeta.labels.includes(label)) {
      throw new Error(`v5_regression_corpus_case_manifest_label_missing:${caseId}:${label}`);
    }
  }
  if (!caseMeta.source?.type) throw new Error(`v5_regression_corpus_case_source_required:${caseId}`);
  validateCaseEvaluationMeta({ caseMeta, caseId });
  if (!caseMeta.rationale) throw new Error(`v5_regression_corpus_case_rationale_required:${caseId}`);
}

function validateCaseEvaluationMeta({ caseMeta, caseId }) {
  if (caseMeta.evaluation === undefined) return;
  if (!caseMeta.evaluation || typeof caseMeta.evaluation !== "object") {
    throw new Error(`v5_regression_corpus_case_evaluation_invalid:${caseId}`);
  }
  if (
    caseMeta.evaluation.liveVisionEligible !== undefined &&
    typeof caseMeta.evaluation.liveVisionEligible !== "boolean"
  ) {
    throw new Error(`v5_regression_corpus_case_live_vision_eligible_invalid:${caseId}`);
  }
  if (
    caseMeta.evaluation.liveVisionEligible === false &&
    !String(caseMeta.evaluation.liveVisionReason ?? "").trim()
  ) {
    throw new Error(`v5_regression_corpus_case_live_vision_reason_required:${caseId}`);
  }
}

function validateExpected({ expected, caseId }) {
  if (!["extract", "exclude", "review", "capture_failure"].includes(expected?.action)) {
    throw new Error(`v5_regression_corpus_expected_action_invalid:${caseId}`);
  }
  if (!Number.isInteger(expected.eventCount) || expected.eventCount < 0) {
    throw new Error(`v5_regression_corpus_expected_event_count_invalid:${caseId}`);
  }
  if (expected.action !== "capture_failure" && !expected.evidence) {
    throw new Error(`v5_regression_corpus_expected_evidence_required:${caseId}`);
  }
}

function validateNoModelInputLeakage({ bundle, caseId }) {
  const text = [
    bundle.title,
    bundle.text,
    bundle.html,
    ...(Array.isArray(bundle.images)
      ? bundle.images.flatMap((image) => [image.alt, image.textContent])
      : []),
    ...(Array.isArray(bundle.links)
      ? bundle.links.flatMap((link) => [link.text, link.url])
      : []),
    ...(Array.isArray(bundle.miniPrograms)
      ? bundle.miniPrograms.flatMap((item) => [item.text, item.path, item.url])
      : []),
  ].filter(Boolean).join("\n");
  for (const pattern of modelInputLeakagePatterns) {
    if (text.includes(pattern)) {
      throw new Error(`v5_regression_corpus_model_input_leakage:${caseId}:${pattern}`);
    }
  }
}

function contentTypeFromPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return undefined;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
