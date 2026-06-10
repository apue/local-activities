import { describe, expect, it, vi } from "vitest";

import {
  fetchDataAuditRows,
  formatDataAuditMarkdown,
  formatDataHygieneMarkdown,
  formatDataResetMarkdown,
  planDataReset,
  planDataHygieneActions,
  runDataAuditCli,
  summarizeDataAudit,
} from "./data-hygiene.mjs";

function fixtureRows() {
  return {
    eventDrafts: [
      {
        id: 1,
        data_class: "production",
        article_url: "https://mp.weixin.qq.com/s/real-event",
        title: "北平机器·友谊万岁精酿啤酒节",
        review_state: "pending",
        processing_state: "ready_for_review",
        triage_decision: null,
        confidence: 0.71,
        created_at: "2026-06-03T00:00:00.000Z",
      },
      {
        id: 2,
        data_class: "production",
        article_url: "https://mp.weixin.qq.com/s/real-event",
        title: " 北平机器·友谊万岁精酿啤酒节 ",
        review_state: "pending",
        processing_state: "ready_for_review",
        triage_decision: "event",
        confidence: 0.92,
        created_at: "2026-06-04T00:00:00.000Z",
      },
      {
        id: 3,
        data_class: "production",
        article_url: "https://mp.weixin.qq.com/s/official-visit",
        title: "德国联邦经济和能源部长卡特琳娜·赖希北京访问行程",
        review_state: "pending",
        processing_state: "ready_for_review",
        triage_decision: "event",
        confidence: 0.64,
        created_at: "2026-06-04T01:00:00.000Z",
      },
      {
        id: 4,
        data_class: "production",
        article_url: "https://mp.weixin.qq.com/s/real-long-running",
        title: "长期展览样本",
        review_state: "pending",
        processing_state: "ready_for_review",
        triage_decision: "event",
        confidence: 0.99,
        created_at: "2026-06-04T02:00:00.000Z",
      },
    ],
    excludedArticles: [
      {
        id: 10,
        data_class: "production",
        article_url: "https://mp.weixin.qq.com/s/news",
        triage_decision: "not_public_event",
        confidence: 0.96,
        processing_state: "excluded",
        created_at: "2026-06-04T03:00:00.000Z",
      },
    ],
    evidenceAssets: [
      {
        id: 30,
        data_class: "production",
        article_url: "https://mp.weixin.qq.com/s/real-event",
        role: "poster",
        storage_bucket: "event-evidence-assets",
        storage_path: "production/articles/bundle-real/asset-poster.png",
        source_url: "https://mmbiz.qpic.cn/mmbiz_png/poster",
        created_at: "2026-06-04T05:00:00.000Z",
      },
      {
        id: 31,
        data_class: "production",
        article_url: "https://mp.weixin.qq.com/s/real-event",
        role: "qr_code",
        storage_bucket: "event-evidence-assets",
        storage_path: "production/articles/bundle-real/asset-broken.png",
        source_url: "https://mp.weixin.qq.com/&#34;http://127.0.0.1:4000/img-proxy/?k=bad",
        created_at: "2026-06-04T06:00:00.000Z",
      },
      {
        id: 32,
        data_class: "production",
        article_url: "https://mp.weixin.qq.com/s/real-event",
        role: "registration_qr",
        source_url: "http://localhost:4000/img-proxy/?k=local",
        storage_bucket: "event-evidence-assets",
        storage_path: "articles/bundle-real/asset-qr.png",
        created_at: "2026-06-04T07:00:00.000Z",
      },
    ],
    canonicalEvents: [
      {
        id: 40,
        data_class: "production",
        event_id: "event-real",
        title: "真实活动样本",
        source_url: "https://mp.weixin.qq.com/s/real-event",
        created_at: "2026-06-04T08:00:00.000Z",
      },
    ],
    articleBundles: [
      {
        id: 45,
        data_class: "production",
        bundle_id: "bundle-real",
        source_url: "https://mp.weixin.qq.com/s/real-event",
        canonical_url: "https://mp.weixin.qq.com/s/real-event",
        content_hash: "sha256:bundle",
        storage_bucket: "article-bundles",
        storage_prefix: "wechat2rss/bundle-real",
        status: "processed",
        created_at: "2026-06-04T08:10:00.000Z",
      },
    ],
    processingLedger: [
      {
        id: 46,
        data_class: "production",
        ledger_id: "ledger-real",
        article_bundle_id: "bundle-real",
        source_url: "https://mp.weixin.qq.com/s/real-event",
        state: "needs_review",
        decision: "possible_public_activity",
        created_at: "2026-06-04T08:11:00.000Z",
      },
    ],
    dedupeDecisions: [
      {
        id: 47,
        data_class: "production",
        dedupe_id: "dedupe-real",
        draft_id: "draft-real",
        canonical_event_id: "event-real",
        decision: "same_event",
        created_at: "2026-06-04T08:12:00.000Z",
      },
    ],
    llmUsageLedger: [
      {
        id: 48,
        data_class: "production",
        usage_id: "usage-real",
        operation: "event_extraction",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        status: "succeeded",
        recorded_at: "2026-06-04T08:13:00.000Z",
        created_at: "2026-06-04T08:13:00.000Z",
      },
    ],
    evaluationRuns: [
      {
        id: 49,
        data_class: "eval",
        run_id: "eval-run-real",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        status: "completed",
        created_at: "2026-06-04T08:14:00.000Z",
      },
    ],
    evaluationCaseResults: [
      {
        id: 51,
        data_class: "eval",
        result_id: "eval-result-real",
        run_id: "eval-run-real",
        case_id: "qr-registration-poster",
        created_at: "2026-06-04T08:15:00.000Z",
      },
    ],
    sourceChannels: [
      {
        id: 52,
        data_class: "production",
        source_id: "source-real",
        source_provider: "wechat2rss",
        source_name: "Real Source",
        source_url: "https://mp.weixin.qq.com/s/source-real",
        status: "active",
        created_at: "2026-06-04T08:16:00.000Z",
      },
    ],
    sourceRuns: [
      {
        id: 50,
        data_class: "production",
        run_id: "run-real",
        status: "success",
        seed_url: "https://mp.weixin.qq.com/s/real-event",
        started_at: "2026-06-04T08:00:00.000Z",
        finished_at: "2026-06-04T08:01:00.000Z",
        created_at: "2026-06-04T08:00:00.000Z",
      },
    ],
    collectorFailures: [
      {
        id: 60,
        data_class: "production",
        failure_id: "failure-real",
        article_url: "https://mp.weixin.qq.com/s/failure-real",
        stage: "analysis",
        reason: "analysis_response_invalid_schema",
        created_at: "2026-06-04T09:00:00.000Z",
      },
    ],
    collectorJobs: [
      {
        id: 70,
        data_class: "production",
        job_id: "job-real",
        seed_url: "https://mp.weixin.qq.com/s/job-real",
        state: "completed",
        requested_at: "2026-06-04T09:00:00.000Z",
        finished_at: "2026-06-04T09:01:00.000Z",
        created_at: "2026-06-04T09:00:00.000Z",
      },
    ],
  };
}

describe("data hygiene audit", () => {
  it("summarizes dirty data signals from Supabase rows", () => {
    const audit = summarizeDataAudit(fixtureRows());

    expect(audit.tableCounts.eventDrafts).toBe(4);
    expect(audit.tableCounts.articleBundles).toBe(1);
    expect(audit.tableCounts.llmUsageLedger).toBe(1);
    expect(audit.tableCounts.evaluationRuns).toBe(1);
    expect(audit.tableCounts.sourceRuns).toBe(1);
    expect(audit.draftTriageDecisions).toEqual({
      missing: 1,
      event: 3,
    });
    expect(audit.dirtySignals).toMatchObject({
      missingTriageDraftCount: 1,
      duplicateDraftGroupCount: 1,
      likelyNegativeDraftCount: 1,
      invalidDataClassRowCount: 0,
      storageNamespaceMismatchCount: 2,
      brokenEvidenceUrlCount: 1,
      localProxyEvidenceUrlCount: 1,
      excludedArticleCount: 1,
      articleBundleCount: 1,
      processingLedgerCount: 1,
      dedupeDecisionCount: 1,
      llmUsageLedgerCount: 1,
      evaluationRunCount: 1,
      evaluationCaseResultCount: 1,
      sourceChannelCount: 1,
      sourceRunCount: 1,
      collectorFailureCount: 1,
      collectorJobCount: 1,
    });
    expect(audit.duplicateDraftGroups[0]).toMatchObject({
      articleUrl: "https://mp.weixin.qq.com/s/real-event",
      count: 2,
      draftIds: [1, 2],
    });
  });

  it("plans only non-mutating cleanup recommendations", () => {
    const rows = fixtureRows();
    const actions = planDataHygieneActions(rows);
    const actionNames = actions.map((action) => action.action);

    expect(actionNames).toContain("review_incomplete_pipeline_metadata");
    expect(actionNames).toContain("review_duplicate_draft");
    expect(actionNames).toContain("review_possible_negative_draft");
    expect(actionNames).toContain("repair_or_drop_broken_evidence_url");
    expect(actionNames).toContain("recapture_or_upload_local_proxy_evidence");
    expect(actionNames).toContain("repair_storage_namespace_mismatch");
    expect(actions.every((action) => action.applySupported === false)).toBe(true);
    expect(actions.find((action) => action.action === "review_duplicate_draft")).toMatchObject({
      id: 1,
      keepId: 2,
    });
  });

  it("formats audit and hygiene output for operators", () => {
    const rows = fixtureRows();
    const audit = summarizeDataAudit(rows);
    const actions = planDataHygieneActions(rows, audit);

    expect(formatDataAuditMarkdown(audit)).toContain("## Dirty Signals");
    expect(formatDataAuditMarkdown(audit)).toContain("| event_drafts | 4 |");
    expect(formatDataHygieneMarkdown(actions)).toContain("No writes were performed");
    expect(formatDataHygieneMarkdown(actions)).toContain("review_duplicate_draft");
  });

  it("builds a reset plan for product, ledger, usage, evaluation, and source data", () => {
    const plan = planDataReset(fixtureRows());

    expect(plan).toContainEqual({
      table: "canonical_events",
      idColumn: "id",
      ids: [40],
    });
    expect(plan).toContainEqual({
      table: "llm_usage_ledger",
      idColumn: "id",
      ids: [48],
    });
    expect(plan).toContainEqual({
      table: "evaluation_runs",
      idColumn: "id",
      ids: [49],
    });
    expect(plan).toContainEqual({
      table: "collector_jobs",
      idColumn: "id",
      ids: [70],
    });
    expect(
      formatDataResetMarkdown({
        targetSummary:
          "command=data_hygiene target=test baseUrl=https://activities.example runId=reset-1 writeMode=dry_run_reset",
        audit: summarizeDataAudit(fixtureRows()),
        plan,
      }),
    ).toContain("ledger, usage, evaluation, and storage data");
  });

  it("uses limit only as a page size for reset row collection", async () => {
    const calls = [];
    const rows = await fetchDataAuditRows({
      client: supabaseClientForReset(fixtureRows(), calls),
      limit: 2,
      fetchAll: true,
    });

    expect(rows.eventDrafts).toHaveLength(4);
    expect(
      calls.filter(
        (call) => call[0] === "range" && call[1] === "event_drafts",
      ),
    ).toEqual([
      ["range", "event_drafts", 0, 1],
      ["range", "event_drafts", 2, 3],
      ["range", "event_drafts", 4, 5],
    ]);

    const limitedRows = await fetchDataAuditRows({
      client: supabaseClientForReset(fixtureRows(), []),
      limit: 2,
    });
    expect(limitedRows.eventDrafts).toHaveLength(2);
  });

  it("refuses apply mode before creating a Supabase client", async () => {
    const client = { from: vi.fn() };

    await expect(
      runDataAuditCli({
        mode: "hygiene",
        argv: ["--apply"],
        env: {},
        client,
      }),
    ).rejects.toThrow("data_hygiene_apply_requires_confirm_cleanup");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("refuses apply mode without explicit cleanup and target confirmation", async () => {
    const client = { from: vi.fn() };

    await expect(
      runDataAuditCli({
        mode: "hygiene",
        argv: ["--apply", "--allow-hosted-write"],
        env: {
          APP_BASE_URL: "https://local-activities.vercel.app",
        },
        client,
      }),
    ).rejects.toThrow("data_hygiene_apply_requires_confirm_cleanup");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("applies a confirmed reset plan through guarded table deletes", async () => {
    const calls = [];
    await expect(
      runDataAuditCli({
        mode: "hygiene",
        argv: [
          "--apply",
          "--limit",
          "1",
          "--allow-hosted-write",
          "--confirm-cleanup",
          "DELETE_EVENT_PIPELINE_DATA",
          "--confirm-target",
          "https://local-activities.vercel.app",
          "--run-id",
          "data-reset-test",
        ],
        env: {
          APP_BASE_URL: "https://local-activities.vercel.app",
        },
        client: supabaseClientForReset(fixtureRows(), calls),
      }),
    ).resolves.toBe(0);

    expect(calls.filter((call) => call[0] === "delete").map((call) => call[1]))
      .toEqual([
        "evaluation_case_results",
        "evaluation_runs",
        "dedupe_decisions",
        "processing_ledger",
        "llm_usage_ledger",
        "canonical_events",
        "event_drafts",
        "excluded_articles",
        "evidence_assets",
        "article_bundles",
        "collector_failures",
        "source_runs",
        "collector_jobs",
        "source_channels",
      ]);
  });

  it("allows hosted reset dry-run without the hosted write flag", async () => {
    const calls = [];

    await expect(
      runDataAuditCli({
        mode: "hygiene",
        argv: [
          "--reset-all-event-data",
          "--target-base-url",
          "https://local-activities.vercel.app",
          "--run-id",
          "data-reset-dry-run",
        ],
        env: {},
        client: supabaseClientForReset(fixtureRows(), calls),
      }),
    ).resolves.toBe(0);

    expect(calls.some((call) => call[0] === "delete")).toBe(false);
  });

  it("applies storage reset plans with deleted path counts", async () => {
    const calls = [];

    await expect(
      runDataAuditCli({
        mode: "hygiene",
        argv: [
          "--apply",
          "--limit",
          "1",
          "--allow-hosted-write",
          "--confirm-cleanup",
          "DELETE_EVENT_PIPELINE_DATA",
          "--confirm-target",
          "https://local-activities.vercel.app",
          "--run-id",
          "storage-reset-test",
        ],
        env: {
          APP_BASE_URL: "https://local-activities.vercel.app",
        },
        client: supabaseClientForReset(
          fixtureRows(),
          calls,
          {
            "article-bundles": [{ name: "bundle.json", id: "object-1" }],
            "event-evidence-assets": [
              { name: "poster.png", id: "object-2" },
              { name: "qr.png", id: "object-3" },
            ],
            "eval-artifacts": [],
          },
        ),
      }),
    ).resolves.toBe(0);

    expect(calls).toContainEqual([
      "storage-remove",
      "article-bundles",
      ["bundle.json"],
    ]);
    expect(calls).toContainEqual([
      "storage-remove",
      "event-evidence-assets",
      ["poster.png", "qr.png"],
    ]);
    expect(
      calls.filter(
        (call) => call[0] === "storage-list" && call[1] === "event-evidence-assets",
      ),
    ).toEqual([
      ["storage-list", "event-evidence-assets", undefined, 0],
      ["storage-list", "event-evidence-assets", undefined, 1],
      ["storage-list", "event-evidence-assets", undefined, 2],
    ]);
  });
});

function supabaseClientForReset(rows, calls, storageObjects = {}) {
  const tableRows = {
    evaluation_case_results: rows.evaluationCaseResults,
    evaluation_runs: rows.evaluationRuns,
    dedupe_decisions: rows.dedupeDecisions,
    processing_ledger: rows.processingLedger,
    llm_usage_ledger: rows.llmUsageLedger,
    event_drafts: rows.eventDrafts,
    excluded_articles: rows.excludedArticles,
    evidence_assets: rows.evidenceAssets,
    canonical_events: rows.canonicalEvents,
    article_bundles: rows.articleBundles,
    source_runs: rows.sourceRuns,
    collector_failures: rows.collectorFailures,
    collector_jobs: rows.collectorJobs,
    source_channels: rows.sourceChannels,
  };
  return {
    storage: {
      from(bucket) {
        return {
          async list(prefix, options = {}) {
            const offset = options.offset ?? 0;
            const limit = options.limit ?? 1_000;
            calls.push(["storage-list", bucket, prefix, offset]);
            return {
              data: (storageObjects[bucket] ?? []).slice(offset, offset + limit),
              error: null,
            };
          },
          async remove(paths) {
            calls.push(["storage-remove", bucket, paths]);
            return {
              data: paths.map((name) => ({ name })),
              error: null,
            };
          },
        };
      },
    },
    from(table) {
      const query = {
        selectedRows: tableRows[table] ?? [],
        deleteMode: false,
        selectedIds: [],
        select() {
          calls.push(["select", table]);
          return query;
        },
        order() {
          calls.push(["order", table]);
          return query;
        },
        limit(count) {
          calls.push(["limit", table, count]);
          return Promise.resolve({
            data: query.selectedRows.slice(0, count),
            error: null,
          });
        },
        range(from, to) {
          calls.push(["range", table, from, to]);
          return Promise.resolve({
            data: query.selectedRows.slice(from, to + 1),
            error: null,
          });
        },
        delete() {
          calls.push(["delete", table]);
          query.deleteMode = true;
          return query;
        },
        in(column, ids) {
          calls.push(["in", table, column, ids]);
          query.selectedIds = ids;
          return query;
        },
      };
      query.select = function select() {
        calls.push(["select", table]);
        if (query.deleteMode) {
          return Promise.resolve({
            data: query.selectedIds.map((id) => ({ id })),
            error: null,
          });
        }
        return query;
      };
      return query;
    },
  };
}
