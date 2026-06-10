import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadV5RegressionCorpus } from "./regression-corpus-loader.mjs";
import { runV5Replay } from "./replay-runner.mjs";

export const defaultV5EvaluationVariants = [
  "mock-expected-v1",
];

export const comparisonV5EvaluationVariants = [
  "mock-overfilter-v1",
  "mock-underfilter-v1",
];

const supportedMockVariants = new Set([
  ...defaultV5EvaluationVariants,
  ...comparisonV5EvaluationVariants,
]);
const defaultArtifactDir = path.resolve("tmp/v5-eval-runs");

export function createMemoryV5EvaluationWriter() {
  const state = {
    artifacts: new Map(),
  };
  return {
    state,
    store: "memory",
    async writeArtifact(artifactPath, value) {
      state.artifacts.set(artifactPath, value);
    },
  };
}

export function createLocalV5EvaluationWriter({ artifactDir } = {}) {
  if (!artifactDir) throw new Error("v5_evaluation_artifact_dir_required");
  const memory = createMemoryV5EvaluationWriter();
  return {
    ...memory,
    store: "local",
    async writeArtifact(artifactPath, value) {
      await memory.writeArtifact(artifactPath, value);
      const filePath = path.join(artifactDir, artifactPath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

export async function runV5Evaluation({
  corpusDir,
  all = false,
  caseIds = [],
  store = "memory",
  artifactDir = defaultArtifactDir,
  variants = defaultV5EvaluationVariants,
  writer,
  replayResult,
  allowLive = false,
  maxCostCny,
  target,
  now = new Date(),
} = {}) {
  if (!corpusDir && !replayResult) throw new Error("v5_evaluation_corpus_dir_required");
  guardRuntime({ allowLive, maxCostCny, target });
  const selectedVariants = normalizeVariants(variants);
  const unsupportedVariant = selectedVariants.find((variant) => !supportedMockVariants.has(variant));
  if (unsupportedVariant) throw new Error(`v5_evaluation_variant_unsupported:${unsupportedVariant}`);

  const corpus = await loadV5RegressionCorpus({ corpusDir });
  const selectedCases = selectCases({ cases: corpus.cases, all, caseIds });
  const replay = replayResult ?? await runV5Replay({
    corpusDir,
    all,
    caseIds,
    store: "memory",
    now,
  });
  const replayCasesById = new Map((replay.cases ?? []).map((caseResult) => [caseResult.caseId, caseResult]));
  const evaluationWriter = writer ?? writerForStore({ store, artifactDir });
  const runId = `v5-eval-${timestampId(now)}`;
  const runPrefix = `runs/${runId}`;

  const caseResults = [];
  const caseArtifactPaths = [];
  for (const variant of selectedVariants) {
    for (const caseItem of selectedCases) {
      const replayCase = replayCasesById.get(caseItem.case.id);
      const caseResult = evaluateCaseVariant({ variant, caseItem, replayCase });
      const artifactPath = `${runPrefix}/variants/${safeArtifactSegment(variant)}/cases/${safeArtifactSegment(caseItem.case.id)}.json`;
      const caseResultWithArtifact = {
        ...caseResult,
        artifactPath,
        artifactPaths: [
          ...caseResult.artifactPaths,
          artifactPath,
        ],
      };
      await evaluationWriter.writeArtifact(artifactPath, caseResultWithArtifact);
      caseResults.push(caseResultWithArtifact);
      caseArtifactPaths.push(artifactPath);
    }
  }

  const variantSummaries = selectedVariants.map((variant) => {
    return summarizeResults({
      variant,
      results: caseResults.filter((item) => item.variant === variant),
    });
  });
  const aggregate = summarizeResults({ results: caseResults });
  const summaryPath = `${runPrefix}/summary.json`;
  const artifactPaths = [summaryPath, ...caseArtifactPaths];
  const summary = {
    ok: aggregate.failCount === 0,
    store: evaluationWriter.store ?? store,
    runId,
    corpusVersion: corpus.manifest.version,
    caseCount: selectedCases.length,
    runCount: caseResults.length,
    passCount: aggregate.passCount,
    failCount: aggregate.failCount,
    falsePositiveCount: aggregate.falsePositiveCount,
    falseNegativeCount: aggregate.falseNegativeCount,
    actionAccuracy: aggregate.actionAccuracy,
    finalStateAccuracy: aggregate.finalStateAccuracy,
    totalUsage: aggregate.totalUsage,
    artifactDir: (evaluationWriter.store ?? store) === "local" ? artifactDir : undefined,
    summaryPath,
    artifactPaths,
    variants: selectedVariants,
    variantSummaries,
    cases: caseResults,
  };
  await evaluationWriter.writeArtifact(summaryPath, summary);
  return summary;
}

export function parseV5EvaluationArgs(argv = []) {
  const options = {
    store: "local",
    artifactDir: defaultArtifactDir,
    caseIds: [],
    all: false,
    variants: [],
    allowLive: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--corpus-dir") {
      options.corpusDir = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--case") {
      options.caseIds.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--store") {
      options.store = requiredValue(argv, index, arg);
      if (!["memory", "local"].includes(options.store)) {
        throw new Error(`v5_evaluation_store_invalid:${options.store}`);
      }
      index += 1;
    } else if (arg === "--artifact-dir") {
      options.artifactDir = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--variant") {
      options.variants.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--target") {
      options.target = requiredValue(argv, index, arg);
      if (options.target === "production") throw new Error("v5_evaluation_refuses_production_target");
      index += 1;
    } else if (arg === "--allow-live") {
      options.allowLive = true;
    } else if (arg === "--max-cost-cny") {
      options.maxCostCny = parsePositiveNumber(requiredValue(argv, index, arg), arg);
      index += 1;
    } else {
      throw new Error(`v5_evaluation_arg_unknown:${arg}`);
    }
  }
  if (options.variants.length === 0) options.variants = [...defaultV5EvaluationVariants];
  guardRuntime(options);
  if (!options.all && options.caseIds.length === 0) {
    throw new Error("v5_evaluation_case_or_all_required");
  }
  return options;
}

function evaluateCaseVariant({ variant, caseItem, replayCase }) {
  const expectedAction = caseItem.expected.action;
  const expectedFinalState = finalStateFromExpectedAction(expectedAction);
  const prediction = predictionForVariant({ variant, expectedAction, replayCase });
  const actionCorrect = prediction.action === expectedAction;
  const finalStateCorrect = prediction.finalState === expectedFinalState;
  const passed = actionCorrect && finalStateCorrect;
  const falsePositive = prediction.action === "extract" && expectedAction !== "extract";
  const falseNegative = prediction.action === "exclude" && expectedAction !== "exclude";
  const totalUsage = normalizeUsage(prediction.usage);
  return {
    caseId: caseItem.case.id,
    variant,
    status: passed ? "passed" : "failed",
    expectedAction,
    predictedAction: prediction.action,
    expectedFinalState,
    predictedFinalState: prediction.finalState,
    actionCorrect,
    finalStateCorrect,
    falsePositive,
    falseNegative,
    replayCaseId: replayCase?.caseId,
    artifactPaths: prediction.artifactPaths ?? [],
    totalUsage,
  };
}

function predictionForVariant({ variant, expectedAction, replayCase }) {
  if (variant === "mock-expected-v1") {
    return {
      action: expectedAction,
      finalState: finalStateFromExpectedAction(expectedAction),
      artifactPaths: artifactPathsFromReplayCase(replayCase),
    };
  }
  if (variant === "mock-overfilter-v1") {
    return {
      action: "exclude",
      finalState: "excluded",
      artifactPaths: artifactPathsFromReplayCase(replayCase),
    };
  }
  if (variant === "mock-underfilter-v1") {
    return {
      action: "extract",
      finalState: "published",
      artifactPaths: artifactPathsFromReplayCase(replayCase),
    };
  }
  throw new Error(`v5_evaluation_variant_unsupported:${variant}`);
}

function summarizeResults({ variant, results }) {
  const runCount = results.length;
  const passCount = results.filter((item) => item.status === "passed").length;
  const actionCorrectCount = results.filter((item) => item.actionCorrect).length;
  const finalStateCorrectCount = results.filter((item) => item.finalStateCorrect).length;
  return {
    ...(variant ? { variant } : {}),
    caseCount: runCount,
    runCount,
    passCount,
    failCount: runCount - passCount,
    falsePositiveCount: results.filter((item) => item.falsePositive).length,
    falseNegativeCount: results.filter((item) => item.falseNegative).length,
    actionAccuracy: runCount === 0 ? 0 : actionCorrectCount / runCount,
    finalStateAccuracy: runCount === 0 ? 0 : finalStateCorrectCount / runCount,
    totalUsage: sumUsage(results.map((item) => item.totalUsage)),
  };
}

function normalizeVariants(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return [...defaultV5EvaluationVariants];
  return variants;
}

function selectCases({ cases, all, caseIds }) {
  if (all) return cases.filter((item) => item.bundle);
  const selected = [];
  for (const caseId of caseIds) {
    const item = cases.find((candidate) => candidate.case.id === caseId);
    if (!item) throw new Error(`v5_evaluation_case_unknown:${caseId}`);
    if (!item.bundle) throw new Error(`v5_evaluation_case_has_no_bundle:${caseId}`);
    selected.push(item);
  }
  return selected;
}

function finalStateFromExpectedAction(action) {
  if (action === "extract") return "published";
  if (action === "review") return "needs_review";
  if (action === "capture_failure") return "failed";
  return "excluded";
}

function artifactPathsFromReplayCase(replayCase) {
  if (!replayCase) return [];
  return [
    ...new Set((replayCase.steps ?? []).flatMap((step) => {
      return [step.outputArtifact?.path, step.stepArtifact?.path].filter(Boolean);
    })),
  ];
}

function sumUsage(items) {
  return items.reduce((total, item) => {
    const usage = normalizeUsage(item);
    return {
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
      costMicroCny: total.costMicroCny + usage.costMicroCny,
      latencyMs: total.latencyMs + usage.latencyMs,
    };
  }, emptyUsage());
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: safeNumber(usage.inputTokens),
    outputTokens: safeNumber(usage.outputTokens),
    totalTokens: safeNumber(usage.totalTokens),
    costMicroCny: safeNumber(usage.costMicroCny),
    latencyMs: safeNumber(usage.latencyMs),
  };
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costMicroCny: 0,
    latencyMs: 0,
  };
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function writerForStore({ store, artifactDir }) {
  if (store === "memory") return createMemoryV5EvaluationWriter();
  if (store === "local") return createLocalV5EvaluationWriter({ artifactDir });
  throw new Error(`v5_evaluation_store_invalid:${store}`);
}

function guardRuntime({ allowLive, maxCostCny, target }) {
  if (target === "production") throw new Error("v5_evaluation_refuses_production_target");
  if (allowLive && !(Number.isFinite(maxCostCny) && maxCostCny > 0)) {
    throw new Error("v5_evaluation_live_requires_positive_max_cost_cny");
  }
}

function parsePositiveNumber(value, arg) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`v5_evaluation_number_invalid:${arg}`);
  return number;
}

function timestampId(value) {
  return isoTimestamp(value).replace(/[^0-9]/g, "").slice(0, 14);
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error("v5_evaluation_now_invalid");
  return date.toISOString();
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
  return value;
}

function safeArtifactSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unnamed";
}
