import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCandidatePacket } from "./candidate-packet.mjs";
import { runCheapTriage } from "./cheap-triage.mjs";
import { cleanCapturedArticleBundle } from "./content-cleaner.mjs";
import { createLiveArtifactRecorder } from "./live-artifact-recorder.mjs";
import { runLiveEditorPass, runLiveFullExtract } from "./live-harnesses.mjs";
import { createLiveModelBudgetGuard, createOpenAICompatibleChatProvider } from "./model-provider.mjs";
import { decideV5PublishState } from "./publish-policy-v2.mjs";
import { loadV5RegressionCorpus } from "./regression-corpus-loader.mjs";
import { runV5Replay } from "./replay-runner.mjs";
import { scoreNormalizedContent } from "./signal-scorer.mjs";
import { validateV5Extraction } from "./validator-v2.mjs";

export const defaultV5EvaluationVariants = [
  "mock-expected-v1",
];

export const comparisonV5EvaluationVariants = [
  "mock-overfilter-v1",
  "mock-underfilter-v1",
];

export const liveV5EvaluationVariants = [
  "live-configured",
];

const supportedVariants = new Set([
  ...defaultV5EvaluationVariants,
  ...comparisonV5EvaluationVariants,
  ...liveV5EvaluationVariants,
]);
const liveVariants = new Set(liveV5EvaluationVariants);
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
  env = process.env,
  fetchImpl = globalThis.fetch,
  liveEvaluator,
} = {}) {
  if (!corpusDir && !replayResult) throw new Error("v5_evaluation_corpus_dir_required");
  const selectedVariants = normalizeVariants(variants);
  guardRuntime({ allowLive, maxCostCny, target, variants: selectedVariants });
  const unsupportedVariant = selectedVariants.find((variant) => !supportedVariants.has(variant));
  if (unsupportedVariant) throw new Error(`v5_evaluation_variant_unsupported:${unsupportedVariant}`);
  const configuredLiveEvaluator = selectedVariants.some((variant) => liveVariants.has(variant))
    ? liveEvaluator ?? createLiveConfiguredV5Evaluator({ env, fetchImpl, maxCostCny, now })
    : undefined;

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
      const liveArtifactBasePath = `${runPrefix}/variants/${safeArtifactSegment(variant)}/cases/${safeArtifactSegment(caseItem.case.id)}/live`;
      const caseResult = await evaluateCaseVariant({
        variant,
        caseItem,
        replayCase,
        liveEvaluator: configuredLiveEvaluator,
        writer: evaluationWriter,
        liveArtifactBasePath,
      });
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
    envFiles: [],
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
    } else if (arg === "--env-file") {
      options.envFiles.push(path.resolve(requiredValue(argv, index, arg)));
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

async function evaluateCaseVariant({ variant, caseItem, replayCase, liveEvaluator, writer, liveArtifactBasePath }) {
  const expectedAction = caseItem.expected.action;
  const expectedFinalState = finalStateFromExpectedAction(expectedAction);
  const prediction = liveVariants.has(variant)
    ? await livePredictionForVariant({
      variant,
      caseItem,
      replayCase,
      liveEvaluator,
      writer,
      liveArtifactBasePath,
    })
    : predictionForVariant({ variant, expectedAction, replayCase });
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

export function createLiveConfiguredV5Evaluator({
  env = process.env,
  fetchImpl = globalThis.fetch,
  maxCostCny,
  now = new Date(),
} = {}) {
  const config = liveProviderConfigFromEnv(env);
  if (typeof fetchImpl !== "function") throw new Error("v5_evaluation_live_fetch_impl_required");
  const budgetGuard = createLiveModelBudgetGuard({ maxCostCny });
  const provider = createOpenAICompatibleChatProvider({
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    fetchImpl,
    maxTokens: config.maxTokens,
    extraBody: config.extraBody,
  });

  return async function evaluateLiveConfiguredCase({
    caseItem,
    replayCase,
    writer,
    liveArtifactBasePath,
    dataClass = "eval",
  } = {}) {
    if (!caseItem?.bundle) throw new Error(`v5_evaluation_case_has_no_bundle:${caseItem?.case?.id ?? "unknown"}`);
    const caseArtifactRecorder = writer && liveArtifactBasePath
      ? createLiveArtifactRecorder({ writer, basePath: liveArtifactBasePath, dataClass })
      : undefined;
    const fullExtractArtifactRecorder = writer && liveArtifactBasePath
      ? createLiveArtifactRecorder({ writer, basePath: `${liveArtifactBasePath}/full_extract`, dataClass })
      : undefined;
    const normalized = cleanCapturedArticleBundle(caseItem.bundle);
    const signalScore = scoreNormalizedContent(normalized);
    const packet = buildCandidatePacket({ normalized, signalScore });
    const triage = await runCheapTriage({ packet, now });
    const extraction = await runLiveFullExtract({
      normalized,
      packet,
      triage,
      provider,
      budgetGuard,
      validator: ({ extraction: candidateExtraction }) => validateV5Extraction({
        extraction: candidateExtraction,
        normalized,
        now,
      }),
      now,
      imageEvidence: normalized.images ?? [],
      artifactRecorder: fullExtractArtifactRecorder,
    });
    const validation = validateV5Extraction({ extraction, normalized, now });
    const validationArtifact = caseArtifactRecorder
      ? await caseArtifactRecorder.write("deterministic_validator_result", {
        operation: "deterministic_validator",
        validation,
        sourceStepReferences: {
          extraction: extraction.artifacts ?? [],
        },
      }, { fileName: "deterministic_validator-result.json" })
      : undefined;
    const editorArtifactRecorder = writer && liveArtifactBasePath
      ? createLiveArtifactRecorder({ writer, basePath: `${liveArtifactBasePath}/editor_pass`, dataClass })
      : undefined;
    const editor = shouldRunEditorPass(extraction)
      ? await runLiveEditorPass({
        normalized,
        extraction,
        validation,
        provider,
        budgetGuard,
        now,
        artifactRecorder: editorArtifactRecorder,
      })
      : skippedEditorResult({ extraction, validation, normalized });
    const policy = decideV5PublishState({ extraction, validation, editor });
    const policyArtifact = caseArtifactRecorder
      ? await caseArtifactRecorder.write("publish_policy_decision", {
        operation: "publish_policy",
        policy,
        sourceStepReferences: {
          extraction: extraction.artifacts ?? [],
          validation: validationArtifact,
          editor: editor.artifacts ?? [],
        },
      }, { fileName: "publish-policy-decision.json" })
      : undefined;
    const liveArtifactPaths = [
      ...(fullExtractArtifactRecorder?.paths() ?? []),
      ...(validationArtifact ? [validationArtifact.path] : []),
      ...(editorArtifactRecorder?.paths() ?? []),
      ...(policyArtifact ? [policyArtifact.path] : []),
    ];
    return {
      action: actionFromPublishState(policy.state),
      finalState: policy.state,
      artifactPaths: [
        ...artifactPathsFromReplayCase(replayCase),
        ...liveArtifactPaths,
      ],
      usage: sumUsage([
        extraction.usage,
        editor.usage,
      ]),
      live: {
        provider: provider.provider,
        model: provider.model,
        triageDecision: triage.decision,
        validationStatus: validation.status,
        publishReasons: policy.reasons,
        extractionDecision: extraction.decision,
        editorDecision: editor.editorDecision,
      },
    };
  };
}

async function livePredictionForVariant({
  variant,
  caseItem,
  replayCase,
  liveEvaluator,
  writer,
  liveArtifactBasePath,
}) {
  if (variant !== "live-configured") throw new Error(`v5_evaluation_variant_unsupported:${variant}`);
  if (typeof liveEvaluator !== "function") throw new Error("v5_evaluation_live_evaluator_required");
  return liveEvaluator({
    caseItem,
    replayCase,
    variant,
    writer,
    liveArtifactBasePath,
    dataClass: "eval",
  });
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

function guardRuntime({ allowLive, maxCostCny, target, variants = [] }) {
  if (target === "production") throw new Error("v5_evaluation_refuses_production_target");
  if (variants.some((variant) => liveVariants.has(variant)) && allowLive !== true) {
    throw new Error("v5_evaluation_live_requires_allow_live");
  }
  if (allowLive && !(Number.isFinite(maxCostCny) && maxCostCny > 0)) {
    throw new Error("v5_evaluation_live_requires_positive_max_cost_cny");
  }
}

function liveProviderConfigFromEnv(env = {}) {
  const config = {
    provider: clean(env.V5_LIVE_PROVIDER) ?? clean(env.ANALYSIS_LLM_PROVIDER) ?? "openai-compatible",
    baseUrl: clean(env.V5_LIVE_BASE_URL) ?? clean(env.ANALYSIS_LLM_BASE_URL),
    model: clean(env.V5_LIVE_MODEL) ?? clean(env.ANALYSIS_LLM_MODEL),
    apiKey: clean(env.V5_LIVE_API_KEY) ?? clean(env.ANALYSIS_LLM_API_KEY),
    maxTokens: parseOptionalPositiveInteger(
      clean(env.V5_LIVE_MAX_TOKENS) ?? clean(env.ANALYSIS_LLM_MAX_OUTPUT_TOKENS),
      "V5_LIVE_MAX_TOKENS",
    ),
    extraBody: liveProviderExtraBodyFromEnv(env),
  };
  const missing = [
    ["baseUrl", config.baseUrl],
    ["model", config.model],
    ["apiKey", config.apiKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`v5_evaluation_live_provider_config_missing:${missing.join(",")}`);
  }
  return config;
}

function liveProviderExtraBodyFromEnv(env = {}) {
  const extraBody = {};
  const enableThinking = parseOptionalBoolean(clean(env.V5_LIVE_ENABLE_THINKING), "V5_LIVE_ENABLE_THINKING");
  if (enableThinking !== undefined) extraBody.enable_thinking = enableThinking;
  return extraBody;
}

function parseOptionalPositiveInteger(value, name) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`v5_evaluation_live_positive_integer_invalid:${name}`);
  }
  return number;
}

function parseOptionalBoolean(value, name) {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`v5_evaluation_live_boolean_invalid:${name}`);
}

function shouldRunEditorPass(extraction) {
  return extraction?.decision === "event" && Array.isArray(extraction?.events) && extraction.events.length > 0;
}

function skippedEditorResult({ extraction, validation, normalized }) {
  const extractionDecision = clean(extraction?.decision);
  return {
    displayTitle: clean(extraction?.events?.[0]?.title) ?? clean(normalized?.title) ?? "Untitled",
    summary: "",
    tags: [],
    category: "unknown",
    audience: "unknown",
    corrections: [],
    qualityIssues: validation?.issues ?? [],
    editorDecision: skippedEditorDecision(extractionDecision),
    reason: `editor_skipped_after_${extractionDecision ?? "unknown"}_extraction`,
    usage: emptyUsage(),
  };
}

function skippedEditorDecision(extractionDecision) {
  if (extractionDecision === "non_event") return "exclude";
  if (extractionDecision === "failed") return "failed";
  return "review";
}

function actionFromPublishState(state) {
  if (state === "published") return "extract";
  if (state === "excluded") return "exclude";
  if (state === "failed") return "capture_failure";
  return "review";
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

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
