import { describe, expect, it } from "vitest";

import {
  requiredEventPipelineV2Columns,
  runSchemaParityCheck,
} from "./schema-parity-check.mjs";

describe("schema parity check", () => {
  it("defines required Event Pipeline V2 columns by table", () => {
    expect(requiredEventPipelineV2Columns.event_drafts).toContain(
      "triage_decision",
    );
    expect(requiredEventPipelineV2Columns.event_drafts).toContain(
      "schedule_kind",
    );
    expect(requiredEventPipelineV2Columns.canonical_events).toContain(
      "hard_blockers",
    );
    expect(requiredEventPipelineV2Columns.excluded_articles).toContain(
      "processing_state",
    );
  });

  it("queries schema columns through read-only zero-row selects", async () => {
    const calls = [];
    const result = await runSchemaParityCheck({
      client: {
        from(table) {
          const query = {
            select(columns) {
              calls.push({ table, columns });
              return query;
            },
            limit(count) {
              calls.at(-1).limit = count;
              return Promise.resolve({ data: [], error: null });
            },
          };
          return query;
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: "event_drafts",
        limit: 0,
      }),
    );
    expect(calls.every((call) => call.limit === 0)).toBe(true);
  });

  it("reports missing columns without mutating data", async () => {
    const result = await runSchemaParityCheck({
      client: {
        from(table) {
          const query = {
            select(columns) {
              return query;
            },
            limit(count) {
              if (table === "event_drafts") {
                return Promise.resolve({
                  data: null,
                  error: {
                    message:
                      "Could not find the 'triage_decision' column in the schema cache",
                  },
                });
              }
              return Promise.resolve({ data: [], error: null });
            },
          };
          return query;
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContainEqual(
      expect.objectContaining({ table: "event_drafts" }),
    );
  });
});
