#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const agentOperableRegressionGateSteps = Object.freeze([
  {
    name: "unit_tests",
    args: ["test"],
  },
  {
    name: "typecheck",
    args: ["typecheck"],
  },
  {
    name: "typecheck_ts6",
    args: ["typecheck:ts6"],
  },
  {
    name: "v5_replay_memory",
    args: [
      "pipeline:v5:replay",
      "--",
      "--corpus-dir",
      "tests/regression-corpus",
      "--all",
      "--store",
      "memory",
    ],
  },
  {
    name: "v5_eval_memory",
    args: [
      "pipeline:v5:eval",
      "--",
      "--corpus-dir",
      "tests/regression-corpus",
      "--all",
      "--store",
      "memory",
    ],
  },
]);

export function buildAgentOperableRegressionGatePlan({ packageManager = "pnpm" } = {}) {
  return agentOperableRegressionGateSteps.map((step) => ({
    ...step,
    command: packageManager,
    display: [packageManager, ...step.args].join(" "),
  }));
}

export async function runAgentOperableRegressionGate({
  packageManager = "pnpm",
  consoleLike = console,
  runCommandImpl = runCommand,
} = {}) {
  const plan = buildAgentOperableRegressionGatePlan({ packageManager });
  const results = [];

  for (const step of plan) {
    consoleLike.log(JSON.stringify({
      event: "agent_operable_regression_gate_step_start",
      name: step.name,
      command: step.display,
    }));

    const result = await runCommandImpl(step);
    results.push({ name: step.name, ...result });

    if (result.exitCode !== 0) {
      const error = new Error(`agent_operable_regression_gate_failed:${step.name}`);
      error.step = step.name;
      error.exitCode = result.exitCode;
      error.results = results;
      throw error;
    }
  }

  const summary = {
    ok: true,
    stepCount: plan.length,
    results,
  };
  consoleLike.log(JSON.stringify({
    event: "agent_operable_regression_gate_complete",
    ...summary,
  }));
  return summary;
}

export async function runAgentOperableRegressionGateCli(
  argv = process.argv.slice(2),
  consoleLike = console,
  options = {},
) {
  const args = parseAgentOperableRegressionGateArgs(argv);
  const plan = buildAgentOperableRegressionGatePlan({
    packageManager: args.packageManager,
  });

  if (args.dryRun) {
    const output = { ok: true, dryRun: true, steps: plan };
    consoleLike.log(JSON.stringify(output, null, 2));
    return output;
  }

  return runAgentOperableRegressionGate({
    ...options,
    packageManager: args.packageManager,
    consoleLike,
  });
}

function parseAgentOperableRegressionGateArgs(argv) {
  const parsed = {
    dryRun: false,
    packageManager: "pnpm",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--package-manager") {
      const value = argv[index + 1];
      if (!value) throw new Error("package_manager_required");
      parsed.packageManager = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown_agent_operable_regression_gate_arg:${arg}`);
  }

  return parsed;
}

function runCommand(step) {
  return new Promise((resolve) => {
    const child = spawn(resolveCommand(step.command), step.args, {
      stdio: "inherit",
      shell: false,
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1 });
    });
  });
}

function resolveCommand(command) {
  if (process.platform === "win32" && command === "pnpm") return "pnpm.cmd";
  return command;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgentOperableRegressionGateCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
