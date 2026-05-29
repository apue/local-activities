#!/usr/bin/env node

import { observePageForBenchmark } from "./collector-agent-processor.mjs";

export async function runBrowserRunnerBenchmark({
  seedUrl,
  runners = ["playwright", "agent_browser"],
  now = new Date(),
}) {
  if (!seedUrl) throw new Error("missing_seed_url");
  const results = [];
  for (const runner of runners) {
    results.push(
      await observePageForBenchmark({
        seedUrl,
        runner,
        now,
      }),
    );
  }
  return {
    seedUrl,
    measuredAt: now.toISOString(),
    results,
    selectedRunner: selectRunner(results),
  };
}

export function selectRunner(results) {
  const successful = results
    .filter((result) => result.ok)
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
  return successful[0]?.runner ?? undefined;
}

function parseArgs(argv) {
  const seedUrlIndex = argv.indexOf("--seed-url");
  const runnersIndex = argv.indexOf("--runners");
  const seedUrl = seedUrlIndex >= 0 ? argv[seedUrlIndex + 1] : undefined;
  const runnerArg = runnersIndex >= 0 ? argv[runnersIndex + 1] : undefined;
  return {
    seedUrl,
    runners: runnerArg
      ? runnerArg
          .split(",")
          .map((runner) => runner.trim())
          .filter((runner) => ["playwright", "agent_browser"].includes(runner))
      : undefined,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const report = await runBrowserRunnerBenchmark({
    seedUrl: args.seedUrl,
    runners: args.runners,
  });
  console.log(JSON.stringify(report, null, 2));
}
