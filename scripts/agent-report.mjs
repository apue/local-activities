#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateAgentAuditReport,
  resolveEvalArtifactPaths,
} from "../src/pipeline/v5/agent-report.mjs";

const productionMutationFlags = new Set([
  "--publish",
  "--cleanup",
  "--reset",
  "--write-production",
  "--mutate-production",
  "--allow-production-mutation",
]);

export function parseAgentReportArgs(argv = []) {
  const args = {
    findingPaths: [],
    evalArtifactDir: "tmp/v5-eval-runs",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--audit-dir") {
      args.auditDir = requireValue(argv, ++index, arg);
    } else if (arg === "--eval-summary") {
      args.evalSummaryPath = requireValue(argv, ++index, arg);
    } else if (arg === "--comparison") {
      args.comparisonPath = requireValue(argv, ++index, arg);
    } else if (arg === "--eval-run-id") {
      args.evalRunId = requireValue(argv, ++index, arg);
    } else if (arg === "--eval-artifact-dir") {
      args.evalArtifactDir = requireValue(argv, ++index, arg);
    } else if (arg === "--finding-file") {
      args.findingPaths.push(requireValue(argv, ++index, arg));
    } else if (arg === "--output-dir") {
      args.outputDir = requireValue(argv, ++index, arg);
    } else if (arg === "--target") {
      const value = requireValue(argv, ++index, arg);
      if (value === "production") {
        throw new Error("agent_report_refuses_production_mutation_flag:--target production");
      }
      args.target = value;
    } else if (arg === "--store") {
      const value = requireValue(argv, ++index, arg);
      if (value === "production" || value === "supabase") {
        throw new Error(
          `agent_report_refuses_production_mutation_flag:--store ${value}`,
        );
      }
      args.store = value;
    } else if (productionMutationFlags.has(arg)) {
      throw new Error(`agent_report_refuses_production_mutation_flag:${arg}`);
    } else {
      throw new Error(`unknown_agent_report_arg:${arg}`);
    }
  }
  if (
    !args.auditDir &&
    !args.evalSummaryPath &&
    !args.comparisonPath &&
    !args.evalRunId &&
    args.findingPaths.length === 0
  ) {
    throw new Error("agent_report_input_required");
  }
  return args;
}

export async function runAgentReportCli(
  argv = process.argv.slice(2),
  consoleLike = console,
  {
    reportImpl = generateAgentAuditReport,
    resolveEvalPathsImpl = resolveEvalArtifactPaths,
    now = new Date(),
  } = {},
) {
  const args = parseAgentReportArgs(argv);
  const evalPaths = args.evalRunId
    ? await resolveEvalPathsImpl({
      evalRunId: args.evalRunId,
      evalArtifactDir: args.evalArtifactDir,
    })
    : {};
  const result = await reportImpl({
    auditDir: args.auditDir ? path.resolve(args.auditDir) : undefined,
    evalSummaryPath: args.evalSummaryPath
      ? path.resolve(args.evalSummaryPath)
      : evalPaths.evalSummaryPath
        ? path.resolve(evalPaths.evalSummaryPath)
        : undefined,
    comparisonPath: args.comparisonPath
      ? path.resolve(args.comparisonPath)
      : evalPaths.comparisonPath
        ? path.resolve(evalPaths.comparisonPath)
        : undefined,
    findingPaths: args.findingPaths.map((filePath) => path.resolve(filePath)),
    outputDir: args.outputDir ? path.resolve(args.outputDir) : undefined,
    now,
  });
  const output = {
    ok: true,
    reportPath: result.paths.jsonPath,
    markdownPath: result.paths.markdownPath,
    status: result.report.summary.status,
    nextActionCount: result.report.nextActions.length,
    suspectedAreaCount: result.report.suspectedAreas.length,
  };
  consoleLike.log(JSON.stringify(output, null, 2));
  return result;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(
      `missing_value_for_${flag.replace(/^--/, "").replaceAll("-", "_")}`,
    );
  }
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgentReportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
