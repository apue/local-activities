import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import {
  buildAgentOperableRegressionGatePlan,
  runAgentOperableRegressionGate,
  runAgentOperableRegressionGateCli,
} from "./agent-operable-regression-gate.mjs";

describe("agent-operable regression gate", () => {
  it("is exposed through the package script", () => {
    expect(packageJson.scripts["agent:regression-gate"]).toBe(
      "node scripts/agent-operable-regression-gate.mjs",
    );
  });

  it("builds the Phase 1 regression gate command sequence", () => {
    expect(buildAgentOperableRegressionGatePlan()).toEqual([
      expect.objectContaining({
        name: "unit_tests",
        display: "pnpm test",
      }),
      expect.objectContaining({
        name: "typecheck",
        display: "pnpm typecheck",
      }),
      expect.objectContaining({
        name: "v5_replay_memory",
        display:
          "pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory",
      }),
      expect.objectContaining({
        name: "v5_eval_memory",
        display:
          "pnpm pipeline:v5:eval -- --corpus-dir tests/regression-corpus --all --store memory",
      }),
    ]);
  });

  it("prints the gate plan in dry-run mode", async () => {
    let printed = "";
    const result = await runAgentOperableRegressionGateCli(["--dry-run"], {
      log: (value) => {
        printed += value;
      },
    });

    expect(result).toMatchObject({ ok: true, dryRun: true });
    expect(JSON.parse(printed)).toMatchObject({
      ok: true,
      dryRun: true,
      steps: [
        expect.objectContaining({ name: "unit_tests" }),
        expect.objectContaining({ name: "typecheck" }),
        expect.objectContaining({ name: "v5_replay_memory" }),
        expect.objectContaining({ name: "v5_eval_memory" }),
      ],
    });
  });

  it("runs commands in order and reports success", async () => {
    const calls = [];
    const logs = [];

    const result = await runAgentOperableRegressionGate({
      consoleLike: {
        log: (value) => logs.push(JSON.parse(value)),
      },
      runCommandImpl: async (step) => {
        calls.push(step.name);
        return { exitCode: 0 };
      },
    });

    expect(calls).toEqual([
      "unit_tests",
      "typecheck",
      "v5_replay_memory",
      "v5_eval_memory",
    ]);
    expect(result).toMatchObject({ ok: true, stepCount: 4 });
    expect(logs.at(-1)).toMatchObject({
      event: "agent_operable_regression_gate_complete",
      ok: true,
      stepCount: 4,
    });
  });

  it("stops at the first failing command", async () => {
    const calls = [];

    await expect(
      runAgentOperableRegressionGate({
        consoleLike: { log: () => {} },
        runCommandImpl: async (step) => {
          calls.push(step.name);
          return { exitCode: step.name === "typecheck" ? 1 : 0 };
        },
      }),
    ).rejects.toMatchObject({
      message: "agent_operable_regression_gate_failed:typecheck",
      step: "typecheck",
      exitCode: 1,
    });

    expect(calls).toEqual(["unit_tests", "typecheck"]);
  });
});
