#!/usr/bin/env node

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateCapturedArticleBundle,
  validateCaptureResult,
} from "../src/capture/article-bundle.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCorpusDir = path.resolve(moduleDir, "../tests/regression-corpus");
const manifestFileName = "manifest.json";

export async function promoteRegressionCase({
  corpusDir = defaultCorpusDir,
  caseId,
  labels,
  sourceUrl,
  sourceType = "operator_bad_case",
  rationale,
  bundleFile,
  captureResultFile,
  expectedAction = "review",
  eventCount = 0,
  overwrite = false,
} = {}) {
  const normalizedCaseId = requireSafeCaseId(caseId);
  const normalizedLabels = normalizeLabels(labels);
  const normalizedSourceUrl = requireString(sourceUrl, "source_url_required");
  const normalizedRationale = requireString(rationale, "rationale_required");
  if (bundleFile && captureResultFile) {
    throw new Error("regression_promote_single_input_required");
  }
  if (!bundleFile && !captureResultFile) {
    throw new Error("regression_promote_input_required");
  }

  const manifestPath = path.join(corpusDir, manifestFileName);
  const manifest = await readJson(manifestPath);
  validateManifest(manifest);
  const caseDir = path.join(corpusDir, normalizedCaseId);
  if (
    (manifest.cases?.some((entry) => entry.id === normalizedCaseId) ||
      (await caseDirExists(caseDir))) &&
    !overwrite
  ) {
    throw new Error(`regression_promote_case_exists:${normalizedCaseId}`);
  }

  const caseMeta = {
    id: normalizedCaseId,
    labels: normalizedLabels,
    source: {
      type: sourceType,
      url: normalizedSourceUrl,
    },
    rationale: normalizedRationale,
  };
  const outputFiles = new Map([["case.json", caseMeta]]);

  if (bundleFile) {
    const normalizedExpectedAction = normalizeExpectedAction(expectedAction);
    const normalizedEventCount = normalizeEventCount(eventCount);
    if (normalizedExpectedAction === "exclude" && normalizedEventCount !== 0) {
      throw new Error("regression_promote_exclude_event_count_must_be_zero");
    }
    if (
      ["extract", "review"].includes(normalizedExpectedAction) &&
      normalizedEventCount < 1
    ) {
      throw new Error("regression_promote_event_count_required_for_event_action");
    }
    const bundle = await readJson(bundleFile);
    validateCapturedArticleBundle(bundle);
    assertMatchingSourceUrl({
      actual: bundle.sourceUrl,
      expected: normalizedSourceUrl,
      errorPrefix: "regression_promote_bundle_source_url_mismatch",
    });
    outputFiles.set("captured-bundle.json", bundle);
    outputFiles.set(
      "expected.json",
      defaultExpectedForBundle({
        action: normalizedExpectedAction,
        eventCount: normalizedEventCount,
        caseId: normalizedCaseId,
        sourceUrl: normalizedSourceUrl,
      }),
    );
  } else {
    const captureResult = await readJson(captureResultFile);
    validateCaptureResult(captureResult);
    if (captureResult.ok !== false) {
      throw new Error("regression_promote_capture_result_must_be_failure");
    }
    const failureSourceUrl = requireString(
      captureResult.failure.sourceUrl,
      "regression_promote_capture_result_source_url_required",
    );
    assertMatchingSourceUrl({
      actual: failureSourceUrl,
      expected: normalizedSourceUrl,
      errorPrefix: "regression_promote_capture_result_source_url_mismatch",
    });
    outputFiles.set("capture-result.json", captureResult);
    outputFiles.set(
      "expected.json",
      defaultExpectedForCaptureFailure(captureResult),
    );
  }

  const cases = (manifest.cases ?? []).filter(
    (entry) => entry.id !== normalizedCaseId,
  );
  cases.push({ id: normalizedCaseId, labels: normalizedLabels });

  await mkdir(caseDir, { recursive: true });
  await removeStaleFileForInputKind({ caseDir, bundleFile, captureResultFile });
  for (const [fileName, value] of outputFiles) {
    await writePrettyJson(path.join(caseDir, fileName), value);
  }
  await writePrettyJson(manifestPath, {
    ...manifest,
    cases,
  });

  return {
    caseId: normalizedCaseId,
    caseDir,
    manifestPath,
  };
}

export function parsePromoteArgs(argv = process.argv.slice(2)) {
  const options = {
    labels: [],
    expectedAction: "review",
    eventCount: 0,
    overwrite: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--corpus-dir") options.corpusDir = argv[++index];
    else if (arg === "--case-id") options.caseId = argv[++index];
    else if (arg === "--label") options.labels.push(argv[++index]);
    else if (arg === "--source-url") options.sourceUrl = argv[++index];
    else if (arg === "--source-type") options.sourceType = argv[++index];
    else if (arg === "--rationale") options.rationale = argv[++index];
    else if (arg === "--bundle-file") options.bundleFile = argv[++index];
    else if (arg === "--capture-result-file") options.captureResultFile = argv[++index];
    else if (arg === "--expected-action") options.expectedAction = argv[++index];
    else if (arg === "--event-count") options.eventCount = Number.parseInt(argv[++index], 10);
    else if (arg === "--overwrite") options.overwrite = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`regression_promote_arg_unknown:${arg}`);
  }
  return options;
}

export async function runPromoteCli(argv = process.argv.slice(2)) {
  const options = parsePromoteArgs(argv);
  if (options.help) {
    printUsage();
    return undefined;
  }
  const result = await promoteRegressionCase(options);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function defaultExpectedForBundle({ action, eventCount, caseId, sourceUrl }) {
  return {
    action,
    eventCount,
    evidence: {
      posterCount: 0,
      qrCodeCount: 0,
      registrationUrlCount: 0,
      miniProgramActionCount: 0,
    },
    dedupe: { decision: action === "exclude" ? "reject" : "new_event" },
    publish: {
      state: defaultPublishStateForAction(action),
      reasons: ["operator_bad_case"],
    },
    eventDrafts: Array.from({ length: eventCount }, (_, index) => ({
      draftId: `draft-${caseId}-${index + 1}`,
      articleUrl: sourceUrl,
      title: `Promoted regression event ${index + 1}`,
    })),
  };
}

function defaultPublishStateForAction(action) {
  if (action === "extract") return "public";
  if (action === "exclude") return "rejected";
  return "needs_review";
}

function defaultExpectedForCaptureFailure(captureResult) {
  return {
    action: "capture_failure",
    eventCount: 0,
    sourceHealth: {
      ok: false,
      failureReason: captureResult.failure.reason,
    },
    eventDrafts: [],
  };
}

function requireSafeCaseId(value) {
  const normalized = requireString(value, "case_id_required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error(`case_id_invalid:${normalized}`);
  }
  return normalized;
}

function normalizeLabels(labels) {
  const normalized = [...new Set((labels ?? []).map((label) => String(label ?? "").trim()).filter(Boolean))];
  if (!normalized.length) throw new Error("labels_required");
  return normalized;
}

function normalizeExpectedAction(value) {
  const normalized = requireString(value, "expected_action_required");
  if (!["extract", "exclude", "review"].includes(normalized)) {
    throw new Error(`expected_action_invalid:${normalized}`);
  }
  return normalized;
}

function normalizeEventCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`event_count_invalid:${value}`);
  }
  return count;
}

function validateManifest(manifest) {
  if (manifest?.version !== "event-pipeline-regression-corpus-v1") {
    throw new Error("regression_promote_manifest_version_invalid");
  }
  if (!Array.isArray(manifest.cases)) {
    throw new Error("regression_promote_manifest_cases_invalid");
  }
}

function assertMatchingSourceUrl({ actual, expected, errorPrefix }) {
  if (String(actual ?? "").trim() !== expected) {
    throw new Error(`${errorPrefix}:${actual ?? ""}`);
  }
}

async function removeStaleFileForInputKind({ caseDir, bundleFile, captureResultFile }) {
  const staleFile = bundleFile ? "capture-result.json" : captureResultFile ? "captured-bundle.json" : undefined;
  if (!staleFile) return;
  await rm(path.join(caseDir, staleFile), { force: true });
}

async function caseDirExists(caseDir) {
  try {
    await readdir(caseDir);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function requireString(value, error) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(error);
  return normalized;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writePrettyJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function printUsage() {
  console.log(`Usage: pnpm regression:promote -- --case-id <id> --label <label> --source-url <url> --rationale <text> --bundle-file <captured-bundle.json> --expected-action <extract|review|exclude> --event-count <n>

Promotes an already captured bad case into tests/regression-corpus without live
WeChat, live LLM, hosted Supabase, or production writes.

Use --capture-result-file instead of --bundle-file for typed capture failures.
Repeat --label for multiple labels. Bundle cases with --expected-action extract
or review must set --event-count to at least 1.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPromoteCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
