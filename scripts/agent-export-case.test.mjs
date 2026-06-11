import { describe, expect, it } from "vitest";

import {
  parseAgentExportCaseArgs,
  runAgentExportCaseCli,
} from "./agent-export-case.mjs";

describe("agent export case CLI", () => {
  it("parses source ids, expected behavior, and default private output path", () => {
    expect(parseAgentExportCaseArgs([
      "--feedback-id",
      "feedback-1",
      "--expected-action",
      "extract",
      "--expected-event-count",
      "2",
      "--env-file",
      ".env.local",
    ])).toEqual({
      feedbackId: "feedback-1",
      expectedAction: "extract",
      expectedEventCount: 2,
      outputDir: ".local/private-corpus",
      envFiles: [".env.local"],
    });

    expect(() => parseAgentExportCaseArgs([])).toThrow(
      "agent_export_case_source_id_required",
    );
  });

  it("runs with injected Supabase client and exporter without live services", async () => {
    const logs = [];
    const result = await runAgentExportCaseCli(
      [
        "--pipeline-run-id",
        "pipe-1",
        "--article-bundle-id",
        "bundle-1",
        "--output-dir",
        "tmp/private-corpus",
        "--case-id",
        "case-1",
        "--expected-action",
        "review",
      ],
      { log: (message) => logs.push(message) },
      {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SECRET_KEY: "secret",
        },
        loadEnvFileImpl: () => ({}),
        getSupabaseAdminClientImpl: (env) => ({ env }),
        exportPrivateCorpusCaseImpl: async (input) => {
          expect(input).toMatchObject({
            pipelineRunId: "pipe-1",
            articleBundleId: "bundle-1",
            outputDir: "tmp/private-corpus",
            caseId: "case-1",
            expected: {
              action: "review",
              eventCount: 1,
            },
            store: expect.any(Object),
          });
          return {
            caseId: "case-1",
            caseDir: "tmp/private-corpus/case-1",
            manifestPath: "tmp/private-corpus/manifest.json",
          };
        },
      },
    );

    expect(result.caseId).toBe("case-1");
    expect(JSON.parse(logs[0])).toEqual({
      ok: true,
      caseId: "case-1",
      caseDir: "tmp/private-corpus/case-1",
      manifestPath: "tmp/private-corpus/manifest.json",
    });
  });
});
