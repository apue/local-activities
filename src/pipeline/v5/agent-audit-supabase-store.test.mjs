import { describe, expect, it } from "vitest";

import { createSupabaseAgentAuditStore } from "./agent-audit-supabase-store.mjs";

describe("Supabase agent audit store", () => {
  it("uses read-only selects and attaches pipeline drilldown rows", async () => {
    const calls = [];
    const client = fakeSupabaseClient(calls, {
      pipeline_runs: [{
        run_id: "run-1",
        data_class: "production",
        source_id: "source-1",
        article_bundle_id: "bundle-1",
        status: "failed",
        started_at: "2026-06-10T10:00:00.000Z",
      }],
      pipeline_steps: [{
        step_id: "step-1",
        run_id: "run-1",
        data_class: "production",
        step_order: 1,
        node_name: "full_extract",
        status: "failed",
      }],
      pipeline_artifacts: [{
        artifact_id: "artifact-1",
        run_id: "run-1",
        data_class: "production",
        path: "eval-artifacts/run-1/response.json",
        kind: "full_extract_raw_response",
      }],
      pipeline_attempts: [{
        attempt_id: "attempt-1",
        run_id: "run-1",
        step_id: "step-1",
        data_class: "production",
        attempt_number: 1,
      }],
    });

    const store = createSupabaseAgentAuditStore({ client });
    const runs = await store.listPipelineRuns({
      dataClass: "production",
      startsAt: "2026-06-04T00:00:00.000Z",
      endsAt: "2026-06-11T00:00:00.000Z",
    });

    expect(runs).toEqual([
      expect.objectContaining({
        run_id: "run-1",
        steps: [
          expect.objectContaining({
            step_id: "step-1",
            attempts: [
              expect.objectContaining({
                attempt_id: "attempt-1",
              }),
            ],
          }),
        ],
        artifacts: [
          expect.objectContaining({
            artifact_id: "artifact-1",
          }),
        ],
      }),
    ]);
    expect(calls.map((call) => call.method)).toEqual(expect.arrayContaining([
      "from",
      "select",
      "eq",
      "gte",
      "lte",
      "in",
      "order",
      "limit",
    ]));
    expect(calls.map((call) => call.method)).not.toEqual(expect.arrayContaining([
      "insert",
      "update",
      "delete",
      "upsert",
      "rpc",
    ]));
  });
});

function fakeSupabaseClient(calls, rowsByTable) {
  return {
    from(table) {
      calls.push({ method: "from", table });
      return new FakeQuery({ calls, table, rows: rowsByTable[table] ?? [] });
    },
  };
}

class FakeQuery {
  constructor({ calls, table, rows }) {
    this.calls = calls;
    this.table = table;
    this.rows = rows;
  }

  select(columns) {
    this.calls.push({ method: "select", table: this.table, columns });
    return this;
  }

  eq(column, value) {
    this.calls.push({ method: "eq", table: this.table, column, value });
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  gte(column, value) {
    this.calls.push({ method: "gte", table: this.table, column, value });
    this.rows = this.rows.filter((row) => String(row[column]) >= value);
    return this;
  }

  lte(column, value) {
    this.calls.push({ method: "lte", table: this.table, column, value });
    this.rows = this.rows.filter((row) => String(row[column]) <= value);
    return this;
  }

  in(column, values) {
    this.calls.push({ method: "in", table: this.table, column, values });
    const allowed = new Set(values);
    this.rows = this.rows.filter((row) => allowed.has(row[column]));
    return this;
  }

  order(column, options) {
    this.calls.push({ method: "order", table: this.table, column, options });
    this.rows = [...this.rows].sort((a, b) => {
      const left = a[column] ?? "";
      const right = b[column] ?? "";
      return options.ascending
        ? String(left).localeCompare(String(right))
        : String(right).localeCompare(String(left));
    });
    return this;
  }

  async limit(count) {
    this.calls.push({ method: "limit", table: this.table, count });
    return { data: this.rows.slice(0, count), error: null };
  }
}
