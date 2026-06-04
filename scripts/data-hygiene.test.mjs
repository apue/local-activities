import { describe, expect, it, vi } from "vitest";

import {
  formatDataAuditMarkdown,
  formatDataHygieneMarkdown,
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
        article_url: "https://mp.weixin.qq.com/s/example",
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
        created_at: "2026-06-04T07:00:00.000Z",
      },
    ],
    canonicalEvents: [],
  };
}

describe("data hygiene audit", () => {
  it("summarizes dirty data signals from Supabase rows", () => {
    const audit = summarizeDataAudit(fixtureRows());

    expect(audit.tableCounts.eventDrafts).toBe(4);
    expect(audit.draftTriageDecisions).toEqual({
      missing: 1,
      event: 3,
    });
    expect(audit.dirtySignals).toMatchObject({
      missingTriageDraftCount: 1,
      duplicateDraftGroupCount: 1,
      likelyNegativeDraftCount: 1,
      likelyTestRowCount: 2,
      brokenEvidenceUrlCount: 1,
      localProxyEvidenceUrlCount: 1,
      excludedArticleCount: 1,
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

  it("refuses apply mode before creating a Supabase client", async () => {
    const client = { from: vi.fn() };

    await expect(
      runDataAuditCli({
        mode: "hygiene",
        argv: ["--apply"],
        env: {},
        client,
      }),
    ).rejects.toThrow("data_hygiene_apply_not_enabled");
    expect(client.from).not.toHaveBeenCalled();
  });
});
