#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  assertHostedWriteAllowed,
  writeTargetSummary,
} from "../src/config/write-guard.mjs";
import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";
import { runWechatUrlExtractionOnce } from "./wechat-url-extract.mjs";

export const requiredSeedCoverage = [
  "single_event",
  "multi_event_article",
  "qr_registration",
  "poster_or_image_dominant",
  "long_running_exhibition",
  "recurring_activity",
  "duplicate_pair",
  "official_visit_or_non_public_news",
  "generic_non_event",
  "incomplete_review_case",
];

export async function loadProductionSeedManifest(path) {
  if (!path) throw new Error("seed_manifest_required");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  validateProductionSeedManifest(manifest);
  return manifest;
}

export function validateProductionSeedManifest(manifest) {
  if (manifest.version !== "production-seed-manifest-v1") {
    throw new Error("seed_manifest_version_invalid");
  }
  if (!manifest.batchLabel || typeof manifest.batchLabel !== "string") {
    throw new Error("seed_manifest_batch_label_required");
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error("seed_manifest_cases_required");
  }

  const coverage = new Set();
  const duplicateGroups = new Map();
  for (const articleCase of manifest.cases) {
    validateSeedCase(articleCase);
    for (const item of articleCase.coverage) coverage.add(item);
    if (articleCase.expected?.duplicateGroup) {
      const group = duplicateGroups.get(articleCase.expected.duplicateGroup) ?? 0;
      duplicateGroups.set(articleCase.expected.duplicateGroup, group + 1);
    }
  }

  const missingCoverage = requiredSeedCoverage.filter((item) => !coverage.has(item));
  if (missingCoverage.length) {
    throw new Error(`seed_manifest_missing_coverage:${missingCoverage.join(",")}`);
  }
  if (![...duplicateGroups.values()].some((count) => count >= 2)) {
    throw new Error("seed_manifest_duplicate_pair_required");
  }
}

export function buildProductionSeedPlan(manifest) {
  const cases = manifest.cases.map((articleCase) => {
    const sourceType = articleCase.source.type;
    const autoImportSupported = sourceType === "live_url";
    return {
      id: articleCase.id,
      title: articleCase.title,
      sourceType,
      sourceUrl: articleCase.source.url ?? articleCase.source.articleUrl,
      expectedAction: articleCase.expected.action,
      expectedPublic: articleCase.expected.public,
      expectedPublicEventCount: articleCase.expected.publicEventCount ?? 0,
      expectedAdminReview: Boolean(articleCase.expected.adminReview),
      duplicateGroup: articleCase.expected.duplicateGroup,
      autoImportSupported,
      unsupportedReason: autoImportSupported
        ? undefined
        : "captured_reference_requires_materialized_snapshot_or_live_url",
    };
  });

  return {
    batchLabel: manifest.batchLabel,
    caseCount: cases.length,
    liveImportCaseCount: cases.filter((item) => item.autoImportSupported).length,
    unsupportedCaseCount: cases.filter((item) => !item.autoImportSupported).length,
    coverage: Object.fromEntries(
      requiredSeedCoverage.map((coverage) => [
        coverage,
        casesForCoverage(manifest, coverage),
      ]),
    ),
    cases,
  };
}

export async function runProductionSeedImport({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  importLiveUrl = runWechatUrlExtractionOnce,
  now = new Date(),
} = {}) {
  const args = parseProductionSeedArgs(argv);
  if (args.help) {
    console.log(seedUsage());
    return { ok: true, help: true };
  }

  const mergedEnv = mergeEnvs(
    env,
    ...args.envFiles.map((envFile) => loadEnvFile(envFile)),
  );
  const manifest = await loadProductionSeedManifest(args.manifest);
  const plan = buildProductionSeedPlan(manifest);
  const runId = args.runId ?? createProductionSeedRunId(now);
  const target = assertHostedWriteAllowed({
    command: "production_seed",
    baseUrl: args.targetBaseUrl ?? readTargetBaseUrl(mergedEnv),
    allowHostedWrite: args.apply ? args.allowHostedWrite : true,
  });
  if (args.confirmTarget && args.confirmTarget !== target.baseUrl) {
    throw new Error("production_seed_confirm_target_mismatch");
  }
  const targetSummary = writeTargetSummary({
    command: "production_seed",
    target,
    runId,
    writeMode: args.apply ? "apply_import" : "dry_run_import",
    usageEnvironment: "production_seed_acceptance",
  });

  if (!args.apply) {
    return {
      ok: true,
      mode: "dry_run",
      runId,
      target,
      targetSummary,
      plan,
    };
  }

  assertProductionSeedApproval(args);
  const seedEnv = {
    ...mergedEnv,
    COLLECTOR_BASE_URL: target.baseUrl,
    APP_BASE_URL: target.baseUrl,
    USAGE_ENVIRONMENT: "production_seed_acceptance",
    PRODUCTION_SEED_USAGE_ENVIRONMENT: "production_seed_acceptance",
  };
  const importableCases = manifest.cases.filter(
    (articleCase) => articleCase.source.type === "live_url",
  );
  if (importableCases.length === 0) {
    throw new Error("production_seed_no_live_url_cases");
  }

  const imported = [];
  for (const articleCase of importableCases) {
    const result = await importLiveUrl({
      env: seedEnv,
      url: articleCase.source.url,
      upload: true,
      session: `${runId}-${articleCase.id}`,
      now,
      fetchImpl,
    });
    imported.push({
      caseId: articleCase.id,
      url: articleCase.source.url,
      runId: result.runId,
      title: result.articleTitle,
      draftCount: result.draftSummaries.length,
      failureCount: result.failureSummaries.length,
      uploadedEventDraftIds: result.extraction.uploadedEventDraftIds ?? [],
      uploadedLlmUsageIds: result.extraction.uploadedLlmUsageIds ?? [],
    });
  }

  return {
    ok: true,
    mode: "applied",
    runId,
    target,
    targetSummary,
    plan,
    imported,
  };
}

export function formatProductionSeedReport(result) {
  const lines = [
    result.mode === "applied"
      ? "# Production Seed Import Applied"
      : "# Production Seed Import Dry Run",
    "",
    result.targetSummary,
    "",
    "## Plan",
    "",
    `cases=${result.plan.caseCount}`,
    `liveImportCases=${result.plan.liveImportCaseCount}`,
    `unsupportedCases=${result.plan.unsupportedCaseCount}`,
    "",
    "## Cases",
    "",
    ...result.plan.cases.map((articleCase) =>
      [
        `- ${articleCase.id}`,
        articleCase.sourceType,
        articleCase.expectedAction,
        articleCase.autoImportSupported ? "auto_import" : articleCase.unsupportedReason,
      ].join(" | "),
    ),
  ];
  if (result.imported) {
    lines.push("", "## Imported", "");
    for (const item of result.imported) {
      lines.push(
        `- ${item.caseId}: drafts=${item.draftCount} failures=${item.failureCount} usage=${item.uploadedLlmUsageIds.length}`,
      );
    }
  }
  return lines.join("\n");
}

function validateSeedCase(articleCase) {
  if (!articleCase.id || typeof articleCase.id !== "string") {
    throw new Error("seed_case_id_required");
  }
  if (!articleCase.title || typeof articleCase.title !== "string") {
    throw new Error(`seed_case_title_required:${articleCase.id}`);
  }
  if (!Array.isArray(articleCase.coverage) || articleCase.coverage.length === 0) {
    throw new Error(`seed_case_coverage_required:${articleCase.id}`);
  }
  if (!articleCase.source || typeof articleCase.source !== "object") {
    throw new Error(`seed_case_source_required:${articleCase.id}`);
  }
  if (!["live_url", "captured_reference"].includes(articleCase.source.type)) {
    throw new Error(`seed_case_source_type_invalid:${articleCase.id}`);
  }
  const url = articleCase.source.url ?? articleCase.source.articleUrl;
  if (!isWechatArticleUrl(url)) {
    throw new Error(`seed_case_source_url_invalid:${articleCase.id}`);
  }
  if (isFixtureOrPlaceholderUrl(url)) {
    throw new Error(`seed_case_refuses_fixture_url:${articleCase.id}`);
  }
  if (!articleCase.expected || typeof articleCase.expected !== "object") {
    throw new Error(`seed_case_expected_required:${articleCase.id}`);
  }
  if (!["extract", "exclude", "review"].includes(articleCase.expected.action)) {
    throw new Error(`seed_case_expected_action_invalid:${articleCase.id}`);
  }
}

function casesForCoverage(manifest, coverage) {
  return manifest.cases
    .filter((articleCase) => articleCase.coverage.includes(coverage))
    .map((articleCase) => articleCase.id);
}

function parseProductionSeedArgs(argv) {
  const args = {
    envFiles: [],
    manifest: undefined,
    apply: false,
    allowHostedWrite: false,
    confirmSeedImport: undefined,
    confirmTarget: undefined,
    targetBaseUrl: undefined,
    runId: undefined,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--env-file") {
      args.envFiles.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--manifest") {
      args.manifest = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--apply") args.apply = true;
    else if (arg === "--allow-hosted-write") args.allowHostedWrite = true;
    else if (arg === "--confirm-seed-import") {
      args.confirmSeedImport = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--confirm-target") {
      args.confirmTarget = normalizeBaseUrl(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--target-base-url") {
      args.targetBaseUrl = normalizeBaseUrl(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--run-id") {
      args.runId = requiredValue(argv, index, arg);
      index += 1;
    } else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

function assertProductionSeedApproval(args) {
  if (args.confirmSeedImport !== "IMPORT_PRODUCTION_SEED_EVENTS") {
    throw new Error("production_seed_apply_requires_confirm_seed_import");
  }
  if (!args.allowHostedWrite) {
    throw new Error("production_seed_apply_requires_allow_hosted_write");
  }
  if (!args.confirmTarget) {
    throw new Error("production_seed_apply_requires_confirm_target");
  }
}

function readTargetBaseUrl(env) {
  return (
    env.COLLECTOR_BASE_URL?.trim() ??
    env.APP_BASE_URL?.trim() ??
    env.NEXT_PUBLIC_APP_URL?.trim() ??
    ""
  );
}

function createProductionSeedRunId(now) {
  return `production-seed-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
  return value;
}

function isWechatArticleUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "mp.weixin.qq.com";
  } catch {
    return false;
  }
}

function isFixtureOrPlaceholderUrl(value) {
  return /fixture|example\.com|activities\.example|\/s\/(example|local|test)/i.test(
    String(value ?? ""),
  );
}

function normalizeBaseUrl(value) {
  return new URL(String(value ?? "").trim()).toString().replace(/\/+$/, "");
}

function seedUsage() {
  return `Usage: pnpm seed:production-events -- --env-file .env.local --manifest tests/seed-corpus/production-seed-manifest.json [--apply]

Default mode is dry-run and performs no writes.

Apply mode is production-mutating and requires:
  --apply
  --allow-hosted-write
  --confirm-seed-import IMPORT_PRODUCTION_SEED_EVENTS
  --confirm-target https://local-activities.vercel.app`;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runProductionSeedImport().then((result) => {
    if (!result.help) console.log(formatProductionSeedReport(result));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
