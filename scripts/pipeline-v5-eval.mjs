#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  parseV5EvaluationArgs,
  runV5Evaluation,
} from "../src/pipeline/v5/evaluation-runner.mjs";
import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

export async function runV5EvaluationCli(
  argv = process.argv.slice(2),
  consoleLike = console,
  {
    env = process.env,
    loadEnvFileImpl = loadEnvFile,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const args = parseV5EvaluationArgs(argv);
  const envFromFiles = (args.envFiles ?? []).map((envFile) => loadEnvFileImpl(envFile));
  const mergedEnv = mergeEnvs(env, ...envFromFiles);
  const result = await runV5Evaluation({
    ...args,
    env: mergedEnv,
    fetchImpl,
  });
  const output = {
    ok: result.ok,
    store: result.store,
    runId: result.runId,
    corpusVersion: result.corpusVersion,
    caseCount: result.caseCount,
    runCount: result.runCount,
    passCount: result.passCount,
    failCount: result.failCount,
    falsePositiveCount: result.falsePositiveCount,
    falseNegativeCount: result.falseNegativeCount,
    actionAccuracy: result.actionAccuracy,
    finalStateAccuracy: result.finalStateAccuracy,
    totalUsage: result.totalUsage,
    artifactDir: result.artifactDir,
    summaryPath: result.summaryPath,
    artifactPaths: result.artifactPaths,
    variantSummaries: result.variantSummaries,
  };
  consoleLike.log(JSON.stringify(output, null, 2));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runV5EvaluationCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
