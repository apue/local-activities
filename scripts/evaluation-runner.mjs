#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRegressionCorpus } from "./regression-corpus-replay.mjs";
import {
  createLocalEvaluationWriter,
  createMemoryEvaluationWriter,
  createSupabaseEvaluationWriter,
  defaultEvaluationVariantIds,
  runEvaluation,
} from "../src/evaluation/runner.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultArtifactDir = path.resolve(moduleDir, "../tmp/evaluation-runs");

export async function runEvaluationCli(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(helpText());
    return undefined;
  }
  loadEnvFiles(args.envFiles, env);
  if (!args.corpusDir) throw new Error("evaluation_corpus_dir_required");
  const corpus = await loadRegressionCorpus({ corpusDir: args.corpusDir });
  const writer = await writerForArgs({ args, env });
  const result = await runEvaluation({
    corpus,
    writer,
    variantIds: args.variantIds.length ? args.variantIds : defaultEvaluationVariantIds,
    caseIds: args.caseIds,
    allowLive: args.allowLive,
    maxCostCny: args.maxCostCny,
    env,
  });
  const output = {
    ok: result.ok,
    store: args.store,
    corpusVersion: result.corpusVersion,
    caseCount: result.caseCount,
    runCount: result.runCount,
    artifactDir: args.store === "local" ? args.artifactDir : undefined,
    runs: result.runs.map((report) => ({
      runId: report.run.run_id,
      provider: report.run.provider,
      model: report.run.model,
      status: report.run.status,
      caseCount: report.run.case_count,
      passCount: report.run.pass_count,
      failCount: report.run.fail_count,
      summary: report.run.summary,
      artifactPath: report.run.artifact_path,
    })),
  };
  console.log(JSON.stringify(output, null, 2));
  return { ...result, output };
}

export function parseArgs(argv = []) {
  const args = {
    store: "local",
    artifactDir: defaultArtifactDir,
    envFiles: [],
    variantIds: [],
    caseIds: [],
    allowLive: false,
    maxCostCny: 0,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--store") {
      args.store = requiredValue(argv, index, arg);
      if (!["local", "memory", "supabase"].includes(args.store)) {
        throw new Error(`evaluation_store_invalid:${args.store}`);
      }
      index += 1;
    } else if (arg === "--artifact-dir") {
      args.artifactDir = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--corpus-dir") {
      args.corpusDir = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--variant") {
      args.variantIds.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--case") {
      args.caseIds.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--env-file") {
      args.envFiles.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--allow-live") {
      args.allowLive = true;
    } else if (arg === "--max-cost-cny") {
      args.maxCostCny = Number(requiredValue(argv, index, arg));
      if (!Number.isFinite(args.maxCostCny) || args.maxCostCny < 0) {
        throw new Error(`evaluation_budget_invalid:${args.maxCostCny}`);
      }
      index += 1;
    } else {
      throw new Error(`evaluation_arg_unknown:${arg}`);
    }
  }
  return args;
}

async function writerForArgs({ args, env }) {
  if (args.store === "memory") return createMemoryEvaluationWriter();
  if (args.store === "local") {
    return createLocalEvaluationWriter({ artifactDir: args.artifactDir });
  }
  return await createSupabaseEvaluationWriter({ env });
}

function loadEnvFiles(paths, env) {
  for (const filePath of paths) {
    const content = readFileSync(path.resolve(filePath), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      env[match[1]] = unquoteEnvValue(match[2]);
    }
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
  return value;
}

function helpText() {
  return [
    "Usage: pnpm eval:run -- --corpus-dir <path> [--store local|memory|supabase] [--variant mock-expected-v1] [--variant mock-overfilter-v1]",
    "",
    "Requires an explicit regression corpus directory.",
    "Defaults to local artifacts under tmp/evaluation-runs and never calls live providers.",
    "Use --store supabase only when eval table/storage writes are intended.",
    "Use --variant live-configured --allow-live --max-cost-cny <n> for an optional configured live provider smoke.",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runEvaluationCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
