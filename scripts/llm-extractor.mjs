#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";
import {
  buildExtractorPromptInput,
  extractionSchemaVersion,
  formatLlmExtractionSummary,
  promptVersion,
  readLlmExtractorConfig,
  runLlmExtractionOnce,
} from "../src/extraction/llm-extractor.mjs";

export {
  buildExtractorPromptInput,
  extractionSchemaVersion,
  formatLlmExtractionSummary,
  promptVersion,
  readLlmExtractorConfig,
  runLlmExtractionOnce,
} from "../src/extraction/llm-extractor.mjs";

function readJsonFile(path) {
  if (!existsSync(path)) throw new Error(`json_file_not_found:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function usage() {
  return `Usage: pnpm extractor:llm --article-file article.json [--env-file .env.collector] [--response-file fixture.json] [--upload]

Runs lightweight LLM information extraction over one normalized article snapshot.

Default behavior is dry-run and does not upload collector payloads.

Required env for live provider calls:
  COLLECTOR_ID
  AGENT_PROVIDER
  OPENAI_API_KEY
  OPENAI_MODEL

Required env only when --upload is set:
  COLLECTOR_BASE_URL or APP_BASE_URL
  COLLECTOR_API_KEY`;
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const options = parseArgs(argv);
  if (!options.articleFile) throw new Error("missing_article_file");
  const env = mergeEnvs(process.env, loadEnvFile(options.envFile));
  const result = await runLlmExtractionOnce({
    env,
    articleSnapshot: readJsonFile(options.articleFile),
    evidenceAssets: options.evidenceFile ? readJsonFile(options.evidenceFile) : [],
    providerResponse: options.responseFile
      ? readJsonFile(options.responseFile)
      : undefined,
    upload: options.upload,
  });
  console.log(formatLlmExtractionSummary(result));
}

function parseArgs(argv) {
  const options = { upload: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") options.envFile = argv[(index += 1)];
    else if (arg === "--article-file") options.articleFile = argv[(index += 1)];
    else if (arg === "--evidence-file") options.evidenceFile = argv[(index += 1)];
    else if (arg === "--response-file") options.responseFile = argv[(index += 1)];
    else if (arg === "--upload") options.upload = true;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
