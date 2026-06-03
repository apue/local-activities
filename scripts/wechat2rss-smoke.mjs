#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";
import {
  formatWechat2RssSmokeSummary,
  runWechat2RssSmoke,
} from "./wechat2rss-source.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: pnpm smoke:wechat2rss --env-file .env.collector

Runs a read-only Wechat2RSS smoke check:
  login/account health -> recent article query

Required env:
  WECHAT2RSS_BASE_URL
  WECHAT2RSS_TOKEN

Optional env:
  WECHAT2RSS_LOOKBACK_DAYS`);
    return;
  }

  const env = mergeEnvs(process.env, loadEnvFile(args.envFile));
  const result = await runWechat2RssSmoke({ env });
  console.log(formatWechat2RssSmokeSummary(result));
  if (result.kind === "failed") {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--env-file") {
      args.envFile = argv[++index];
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  return args;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
