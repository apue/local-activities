#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";
import {
  formatWechat2RssSyncSummary,
  runWechat2RssSyncOnce,
} from "../src/collector/orchestrator/wechat2rss-sync.mjs";

export {
  dedupeArticles,
  diagnosticEntries,
  formatWechat2RssSyncSummary,
  readWechat2RssSyncConfig,
  runWechat2RssSyncOnce,
  sourceRunEnvelope,
  summarizeExtractionResults,
} from "../src/collector/orchestrator/wechat2rss-sync.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: pnpm collector:wechat2rss:once --env-file .env.collector

Runs one local Wechat2RSS collector sync:
  login health -> recent article query -> source run upload -> article snapshot uploads

Add --extract to run the lightweight LLM extractor for each normalized article
snapshot and upload reviewable draft/failure payloads.

Required env:
  COLLECTOR_BASE_URL or APP_BASE_URL
  COLLECTOR_API_KEY
  COLLECTOR_ID
  WECHAT2RSS_BASE_URL
  WECHAT2RSS_TOKEN

Extra env when --extract is set:
  AGENT_PROVIDER
  OPENAI_API_KEY
  OPENAI_MODEL`);
    return;
  }

  const env = mergeEnvs(process.env, loadEnvFile(args.envFile));
  const result = await runWechat2RssSyncOnce({ env, extract: args.extract });
  console.log(formatWechat2RssSyncSummary(result));
  if (result.kind === "failed") process.exitCode = 1;
}

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    extract: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--env-file") {
      args.envFile = argv[++index];
    } else if (arg === "--extract") {
      args.extract = true;
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
