#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  parseV5ReplayArgs,
  runV5Replay,
} from "../src/pipeline/v5/replay-runner.mjs";

export async function runV5ReplayCli(argv = process.argv.slice(2), consoleLike = console) {
  const args = parseV5ReplayArgs(argv);
  const result = await runV5Replay(args);
  const output = {
    ok: result.ok,
    store: result.store,
    runId: result.runId,
    corpusVersion: result.corpusVersion,
    caseCount: result.caseCount,
    artifactDir: result.artifactDir,
    summaryPath: result.summaryPath,
    cases: result.cases.map((item) => ({
      caseId: item.caseId,
      status: item.status,
      triageDecision: item.triageDecision,
      extractionDecision: item.extractionDecision,
      finalState: item.finalState,
      stepCount: item.steps.length,
    })),
  };
  consoleLike.log(JSON.stringify(output, null, 2));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runV5ReplayCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
