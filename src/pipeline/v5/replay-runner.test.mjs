import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createMemoryV5ReplayWriter,
  parseV5ReplayArgs,
  runV5Replay,
} from "./replay-runner.mjs";

describe("V5 replay runner", () => {
  it("runs the offline mock pipeline over selected corpus cases with memory artifacts", async () => {
    const writer = createMemoryV5ReplayWriter();

    const result = await runV5Replay({
      corpusDir: "tests/regression-corpus",
      caseIds: ["beiping-beer-festival-guide", "turkey-president-meeting-news"],
      writer,
      now: new Date("2026-06-10T04:00:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      store: "memory",
      caseCount: 2,
    });
    expect(result.cases.map((item) => item.caseId)).toEqual([
      "beiping-beer-festival-guide",
      "turkey-president-meeting-news",
    ]);
    expect(result.cases[0].steps.map((step) => step.nodeName)).toEqual([
      "content_cleaner",
      "signal_scorer",
      "candidate_packet",
      "cheap_triage",
      "mock_full_extract",
      "deterministic_validator",
      "mock_editor_pass",
      "publish_trace",
    ]);
    expect(result.cases[0].finalState).toBe("published");
    expect(result.cases[1].finalState).toBe("excluded");
    expect(writer.state.artifacts.size).toBeGreaterThan(10);
    expect([...writer.state.artifacts.keys()]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("beiping-beer-festival-guide/content-cleaner-output.json"),
      ]),
    );
  });

  it("writes local artifacts with summary and per-step records", async () => {
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "v5-replay-"));
    try {
      const result = await runV5Replay({
        corpusDir: "tests/regression-corpus",
        caseIds: ["beiping-beer-festival-guide"],
        store: "local",
        artifactDir,
        now: new Date("2026-06-10T04:00:00.000Z"),
      });

      expect(result.ok).toBe(true);
      expect(result.artifactDir).toBe(artifactDir);
      const summary = JSON.parse(await readFile(path.join(artifactDir, result.summaryPath), "utf8"));
      expect(summary).toMatchObject({
        ok: true,
        caseCount: 1,
      });
      const output = JSON.parse(
        await readFile(
          path.join(
            artifactDir,
            result.cases[0].steps.find((item) => item.nodeName === "cheap_triage").outputArtifact.path,
          ),
          "utf8",
        ),
      );
      expect(output).toMatchObject({
        version: "v5-cheap-triage.v1",
        decision: "candidate",
      });
      const stepRecord = JSON.parse(
        await readFile(
          path.join(
            artifactDir,
            result.cases[0].steps.find((item) => item.nodeName === "cheap_triage").stepArtifact.path,
          ),
          "utf8",
        ),
      );
      expect(stepRecord).toMatchObject({
        nodeName: "cheap_triage",
        outputArtifacts: [expect.objectContaining({ kind: "cheap_triage_result" })],
        usage: expect.objectContaining({ costMicroCny: 0 }),
        attempts: [expect.objectContaining({ provider: "mock" })],
        validationIssues: [],
      });
      expect(stepRecord.inputArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "candidate_packet" }),
        ]),
      );
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it("parses CLI args and refuses live or production targets", () => {
    expect(parseV5ReplayArgs([
      "--corpus-dir",
      "tests/regression-corpus",
      "--all",
      "--store",
      "memory",
    ])).toMatchObject({
      corpusDir: path.resolve("tests/regression-corpus"),
      all: true,
      store: "memory",
    });

    expect(() => parseV5ReplayArgs(["--target", "production"])).toThrow(
      "v5_replay_refuses_live_or_production_target:production",
    );
    expect(() => parseV5ReplayArgs(["--allow-live"])).toThrow(
      "v5_replay_live_not_supported_in_phase1",
    );
  });
});
