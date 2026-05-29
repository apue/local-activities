import { describe, expect, it } from "vitest";

import { getSupabaseAdminStore } from "./supabase-admin-store";

describe("supabase admin store", () => {
  it("maps collector job result fields for admin smoke verification", async () => {
    const store = getSupabaseAdminStore(
      supabaseClientReturning([
        {
          id: 1,
          job_id: "job-1",
          seed_url: "https://example.com/a",
          state: "failed",
          requested_at: "2026-05-28T08:00:00.000Z",
          claimed_at: "2026-05-28T08:01:00.000Z",
          lease_expires_at: "2026-05-28T08:20:00.000Z",
          collector_id: "sandbox-job-1",
          local_run_id: "sandbox-job-1-1",
          attempt_number: 1,
          last_heartbeat_at: null,
          last_heartbeat_stage: null,
          suggested_disposition: "failed",
          source_run_id: "run-1",
          article_snapshot_ids: ["snapshot-1"],
          event_draft_ids: [],
          evidence_asset_ids: ["evidence-1"],
          failure_ids: ["failure-1"],
          result_message: "Structured failure uploaded.",
          finished_at: "2026-05-28T08:02:00.000Z",
          preferred_runner: "vercel_sandbox",
          actual_runner: "vercel_sandbox",
          runner_state: "failed",
          fallback_eligible: false,
          fallback_reason: null,
          sandbox_run_id: "sb-1",
        },
      ]),
    );

    await expect(store.listCollectorJobs()).resolves.toMatchObject([
      {
        jobId: "job-1",
        sourceRunId: "run-1",
        articleSnapshotIds: ["snapshot-1"],
        eventDraftIds: [],
        evidenceAssetIds: ["evidence-1"],
        failureIds: ["failure-1"],
        finishedAt: "2026-05-28T08:02:00.000Z",
      },
    ]);
  });
});

function supabaseClientReturning(rows: unknown[]) {
  const query = {
    select() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };

  return {
    from(table: string) {
      expect(table).toBe("collector_jobs");
      return query;
    },
  } as never;
}
