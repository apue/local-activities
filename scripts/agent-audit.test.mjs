import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import { runAgentAuditCli } from "./agent-audit.mjs";
import { runAgentInspectClusterCli } from "./agent-inspect-cluster.mjs";
import { runAgentInspectEventCli } from "./agent-inspect-event.mjs";
import { runAgentInspectFindingCli } from "./agent-inspect-finding.mjs";
import { runAgentInspectSourceCli } from "./agent-inspect-source.mjs";

describe("agent audit CLI", () => {
  it("exposes audit and drilldown package scripts", () => {
    expect(packageJson.scripts["agent:audit"]).toBe("node scripts/agent-audit.mjs");
    expect(packageJson.scripts["agent:inspect-finding"]).toBe("node scripts/agent-inspect-finding.mjs");
    expect(packageJson.scripts["agent:inspect-cluster"]).toBe("node scripts/agent-inspect-cluster.mjs");
    expect(packageJson.scripts["agent:inspect-event"]).toBe("node scripts/agent-inspect-event.mjs");
    expect(packageJson.scripts["agent:inspect-source"]).toBe("node scripts/agent-inspect-source.mjs");
  });

  it("writes audit packet files with an injected read-only store", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "agent-audit-cli-"));
    try {
      let printed = "";
      const result = await runAgentAuditCli(
        [
          "--days",
          "7",
          "--output-dir",
          outputDir,
          "--data-class",
          "production",
        ],
        {
          log: (value) => {
            printed += value;
          },
        },
        {
          store: emptyAuditStore(),
          now: new Date("2026-06-11T10:00:00.000Z"),
        },
      );

      const output = JSON.parse(printed);
      expect(output).toMatchObject({
        ok: true,
        runId: "agent-audit-20260611100000",
        outputDir,
        candidateCount: 1,
        paths: {
          auditFactsPath: path.join(outputDir, "audit-facts.json"),
          candidateIndexPath: path.join(outputDir, "candidate-index.json"),
          publicSnapshotPath: path.join(outputDir, "public-snapshot.json"),
          usageSummaryPath: path.join(outputDir, "usage-summary.json"),
          auditBriefPath: path.join(outputDir, "audit-brief.md"),
        },
      });
      expect(result.packet.candidateIndex.candidates[0]).toMatchObject({
        candidateId: "finding-001",
        candidateType: "volume_shift",
      });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("prints inspect-finding evidence path for a prior audit packet", async () => {
    const auditDir = await mkdtemp(path.join(os.tmpdir(), "agent-audit-cli-"));
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), "agent-evidence-cli-"));
    try {
      await runAgentAuditCli(
        ["--output-dir", auditDir, "--data-class", "production"],
        { log: () => {} },
        {
          store: emptyAuditStore(),
          now: new Date("2026-06-11T10:00:00.000Z"),
        },
      );

      let printed = "";
      const evidence = await runAgentInspectFindingCli(
        [
          "--finding-id",
          "finding-001",
          "--audit-dir",
          auditDir,
          "--output-dir",
          evidenceDir,
        ],
        {
          log: (value) => {
            printed += value;
          },
        },
      );

      expect(JSON.parse(printed)).toMatchObject({
        ok: true,
        findingId: "finding-001",
        candidateType: "volume_shift",
        evidencePath: path.join(evidenceDir, "finding-001.json"),
      });
      expect(evidence.evidencePath).toBe(path.join(evidenceDir, "finding-001.json"));
    } finally {
      await rm(auditDir, { recursive: true, force: true });
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it("parses cluster, event, and source inspect commands", async () => {
    const calls = [];
    await runAgentInspectClusterCli(
      ["--cluster-id", "cluster-1", "--audit-dir", "audit", "--output-dir", "evidence"],
      { log: () => {} },
      {
        inspectImpl: async (input) => {
          calls.push(input);
          return {
            evidencePath: "evidence/cluster-1.json",
            candidate: {
              clusterId: input.clusterId,
              candidateType: "possible_duplicate_cluster",
            },
          };
        },
      },
    );
    await runAgentInspectEventCli(
      ["--event-id", "event-1", "--audit-dir", "audit", "--output-dir", "evidence"],
      { log: () => {} },
      {
        inspectImpl: async (input) => {
          calls.push(input);
          return {
            evidencePath: "evidence/event-1.json",
            entityId: input.eventId,
          };
        },
      },
    );
    await runAgentInspectSourceCli(
      ["--source-id", "source-1", "--audit-dir", "audit", "--output-dir", "evidence"],
      { log: () => {} },
      {
        inspectImpl: async (input) => {
          calls.push(input);
          return {
            evidencePath: "evidence/source-1.json",
            entityId: input.sourceId,
          };
        },
      },
    );

    expect(calls).toEqual([
      expect.objectContaining({ clusterId: "cluster-1", auditDir: "audit", outputDir: "evidence" }),
      expect.objectContaining({ eventId: "event-1", auditDir: "audit", outputDir: "evidence" }),
      expect.objectContaining({ sourceId: "source-1", auditDir: "audit", outputDir: "evidence" }),
    ]);
  });
});

function emptyAuditStore() {
  return {
    async listProcessingLedger() {
      return [];
    },
    async listPipelineRuns() {
      return [];
    },
    async listEventDrafts() {
      return [];
    },
    async listPublicEvents() {
      return [];
    },
    async listFeedback() {
      return [];
    },
    async listLlmUsage() {
      return [];
    },
  };
}
