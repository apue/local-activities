#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

const defaultLimit = 1_000;

const likelyTestPattern =
  /\/s\/(example|local|job|text|activity|agent-smoke|e2e-fixture)|example\.com|activities\.example/i;
const likelyNegativeDraftPattern =
  /部长|访问|会见|声明|认可|无口蹄疫|食品展|回顾|新闻|president|minister|official visit|statement|trade/i;

export async function fetchDataAuditRows({ client, limit = defaultLimit }) {
  const [
    eventDrafts,
    excludedArticles,
    articleSnapshots,
    evidenceAssets,
    canonicalEvents,
  ] = await Promise.all([
    selectRows(
      client,
      "event_drafts",
      "id,draft_id,article_url,title,review_state,processing_state,triage_decision,triage_action,public_eligibility,confidence,created_at,poster_asset_id,qr_asset_id,registration_qr_asset_id",
      limit,
    ),
    selectRows(
      client,
      "excluded_articles",
      "id,article_url,triage_decision,confidence,processing_state,created_at",
      limit,
    ),
    selectRows(
      client,
      "article_snapshots",
      "id,canonical_url,title,author_name,capture_mode,created_at",
      limit,
    ),
    selectRows(
      client,
      "evidence_assets",
      "id,article_url,role,media_type,source_url,storage_path,created_at",
      limit,
    ),
    selectRows(
      client,
      "canonical_events",
      "id,event_id,title,source_url,created_at",
      limit,
    ),
  ]);

  return {
    eventDrafts,
    excludedArticles,
    articleSnapshots,
    evidenceAssets,
    canonicalEvents,
  };
}

export function summarizeDataAudit(rows) {
  const eventDrafts = rows.eventDrafts ?? [];
  const excludedArticles = rows.excludedArticles ?? [];
  const articleSnapshots = rows.articleSnapshots ?? [];
  const evidenceAssets = rows.evidenceAssets ?? [];
  const canonicalEvents = rows.canonicalEvents ?? [];

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
  const likelyTestRows = [
    ...eventDrafts
      .filter((draft) => likelyTestPattern.test(draft.article_url ?? ""))
      .map((draft) => ({ table: "event_drafts", id: draft.id, url: draft.article_url })),
    ...articleSnapshots
      .filter((snapshot) => likelyTestPattern.test(snapshot.canonical_url ?? ""))
      .map((snapshot) => ({
        table: "article_snapshots",
        id: snapshot.id,
        url: snapshot.canonical_url,
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
      articleSnapshots: articleSnapshots.length,
      evidenceAssets: evidenceAssets.length,
      canonicalEvents: canonicalEvents.length,
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
    snapshotCaptureModes: countBy(
      articleSnapshots,
      (snapshot) => snapshot.capture_mode ?? "unknown",
    ),
    evidenceRoles: countBy(evidenceAssets, (asset) => asset.role ?? "unknown"),
    duplicateDraftGroups,
    missingTriageDrafts: summarizeRows(missingTriageDrafts),
    likelyNegativeDrafts: summarizeRows(likelyNegativeDrafts),
    likelyTestRows,
    brokenEvidenceUrls: summarizeRows(brokenEvidenceUrls),
    localProxyEvidenceUrls: summarizeRows(localProxyEvidenceUrls),
    dirtySignals: {
      missingTriageDraftCount: missingTriageDrafts.length,
      duplicateDraftGroupCount: duplicateDraftGroups.length,
      likelyNegativeDraftCount: likelyNegativeDrafts.length,
      likelyTestRowCount: likelyTestRows.length,
      brokenEvidenceUrlCount: brokenEvidenceUrls.length,
      localProxyEvidenceUrlCount: localProxyEvidenceUrls.length,
      excludedArticleCount: excludedArticles.length,
    },
  };
}

export function planDataHygieneActions(rows, audit = summarizeDataAudit(rows)) {
  const actions = [];
  const eventDrafts = rows.eventDrafts ?? [];
  const evidenceAssets = rows.evidenceAssets ?? [];

  for (const draft of eventDrafts.filter((draft) => !draft.triage_decision)) {
    actions.push({
      action: "retriage_legacy_draft",
      table: "event_drafts",
      id: draft.id,
      reason: "Draft predates Event Pipeline V2 triage fields or has null triage_decision.",
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

  for (const row of audit.likelyTestRows) {
    actions.push({
      action: "review_likely_test_row",
      table: row.table,
      id: row.id,
      reason: "URL looks like fixture/smoke/test data.",
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
    `| article_snapshots | ${audit.tableCounts.articleSnapshots} |`,
    `| evidence_assets | ${audit.tableCounts.evidenceAssets} |`,
    `| canonical_events | ${audit.tableCounts.canonicalEvents} |`,
    "",
    "## Dirty Signals",
    "",
    "| Signal | Count |",
    "| --- | ---: |",
    `| missing triage drafts | ${audit.dirtySignals.missingTriageDraftCount} |`,
    `| duplicate draft groups | ${audit.dirtySignals.duplicateDraftGroupCount} |`,
    `| likely negative drafts | ${audit.dirtySignals.likelyNegativeDraftCount} |`,
    `| likely test rows | ${audit.dirtySignals.likelyTestRowCount} |`,
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
    throw new Error("data_hygiene_apply_not_enabled");
  }

  const mergedEnv = mergeEnvs(
    env,
    ...args.envFiles.map((envFile) => loadEnvFile(envFile)),
  );
  const runtimeClient = client ?? createSupabaseClientFromEnv(mergedEnv);
  const rows = await fetchDataAuditRows({ client: runtimeClient, limit: args.limit });
  const audit = summarizeDataAudit(rows);

  if (mode === "audit") {
    printResult(audit, args.format, formatDataAuditMarkdown);
  } else {
    const actions = planDataHygieneActions(rows, audit);
    printResult({ audit, actions }, args.format, (result) =>
      formatDataHygieneMarkdown(result.actions),
    );
  }

  return 0;
}

async function selectRows(client, table, columns, limit) {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`supabase_select_failed:${table}:${error.message}`);
  return data ?? [];
}

function createSupabaseClientFromEnv(env) {
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
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function parseArgs(argv) {
  const args = {
    envFiles: [],
    format: "markdown",
    limit: defaultLimit,
    dryRun: true,
    apply: false,
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
  --apply            Refused for now; cleanup policy needs explicit approval.
  --help             Show this help text.`);
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
  const mode = modeArg === "hygiene" ? "hygiene" : "audit";
  const argv = modeArg === "audit" || modeArg === "hygiene" ? rest : process.argv.slice(2);
  runDataAuditCli({ argv, mode }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
