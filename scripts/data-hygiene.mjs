#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  assertHostedWriteAllowed,
  writeTargetSummary,
} from "../src/config/write-guard.mjs";
import { createCurlProxyFetch } from "../src/net/curl-proxy-fetch.mjs";
import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

const defaultLimit = 1_000;
const resetStorageBuckets = [
  "article-bundles",
  "event-evidence-assets",
  "eval-artifacts",
];
const resetTableSpecs = [
  ["evaluation_case_results", "id", "id,data_class,result_id,run_id,case_id,created_at"],
  ["evaluation_runs", "id", "id,data_class,run_id,provider,model,status,created_at"],
  ["dedupe_decisions", "id", "id,data_class,dedupe_id,draft_id,canonical_event_id,decision,created_at"],
  ["processing_ledger", "id", "id,data_class,ledger_id,article_bundle_id,source_url,state,decision,created_at"],
  ["llm_usage_ledger", "id", "id,data_class,usage_id,operation,provider,model,status,recorded_at,created_at"],
  ["canonical_events", "id", "id,data_class,event_id,title,summary,source_url,status,created_at"],
  [
    "event_drafts",
    "id",
    "id,data_class,draft_id,article_url,title,summary,review_state,processing_state,triage_decision,triage_action,public_eligibility,confidence,created_at,poster_asset_id,qr_asset_id,registration_qr_asset_id",
  ],
  [
    "excluded_articles",
    "id",
    "id,data_class,article_url,triage_decision,exclusion_reason,confidence,processing_state,created_at",
  ],
  ["evidence_assets", "id", "id,data_class,article_url,role,media_type,source_url,storage_bucket,storage_path,public_url,created_at"],
  [
    "article_bundles",
    "id",
    "id,data_class,bundle_id,source_url,canonical_url,content_hash,storage_bucket,storage_prefix,status,created_at",
  ],
  ["collector_failures", "id", "id,data_class,failure_id,article_url,stage,reason,created_at"],
  ["source_runs", "id", "id,data_class,run_id,status,seed_url,started_at,finished_at,created_at"],
  ["collector_jobs", "id", "id,data_class,job_id,seed_url,state,requested_at,finished_at,created_at"],
  ["source_channels", "id", "id,data_class,source_id,source_provider,source_name,source_url,status,created_at"],
];

const allowedDataClasses = new Set(["production", "eval", "test", "smoke"]);
const likelyNegativeDraftPattern =
  /部长|访问|会见|声明|认可|无口蹄疫|食品展|回顾|新闻|president|minister|official visit|statement|trade/i;

export async function fetchDataAuditRows({
  client,
  limit = defaultLimit,
  fetchAll = false,
}) {
  const selected = await Promise.all(
    resetTableSpecs.map(async ([table, , columns]) => [
      table,
      await selectRows(client, table, columns, limit, { fetchAll }),
    ]),
  );
  const byTable = Object.fromEntries(selected);

  return {
    eventDrafts: byTable.event_drafts,
    excludedArticles: byTable.excluded_articles,
    evidenceAssets: byTable.evidence_assets,
    canonicalEvents: byTable.canonical_events,
    sourceRuns: byTable.source_runs,
    collectorFailures: byTable.collector_failures,
    collectorJobs: byTable.collector_jobs,
    articleBundles: byTable.article_bundles,
    processingLedger: byTable.processing_ledger,
    dedupeDecisions: byTable.dedupe_decisions,
    llmUsageLedger: byTable.llm_usage_ledger,
    evaluationRuns: byTable.evaluation_runs,
    evaluationCaseResults: byTable.evaluation_case_results,
    sourceChannels: byTable.source_channels,
  };
}

export async function fetchStorageAuditObjects({
  client,
  buckets = resetStorageBuckets,
  limit = defaultLimit,
}) {
  if (!client.storage?.from) return {};
  const entries = await Promise.all(
    buckets.map(async (bucket) => [
      bucket,
      await listStorageObjects({ client, bucket, limit }),
    ]),
  );
  return Object.fromEntries(entries);
}

export function summarizeDataAudit(rows) {
  const eventDrafts = rows.eventDrafts ?? [];
  const excludedArticles = rows.excludedArticles ?? [];
  const evidenceAssets = rows.evidenceAssets ?? [];
  const canonicalEvents = rows.canonicalEvents ?? [];
  const sourceRuns = rows.sourceRuns ?? [];
  const collectorFailures = rows.collectorFailures ?? [];
  const collectorJobs = rows.collectorJobs ?? [];
  const articleBundles = rows.articleBundles ?? [];
  const processingLedger = rows.processingLedger ?? [];
  const dedupeDecisions = rows.dedupeDecisions ?? [];
  const llmUsageLedger = rows.llmUsageLedger ?? [];
  const evaluationRuns = rows.evaluationRuns ?? [];
  const evaluationCaseResults = rows.evaluationCaseResults ?? [];
  const sourceChannels = rows.sourceChannels ?? [];

  const duplicateDraftGroups = duplicateGroups(eventDrafts, (draft) =>
    `${draft.article_url ?? ""}\n${normalizeTitle(draft.title)}`,
  ).map((group) => ({
    key: group.key,
    articleUrl: group.rows[0]?.article_url ?? "",
    title: group.rows[0]?.title ?? "",
    count: group.rows.length,
    draftIds: group.rows.map((row) => row.id),
  }));

  const missingTriageDrafts = eventDrafts.filter((draft) => !draft.triage_decision);
  const likelyNegativeDrafts = eventDrafts.filter((draft) =>
    likelyNegativeDraftPattern.test(`${draft.title ?? ""} ${draft.article_url ?? ""}`),
  );
  const invalidDataClassRows = scopedRows(rows).filter(
    (row) => !allowedDataClasses.has(row.dataClass),
  );
  const storageNamespaceMismatches = [
    ...articleBundles
      .filter((bundle) => !validBundleStorageNamespace(bundle))
      .map((bundle) => ({
        table: "article_bundles",
        id: bundle.id,
        dataClass: bundle.data_class,
        storagePrefix: bundle.storage_prefix,
      })),
    ...evidenceAssets
      .filter((asset) => !validEvidenceStorageNamespace(asset))
      .map((asset) => ({
        table: "evidence_assets",
        id: asset.id,
        dataClass: asset.data_class,
        storagePath: asset.storage_path,
      })),
  ];
  const brokenEvidenceUrls = evidenceAssets.filter((asset) =>
    isBrokenEvidenceUrl(asset.source_url),
  );
  const localProxyEvidenceUrls = evidenceAssets.filter((asset) =>
    isLocalProxyEvidenceUrl(asset.source_url),
  );

  return {
    tableCounts: {
      eventDrafts: eventDrafts.length,
      excludedArticles: excludedArticles.length,
      evidenceAssets: evidenceAssets.length,
      canonicalEvents: canonicalEvents.length,
      articleBundles: articleBundles.length,
      processingLedger: processingLedger.length,
      dedupeDecisions: dedupeDecisions.length,
      llmUsageLedger: llmUsageLedger.length,
      evaluationRuns: evaluationRuns.length,
      evaluationCaseResults: evaluationCaseResults.length,
      sourceChannels: sourceChannels.length,
      sourceRuns: sourceRuns.length,
      collectorFailures: collectorFailures.length,
      collectorJobs: collectorJobs.length,
    },
    draftReviewStates: countBy(eventDrafts, (draft) => draft.review_state ?? "unknown"),
    draftProcessingStates: countBy(
      eventDrafts,
      (draft) => draft.processing_state ?? "unknown",
    ),
    draftTriageDecisions: countBy(
      eventDrafts,
      (draft) => draft.triage_decision ?? "missing",
    ),
    evidenceRoles: countBy(evidenceAssets, (asset) => asset.role ?? "unknown"),
    duplicateDraftGroups,
    missingTriageDrafts: summarizeRows(missingTriageDrafts),
    likelyNegativeDrafts: summarizeRows(likelyNegativeDrafts),
    invalidDataClassRows,
    storageNamespaceMismatches,
    brokenEvidenceUrls: summarizeRows(brokenEvidenceUrls),
    localProxyEvidenceUrls: summarizeRows(localProxyEvidenceUrls),
    dirtySignals: {
      missingTriageDraftCount: missingTriageDrafts.length,
      duplicateDraftGroupCount: duplicateDraftGroups.length,
      likelyNegativeDraftCount: likelyNegativeDrafts.length,
      invalidDataClassRowCount: invalidDataClassRows.length,
      storageNamespaceMismatchCount: storageNamespaceMismatches.length,
      brokenEvidenceUrlCount: brokenEvidenceUrls.length,
      localProxyEvidenceUrlCount: localProxyEvidenceUrls.length,
      excludedArticleCount: excludedArticles.length,
      articleBundleCount: articleBundles.length,
      processingLedgerCount: processingLedger.length,
      dedupeDecisionCount: dedupeDecisions.length,
      llmUsageLedgerCount: llmUsageLedger.length,
      evaluationRunCount: evaluationRuns.length,
      evaluationCaseResultCount: evaluationCaseResults.length,
      sourceChannelCount: sourceChannels.length,
      sourceRunCount: sourceRuns.length,
      collectorFailureCount: collectorFailures.length,
      collectorJobCount: collectorJobs.length,
    },
    preservationCandidates: buildPreservationCandidates(rows, {
      likelyNegativeDrafts,
      canonicalEvents,
    }),
  };
}

export function planDataHygieneActions(rows, audit = summarizeDataAudit(rows)) {
  const actions = [];
  const eventDrafts = rows.eventDrafts ?? [];
  const evidenceAssets = rows.evidenceAssets ?? [];

  for (const draft of eventDrafts.filter((draft) => !draft.triage_decision)) {
    actions.push({
      action: "review_incomplete_pipeline_metadata",
      table: "event_drafts",
      id: draft.id,
      reason: "Draft is missing required pipeline metadata: triage_decision.",
      applySupported: false,
    });
  }

  for (const group of audit.duplicateDraftGroups) {
    const keepId = chooseDraftToKeep(
      eventDrafts.filter((draft) => group.draftIds.includes(draft.id)),
    )?.id;
    for (const draftId of group.draftIds.filter((id) => id !== keepId)) {
      actions.push({
        action: "review_duplicate_draft",
        table: "event_drafts",
        id: draftId,
        keepId,
        reason: `Duplicate draft candidate for ${group.title || group.articleUrl}.`,
        applySupported: false,
      });
    }
  }

  for (const draft of eventDrafts.filter((draft) =>
    likelyNegativeDraftPattern.test(`${draft.title ?? ""} ${draft.article_url ?? ""}`),
  )) {
    actions.push({
      action: "review_possible_negative_draft",
      table: "event_drafts",
      id: draft.id,
      reason: "Title or URL matches official visit/news/trade heuristics.",
      applySupported: false,
    });
  }

  for (const asset of evidenceAssets.filter((asset) =>
    isBrokenEvidenceUrl(asset.source_url),
  )) {
    actions.push({
      action: "repair_or_drop_broken_evidence_url",
      table: "evidence_assets",
      id: asset.id,
      reason: "source_url is malformed and should not be reused as image evidence.",
      applySupported: false,
    });
  }

  for (const asset of evidenceAssets.filter((asset) =>
    isLocalProxyEvidenceUrl(asset.source_url),
  )) {
    actions.push({
      action: "recapture_or_upload_local_proxy_evidence",
      table: "evidence_assets",
      id: asset.id,
      reason: "source_url points to local 127.0.0.1/localhost proxy and is not portable.",
      applySupported: false,
    });
  }

  for (const row of audit.invalidDataClassRows) {
    actions.push({
      action: "repair_invalid_data_class",
      table: row.table,
      id: row.id,
      reason: `Row has missing or invalid data_class: ${row.dataClass ?? "missing"}.`,
      applySupported: false,
    });
  }

  for (const row of audit.storageNamespaceMismatches) {
    actions.push({
      action: "repair_storage_namespace_mismatch",
      table: row.table,
      id: row.id,
      reason: "Storage path/prefix is not namespaced by the row data_class.",
      applySupported: false,
    });
  }

  return actions;
}

export function formatDataAuditMarkdown(audit) {
  const lines = [
    "# Data Audit",
    "",
    "## Table Counts",
    "",
    "| Table | Count |",
    "| --- | ---: |",
    `| event_drafts | ${audit.tableCounts.eventDrafts} |`,
    `| excluded_articles | ${audit.tableCounts.excludedArticles} |`,
    `| evidence_assets | ${audit.tableCounts.evidenceAssets} |`,
    `| canonical_events | ${audit.tableCounts.canonicalEvents} |`,
    `| article_bundles | ${audit.tableCounts.articleBundles} |`,
    `| processing_ledger | ${audit.tableCounts.processingLedger} |`,
    `| dedupe_decisions | ${audit.tableCounts.dedupeDecisions} |`,
    `| llm_usage_ledger | ${audit.tableCounts.llmUsageLedger} |`,
    `| evaluation_runs | ${audit.tableCounts.evaluationRuns} |`,
    `| evaluation_case_results | ${audit.tableCounts.evaluationCaseResults} |`,
    `| source_channels | ${audit.tableCounts.sourceChannels} |`,
    `| source_runs | ${audit.tableCounts.sourceRuns} |`,
    `| collector_failures | ${audit.tableCounts.collectorFailures} |`,
    `| collector_jobs | ${audit.tableCounts.collectorJobs} |`,
    "",
    "## Dirty Signals",
    "",
    "| Signal | Count |",
    "| --- | ---: |",
    `| incomplete pipeline metadata drafts | ${audit.dirtySignals.missingTriageDraftCount} |`,
    `| duplicate draft groups | ${audit.dirtySignals.duplicateDraftGroupCount} |`,
    `| likely negative drafts | ${audit.dirtySignals.likelyNegativeDraftCount} |`,
    `| invalid data_class rows | ${audit.dirtySignals.invalidDataClassRowCount} |`,
    `| storage namespace mismatches | ${audit.dirtySignals.storageNamespaceMismatchCount} |`,
    `| broken evidence URLs | ${audit.dirtySignals.brokenEvidenceUrlCount} |`,
    `| local proxy evidence URLs | ${audit.dirtySignals.localProxyEvidenceUrlCount} |`,
    "",
    "## Draft Review States",
    "",
    formatCounts(audit.draftReviewStates),
    "",
    "## Draft Triage Decisions",
    "",
    formatCounts(audit.draftTriageDecisions),
    "",
    "## Duplicate Draft Groups",
    "",
    ...formatDuplicateGroups(audit.duplicateDraftGroups),
    "",
  ];
  return lines.join("\n");
}

export function formatDataHygieneMarkdown(actions) {
  const grouped = countBy(actions, (action) => action.action);
  return [
    "# Data Hygiene Dry Run",
    "",
    "No writes were performed. Apply support is intentionally disabled until a human approves a specific cleanup policy.",
    "",
    "## Proposed Actions",
    "",
    formatCounts(grouped),
    "",
    "## Samples",
    "",
    ...actions.slice(0, 40).map((action) =>
      `- ${action.action} ${action.table}#${action.id}: ${action.reason}`,
    ),
    actions.length > 40 ? `- ... ${actions.length - 40} more actions` : "",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function planDataReset(rows) {
  const rowByTable = {
    evaluation_case_results: rows.evaluationCaseResults ?? [],
    evaluation_runs: rows.evaluationRuns ?? [],
    dedupe_decisions: rows.dedupeDecisions ?? [],
    processing_ledger: rows.processingLedger ?? [],
    llm_usage_ledger: rows.llmUsageLedger ?? [],
    canonical_events: rows.canonicalEvents ?? [],
    event_drafts: rows.eventDrafts ?? [],
    excluded_articles: rows.excludedArticles ?? [],
    evidence_assets: rows.evidenceAssets ?? [],
    article_bundles: rows.articleBundles ?? [],
    collector_failures: rows.collectorFailures ?? [],
    source_runs: rows.sourceRuns ?? [],
    collector_jobs: rows.collectorJobs ?? [],
    source_channels: rows.sourceChannels ?? [],
  };
  return resetTableSpecs.map(([table, idColumn]) => ({
    table,
    idColumn,
    ids: (rowByTable[table] ?? [])
      .map((row) => row[idColumn])
      .filter((id) => id !== undefined && id !== null),
  }));
}

export function planStorageReset(storageObjects = {}) {
  return resetStorageBuckets.map((bucket) => ({
    bucket,
    paths: (storageObjects[bucket] ?? []).map((object) => object.path),
  }));
}

export async function applyDataReset({ client, plan, runId }) {
  const results = [];
  for (const action of plan) {
    if (action.ids.length === 0) {
      results.push({ ...action, deletedCount: 0, deletedIds: [] });
      continue;
    }
    const { data, error } = await client
      .from(action.table)
      .delete()
      .in(action.idColumn, action.ids)
      .select(action.idColumn);
    if (error) {
      throw new Error(`data_reset_delete_failed:${action.table}:${error.message}`);
    }
    const deletedIds = (data ?? [])
      .map((row) => row[action.idColumn])
      .filter((id) => id !== undefined && id !== null);
    results.push({
      ...action,
      deletedCount: deletedIds.length,
      deletedIds,
      runId,
    });
  }
  return results;
}

export async function applyStorageReset({ client, plan, runId }) {
  const results = [];
  for (const action of plan) {
    if (action.paths.length === 0) {
      results.push({ ...action, deletedCount: 0, deletedPaths: [], runId });
      continue;
    }
    const deletedPaths = [];
    for (const chunk of chunks(action.paths, 100)) {
      const { data, error } = await client.storage.from(action.bucket).remove(chunk);
      if (error) {
        throw new Error(`storage_reset_delete_failed:${action.bucket}:${error.message}`);
      }
      const removed = Array.isArray(data)
        ? data.map((item) => item.name ?? item.path ?? item).filter(Boolean)
        : chunk;
      deletedPaths.push(...removed);
    }
    results.push({
      ...action,
      deletedCount: deletedPaths.length,
      deletedPaths,
      runId,
    });
  }
  return results;
}

export function formatDataResetMarkdown({
  targetSummary,
  audit,
  plan,
  storagePlan = [],
  results,
  storageResults,
}) {
  const applied = Array.isArray(results);
  const rows = applied ? results : plan;
  const storageRows = Array.isArray(storageResults) ? storageResults : storagePlan;
  return [
    applied ? "# Data Reset Applied" : "# Data Reset Dry Run",
    "",
    targetSummary,
    "",
    "This command resets event pipeline product, ledger, usage, evaluation, and storage data.",
    "",
    "## Table Counts Before Reset",
    "",
    "| Table | Count |",
    "| --- | ---: |",
    `| event_drafts | ${audit.tableCounts.eventDrafts} |`,
    `| excluded_articles | ${audit.tableCounts.excludedArticles} |`,
    `| evidence_assets | ${audit.tableCounts.evidenceAssets} |`,
    `| canonical_events | ${audit.tableCounts.canonicalEvents} |`,
    `| article_bundles | ${audit.tableCounts.articleBundles} |`,
    `| processing_ledger | ${audit.tableCounts.processingLedger} |`,
    `| dedupe_decisions | ${audit.tableCounts.dedupeDecisions} |`,
    `| llm_usage_ledger | ${audit.tableCounts.llmUsageLedger} |`,
    `| evaluation_runs | ${audit.tableCounts.evaluationRuns} |`,
    `| evaluation_case_results | ${audit.tableCounts.evaluationCaseResults} |`,
    `| source_channels | ${audit.tableCounts.sourceChannels} |`,
    `| source_runs | ${audit.tableCounts.sourceRuns} |`,
    `| collector_failures | ${audit.tableCounts.collectorFailures} |`,
    `| collector_jobs | ${audit.tableCounts.collectorJobs} |`,
    "",
    "## Reset Plan",
    "",
    "| Table | Count | IDs |",
    "| --- | ---: | --- |",
    ...rows.map((row) => {
      const ids = applied ? row.deletedIds : row.ids;
      const count = applied ? row.deletedCount : row.ids.length;
      return `| ${row.table} | ${count} | ${ids.slice(0, 50).join(", ")}${ids.length > 50 ? `, ... ${ids.length - 50} more` : ""} |`;
    }),
    "",
    "## Storage Reset Plan",
    "",
    "| Bucket | Count | Paths |",
    "| --- | ---: | --- |",
    ...storageRows.map((row) => {
      const paths = Array.isArray(storageResults) ? row.deletedPaths : row.paths;
      const count = Array.isArray(storageResults) ? row.deletedCount : row.paths.length;
      return `| ${row.bucket} | ${count} | ${paths.slice(0, 50).join(", ")}${paths.length > 50 ? `, ... ${paths.length - 50} more` : ""} |`;
    }),
    "",
    "## Preservation Candidates",
    "",
    ...formatPreservationCandidates(audit.preservationCandidates),
    "",
  ].join("\n");
}

export async function runDataAuditCli({
  argv = process.argv.slice(2),
  env = process.env,
  mode = "audit",
  client,
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp(mode);
    return 0;
  }
  if (mode === "hygiene" && args.apply) {
    assertDataResetApproval(args);
  }

  const mergedEnv = mergeEnvs(
    env,
    ...args.envFiles.map((envFile) => loadEnvFile(envFile)),
  );
  const runtimeClient = client ??
    createSupabaseClientFromEnv(mergedEnv, { proxyUrl: args.proxyUrl });
  const resetRequested = args.apply || args.resetAll;
  const rows = await fetchDataAuditRows({
    client: runtimeClient,
    limit: args.limit,
    fetchAll: resetRequested,
  });
  const audit = summarizeDataAudit(rows);

  if (mode === "audit") {
    printResult(audit, args.format, formatDataAuditMarkdown);
  } else {
    const actions = planDataHygieneActions(rows, audit);
    if (resetRequested) {
      const storageObjects = await fetchStorageAuditObjects({
        client: runtimeClient,
        limit: args.limit,
      });
      const runId = args.runId ?? createDataResetRunId(new Date());
      const target = assertHostedWriteAllowed({
        command: "data_hygiene",
        baseUrl: args.targetBaseUrl ?? readTargetBaseUrl(mergedEnv),
        allowHostedWrite: args.apply ? args.allowHostedWrite : true,
      });
      if (args.confirmTarget && args.confirmTarget !== target.baseUrl) {
        throw new Error("data_hygiene_confirm_target_mismatch");
      }
      const targetSummary = writeTargetSummary({
        command: "data_hygiene",
        target,
        runId,
        writeMode: args.apply ? "apply_reset" : "dry_run_reset",
      });
      const plan = planDataReset(rows);
      const storagePlan = planStorageReset(storageObjects);
      const results = args.apply
        ? await applyDataReset({ client: runtimeClient, plan, runId })
        : undefined;
      const storageResults = args.apply
        ? await applyStorageReset({ client: runtimeClient, plan: storagePlan, runId })
        : undefined;
      printResult(
        { audit, plan, storagePlan, results, storageResults, targetSummary },
        args.format,
        (result) => formatDataResetMarkdown(result),
      );
    } else {
      printResult({ audit, actions }, args.format, (result) =>
        formatDataHygieneMarkdown(result.actions),
      );
    }
  }

  return 0;
}

async function selectRows(client, table, columns, limit, { fetchAll = false } = {}) {
  if (!fetchAll) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error && isMissingTableError(error)) return [];
    if (error) throw new Error(`supabase_select_failed:${table}:${error.message}`);
    return data ?? [];
  }

  const rows = [];
  const pageSize = limit;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error && isMissingTableError(error)) return [];
    if (error) throw new Error(`supabase_select_failed:${table}:${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function listStorageObjects({ client, bucket, prefix = "", limit, depth = 0 }) {
  const bucketClient = client.storage?.from?.(bucket);
  if (!bucketClient?.list) return [];

  const objects = [];
  const pageSize = limit;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucketClient.list(prefix || undefined, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error && isMissingStorageBucketError(error)) return [];
    if (error) throw new Error(`storage_list_failed:${bucket}:${error.message}`);

    const page = data ?? [];
    for (const item of page) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (!path) continue;
      if (isStorageFolder(item) && depth < 8) {
        objects.push(
          ...(await listStorageObjects({
            client,
            bucket,
            prefix: path,
            limit,
            depth: depth + 1,
          })),
        );
      } else {
        objects.push({
          bucket,
          path,
          id: item.id,
          updatedAt: item.updated_at,
          createdAt: item.created_at,
          metadata: item.metadata ?? {},
        });
      }
    }

    if (page.length < pageSize) break;
  }
  return objects;
}

function isStorageFolder(item) {
  return !item.id && !item.metadata && !item.created_at && !item.updated_at;
}

function isMissingTableError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("not found") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

function isMissingStorageBucketError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return message.includes("not found") || message.includes("does not exist");
}

function createSupabaseClientFromEnv(env, { proxyUrl } = {}) {
  const supabaseUrl =
    env.NEXT_PUBLIC_SUPABASE_URL?.trim() ??
    env.SUPABASE_URL?.trim() ??
    env.SUPA_URL?.trim();
  const supabaseSecretKey =
    env.SUPABASE_SECRET_KEY?.trim() ??
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    env.SUPA_SERVICE_KEY?.trim();
  if (!supabaseUrl) throw new Error("missing_next_public_supabase_url");
  if (!supabaseSecretKey) throw new Error("missing_supabase_secret_key");
  const options = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
  if (proxyUrl) options.global = { fetch: createCurlProxyFetch(proxyUrl) };
  return createClient(supabaseUrl, supabaseSecretKey, options);
}

function parseArgs(argv) {
  const args = {
    envFiles: [],
    format: "markdown",
    limit: defaultLimit,
    dryRun: true,
    apply: false,
    resetAll: false,
    allowHostedWrite: false,
    confirmCleanup: undefined,
    confirmTarget: undefined,
    targetBaseUrl: undefined,
    runId: undefined,
    proxyUrl: undefined,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--env-file") {
      args.envFiles.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--format") {
      const value = requiredValue(argv, index, arg);
      if (!["markdown", "json"].includes(value)) throw new Error(`invalid_format:${value}`);
      args.format = value;
      index += 1;
    } else if (arg === "--limit") {
      const value = Number.parseInt(requiredValue(argv, index, arg), 10);
      if (!Number.isInteger(value) || value < 1 || value > 10_000) {
        throw new Error(`invalid_limit:${argv[index + 1]}`);
      }
      args.limit = value;
      index += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--apply") {
      args.apply = true;
      args.dryRun = false;
      args.resetAll = true;
    } else if (arg === "--reset-all-event-data") {
      args.resetAll = true;
    } else if (arg === "--allow-hosted-write") {
      args.allowHostedWrite = true;
    } else if (arg === "--confirm-cleanup") {
      args.confirmCleanup = requiredValue(argv, index, arg);
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
    } else if (arg === "--proxy-url") {
      args.proxyUrl = requiredValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }
  return args;
}

function printHelp(mode) {
  const command = mode === "hygiene" ? "pnpm data:hygiene" : "pnpm data:audit";
  console.log(`Usage: ${command} -- --env-file .env.local [options]

${mode === "hygiene" ? "Builds a dry-run data hygiene action plan." : "Audits Supabase data without writing."}

Options:
  --env-file <path>  Dotenv file to merge. May be repeated.
  --format <type>    markdown or json. Default markdown.
  --limit <n>        Max rows per table to inspect. Default ${defaultLimit}.
  --dry-run          Hygiene mode default; performs no writes.
  --reset-all-event-data
                    Build a reset plan for current event pipeline data.
  --apply            Apply reset plan. Requires explicit approval flags.
  --allow-hosted-write
                    Required when target is preview/hosted/production.
  --confirm-cleanup DELETE_EVENT_PIPELINE_DATA
                    Required for --apply.
  --confirm-target <url>
                    Required for --apply and must match target base URL.
  --target-base-url <url>
                    Explicit target base URL for write guarding.
  --run-id <id>      Optional reset run id printed in the report.
  --proxy-url <url>  Optional HTTP proxy for Supabase REST/storage calls.
  --help             Show this help text.`);
}

function assertDataResetApproval(args) {
  if (!args.resetAll) throw new Error("data_hygiene_apply_requires_reset_plan");
  if (args.confirmCleanup !== "DELETE_EVENT_PIPELINE_DATA") {
    throw new Error("data_hygiene_apply_requires_confirm_cleanup");
  }
  if (!args.confirmTarget) {
    throw new Error("data_hygiene_apply_requires_confirm_target");
  }
}

function readTargetBaseUrl(env) {
  return (
    env.NEXT_PUBLIC_APP_URL?.trim() ??
    env.APP_BASE_URL?.trim() ??
    ""
  );
}

function createDataResetRunId(now) {
  return `data-reset-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function printResult(result, format, markdownFormatter) {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(markdownFormatter(result));
  }
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function duplicateGroups(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key.trim()) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .filter(([, groupRows]) => groupRows.length > 1)
    .map(([key, groupRows]) => ({ key, rows: groupRows }));
}

function summarizeRows(rows) {
  return rows.slice(0, 50).map((row) => ({
    id: row.id,
    title: row.title,
    articleUrl: row.article_url ?? row.canonical_url,
    sourceUrl: row.source_url,
    role: row.role,
  }));
}

function isBrokenEvidenceUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (/["'<>]|&#34;|&quot;|&apos;/i.test(text)) return true;
  try {
    new URL(text.replace(/&amp;/g, "&"));
    return false;
  } catch {
    return true;
  }
}

function isLocalProxyEvidenceUrl(value) {
  const text = String(value ?? "").trim().replace(/&amp;/g, "&");
  if (!text) return false;
  try {
    const url = new URL(text);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function chooseDraftToKeep(drafts) {
  return [...drafts].sort((left, right) => {
    const confidenceDelta = Number(right.confidence ?? 0) - Number(left.confidence ?? 0);
    if (confidenceDelta !== 0) return confidenceDelta;
    return String(left.created_at ?? "").localeCompare(String(right.created_at ?? ""));
  })[0];
}

function normalizeTitle(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function buildPreservationCandidates(rows, context) {
  const candidates = new Map();
  for (const draft of context.likelyNegativeDrafts) {
    addPreservationCandidate(candidates, {
      reason: "likely_negative_draft",
      articleUrl: draft.article_url,
      title: draft.title,
      table: "event_drafts",
      id: draft.id,
    });
  }
  for (const article of rows.excludedArticles ?? []) {
    addPreservationCandidate(candidates, {
      reason: "excluded_article",
      articleUrl: article.article_url,
      title: article.triage_decision,
      table: "excluded_articles",
      id: article.id,
    });
  }
  return [...candidates.values()];
}

function scopedRows(rows) {
  return [
    ["event_drafts", rows.eventDrafts],
    ["excluded_articles", rows.excludedArticles],
    ["evidence_assets", rows.evidenceAssets],
    ["canonical_events", rows.canonicalEvents],
    ["article_bundles", rows.articleBundles],
    ["processing_ledger", rows.processingLedger],
    ["dedupe_decisions", rows.dedupeDecisions],
    ["llm_usage_ledger", rows.llmUsageLedger],
    ["evaluation_runs", rows.evaluationRuns],
    ["evaluation_case_results", rows.evaluationCaseResults],
    ["source_channels", rows.sourceChannels],
    ["source_runs", rows.sourceRuns],
    ["collector_failures", rows.collectorFailures],
    ["collector_jobs", rows.collectorJobs],
  ].flatMap(([table, tableRows]) =>
    (tableRows ?? []).map((row) => ({
      table,
      id: row.id,
      dataClass: row.data_class,
    }))
  );
}

function validBundleStorageNamespace(bundle) {
  const dataClass = String(bundle.data_class ?? "").trim();
  const bucket = String(bundle.storage_bucket ?? "article-bundles").trim();
  const prefix = String(bundle.storage_prefix ?? "").trim();
  if (!allowedDataClasses.has(dataClass)) return false;
  return prefix.startsWith(`${bucket}/${dataClass}/`);
}

function validEvidenceStorageNamespace(asset) {
  const dataClass = String(asset.data_class ?? "").trim();
  const path = String(asset.storage_path ?? "").trim();
  if (!path) return true;
  if (!allowedDataClasses.has(dataClass)) return false;
  return path.startsWith(`${dataClass}/`);
}

function addPreservationCandidate(candidates, candidate) {
  const key = `${candidate.articleUrl ?? ""}\u0000${candidate.table}\u0000${candidate.id}`;
  if (!candidate.articleUrl && !candidate.title) return;
  candidates.set(key, candidate);
}

function formatPreservationCandidates(candidates) {
  if (!candidates?.length) return ["_None_"];
  return candidates
    .slice(0, 40)
    .map(
      (candidate) =>
        `- ${candidate.reason} ${candidate.table}#${candidate.id}: ${candidate.title ?? candidate.articleUrl ?? "untitled"}`,
    );
}

function normalizeBaseUrl(value) {
  return new URL(String(value ?? "").trim()).toString().replace(/\/+$/, "");
}

function formatCounts(counts) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "_None_";
  return [
    "| Value | Count |",
    "| --- | ---: |",
    ...entries
      .sort((left, right) => right[1] - left[1])
      .map(([key, count]) => `| ${key} | ${count} |`),
  ].join("\n");
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function formatDuplicateGroups(groups) {
  if (groups.length === 0) return ["_None_"];
  return groups
    .slice(0, 20)
    .map(
      (group) =>
        `- ${group.count} drafts for "${group.title || group.articleUrl}" ids=${group.draftIds.join(",")}`,
    );
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
  return value;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const [modeArg, ...rest] = process.argv.slice(2);
  const mode =
    modeArg === "hygiene" || modeArg === "reset" ? "hygiene" : "audit";
  const argv =
    modeArg === "audit" || modeArg === "hygiene"
      ? rest
      : modeArg === "reset"
        ? ["--reset-all-event-data", ...rest]
        : process.argv.slice(2);
  runDataAuditCli({ argv, mode }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
