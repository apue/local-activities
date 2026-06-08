import { describe, expect, it, vi } from "vitest";

import {
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
        article_url: "https://mp.weixin.qq.com/s/beiping-fixture",
        title: "Smoke fixture event",
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
        article_url: "https://mp.weixin.qq.com/s/news",
        triage_decision: "not_public_event",
        confidence: 0.96,
        processing_state: "excluded",
        created_at: "2026-06-04T03:00:00.000Z",
      },
    ],
    articleSnapshots: [
      {
        id: 20,
        canonical_url: "https://activities.example/e2e-fixture",
        title: "Fixture snapshot",
        capture_mode: "fixture",
        created_at: "2026-06-04T04:00:00.000Z",
      },
    ],
    evidenceAssets: [
      {
        id: 30,
        article_url: "https://mp.weixin.qq.com/s/real-event",
        role: "poster",
        source_url: "https://mmbiz.qpic.cn/mmbiz_png/poster",
        created_at: "2026-06-04T05:00:00.000Z",
      },
      {
        id: 31,
        article_url: "https://mp.weixin.qq.com/s/real-event",
        role: "qr_code",
        source_url: "https://mp.weixin.qq.com/&#34;http://127.0.0.1:4000/img-proxy/?k=bad",
        created_at: "2026-06-04T06:00:00.000Z",
      },
      {
        id: 32,
        article_url: "https://mp.weixin.qq.com/s/real-event",
        role: "registration_qr",
        source_url: "http://localhost:4000/img-proxy/?k=local",
        storage_path: "fixture-assets/qr-registration-poster/asset-qr.png",
        created_at: "2026-06-04T07:00:00.000Z",
      },
    ],
    canonicalEvents: [
      {
        id: 40,
        event_id: "event-fixture",
        title: "Fixture case goethe-sonic-exhibition.",
        source_url: "https://mp.weixin.qq.com/s/goethe-sonic-fixture",
        created_at: "2026-06-04T08:00:00.000Z",
      },
    ],
    sourceRuns: [
      {
        id: 50,
        run_id: "run-fixture",
        status: "success",
        seed_url: "https://mp.weixin.qq.com/s/beiping-fixture",
        started_at: "2026-06-04T08:00:00.000Z",
        finished_at: "2026-06-04T08:01:00.000Z",
        created_at: "2026-06-04T08:00:00.000Z",
      },
    ],
    collectorFailures: [
      {
        id: 60,
        failure_id: "failure-fixture",
        article_url: "https://mp.weixin.qq.com/s/failure-fixture",
        stage: "analysis",
        reason: "analysis_response_invalid_schema",
        created_at: "2026-06-04T09:00:00.000Z",
      },
    ],
    collectorJobs: [
      {
        id: 70,
        job_id: "job-fixture",
        seed_url: "https://mp.weixin.qq.com/s/job-fixture",
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
    expect(audit.tableCounts.sourceRuns).toBe(1);
    expect(audit.draftTriageDecisions).toEqual({
      missing: 1,
      event: 3,
    });
    expect(audit.dirtySignals).toMatchObject({
      missingTriageDraftCount: 1,
      duplicateDraftGroupCount: 1,
      likelyNegativeDraftCount: 1,
      likelyTestRowCount: 4,
      brokenEvidenceUrlCount: 1,
      localProxyEvidenceUrlCount: 1,
      excludedArticleCount: 1,
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

    expect(actionNames).toContain("retriage_legacy_draft");
    expect(actionNames).toContain("review_duplicate_draft");
    expect(actionNames).toContain("review_possible_negative_draft");
    expect(actionNames).toContain("repair_or_drop_broken_evidence_url");
    expect(actionNames).toContain("recapture_or_upload_local_proxy_evidence");
    expect(actionNames).toContain("review_likely_test_row");
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

  it("builds a reset plan without usage ledger deletion", () => {
    const plan = planDataReset(fixtureRows());

    expect(plan).toContainEqual({
      table: "canonical_events",
      idColumn: "id",
      ids: [40],
    });
    expect(plan).toContainEqual({
      table: "collector_jobs",
      idColumn: "id",
      ids: [70],
    });
    expect(plan.map((action) => action.table)).not.toContain("llm_usage_ledger");
    expect(
      formatDataResetMarkdown({
        targetSummary:
          "command=data_hygiene target=test baseUrl=https://activities.example runId=reset-1 writeMode=dry_run_reset",
        audit: summarizeDataAudit(fixtureRows()),
        plan,
      }),
    ).toContain("Usage ledger rows are preserved");
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
        "canonical_events",
        "event_drafts",
        "excluded_articles",
        "evidence_assets",
        "article_snapshots",
        "collector_failures",
        "source_runs",
        "collector_jobs",
      ]);
    expect(calls.map((call) => call[1])).not.toContain("llm_usage_ledger");
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
});

function supabaseClientForReset(rows, calls) {
  const tableRows = {
    event_drafts: rows.eventDrafts,
    excluded_articles: rows.excludedArticles,
    article_snapshots: rows.articleSnapshots,
    evidence_assets: rows.evidenceAssets,
    canonical_events: rows.canonicalEvents,
    source_runs: rows.sourceRuns,
    collector_failures: rows.collectorFailures,
    collector_jobs: rows.collectorJobs,
  };
  return {
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
        limit() {
          calls.push(["limit", table]);
          return Promise.resolve({ data: query.selectedRows, error: null });
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
