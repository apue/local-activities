import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import {
  parseAgentReportArgs,
  runAgentReportCli,
} from "./agent-report.mjs";

describe("agent report CLI", () => {
  it("exposes the package script", () => {
    expect(packageJson.scripts["agent:report"]).toBe("node scripts/agent-report.mjs");
    expect(packageJson.scripts["agent:eval"]).toBe("node scripts/pipeline-v5-eval.mjs");
  });

  it("writes JSON and Markdown report files from local artifacts", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "agent-report-cli-"));
    const auditDir = path.join(rootDir, "audit");
    const evalDir = path.join(rootDir, "eval-runs");
    const outputDir = path.join(rootDir, "report");
    const findingPath = path.join(rootDir, "evidence", "finding-001.json");
    try {
      await writeJson(path.join(auditDir, "audit-facts.json"), {
        kind: "agent_audit_facts",
        runId: "agent-audit-1",
        feedback: { totalCount: 1, openCount: 1 },
        pipelineFunnel: { byDataClass: { production: { failedCount: 1 } } },
      });
      await writeJson(path.join(auditDir, "candidate-index.json"), {
        kind: "agent_candidate_index",
        candidates: [
          {
            candidateId: "finding-001",
            candidateType: "provider_error_cluster",
            severityHint: "high",
            reason: "Provider failures.",
          },
        ],
      });
      await writeJson(path.join(auditDir, "public-snapshot.json"), {
        kind: "agent_public_snapshot",
        counts: { publishedRows: 1, publicRenderableRows: 1 },
      });
      await writeJson(path.join(auditDir, "usage-summary.json"), {
        kind: "agent_usage_summary",
        totals: { requestCount: 1, errorCount: 1, costMicroCny: 10 },
      });
      await writeFile(path.join(auditDir, "audit-brief.md"), "Brief");
      await writeJson(
        path.join(evalDir, "runs", "v5-eval-1", "summary.json"),
        {
          ok: false,
          runId: "v5-eval-1",
          passCount: 1,
          failCount: 1,
          artifactPaths: ["runs/v5-eval-1/summary.json"],
        },
      );
      await writeJson(findingPath, {
        kind: "agent_audit_finding_evidence",
        findingId: "finding-001",
        rawResponse: "do not inline",
      });

      let printed = "";
      const result = await runAgentReportCli(
        [
          "--audit-dir",
          auditDir,
          "--eval-run-id",
          "v5-eval-1",
          "--eval-artifact-dir",
          evalDir,
          "--finding-file",
          findingPath,
          "--output-dir",
          outputDir,
        ],
        {
          log: (value) => {
            printed += value;
          },
        },
        {
          now: new Date("2026-06-11T12:00:00.000Z"),
        },
      );

      const output = JSON.parse(printed);
      expect(output).toMatchObject({
        ok: true,
        reportPath: path.join(outputDir, "agent-report.json"),
        markdownPath: path.join(outputDir, "agent-report.md"),
        nextActionCount: 2,
      });
      expect(result.report.summary.status).toBe("attention_needed");
      expect(await readFile(output.markdownPath, "utf8")).toContain("v5-eval-1");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects production mutation-looking flags", () => {
    expect(() => parseAgentReportArgs(["--target", "production"])).toThrow(
      "agent_report_refuses_production_mutation_flag:--target production",
    );
    expect(() => parseAgentReportArgs(["--publish"])).toThrow(
      "agent_report_refuses_production_mutation_flag:--publish",
    );
    expect(() => parseAgentReportArgs(["--write-production"])).toThrow(
      "agent_report_refuses_production_mutation_flag:--write-production",
    );
  });
});

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
