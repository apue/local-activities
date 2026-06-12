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
  llmCallLedger,
} = {}) {
  if (!corpusDir && !replayResult) throw new Error("v5_evaluation_corpus_dir_required");
  const selectedVariants = normalizeVariants(variants);
  guardRuntime({ allowLive, maxCostCny, target, variants: selectedVariants });
  const unsupportedVariant = selectedVariants.find((variant) => {
    return !supportedVariants.has(baseVariantFromEvaluationVariant(variant));
  });
  if (unsupportedVariant) throw new Error(`v5_evaluation_variant_unsupported:${unsupportedVariant}`);
  const configuredLiveEvaluator = selectedVariants.some((variant) => {
    return liveVariants.has(baseVariantFromEvaluationVariant(variant));
  })
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
        llmCallLedger,
        evaluationRunId: runId,
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
  const reviewMetrics = computeReviewMetrics(caseResults);
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
    reviewMetrics,
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

export async function runV5EvaluationComparison({
  baselineConfig,
  candidateConfig,
  gates,
  ...evaluationInput
} = {}) {
  const baseline = normalizeComparisonConfig(baselineConfig, "baseline");
  const candidate = normalizeComparisonConfig(candidateConfig, "candidate");
  assertExecutableDifference({ baseline, candidate });
  const baselineRunVariant = comparisonRunVariant("baseline", baseline);
  const candidateRunVariant = comparisonRunVariant("candidate", candidate);
  const variants = [baselineRunVariant, candidateRunVariant];
  const evaluationWriter = evaluationInput.writer ?? writerForStore({
    store: evaluationInput.store ?? "memory",
    artifactDir: evaluationInput.artifactDir ?? defaultArtifactDir,
  });
  const evaluation = await runV5Evaluation({
    ...evaluationInput,
    writer: evaluationWriter,
    variants,
  });
  const comparisonPath = evaluation.summaryPath.replace(/summary\.json$/, "comparison.json");
  const baselineCases = casesForVariant(evaluation.cases, baselineRunVariant);
  const candidateCases = casesForVariant(evaluation.cases, candidateRunVariant);
  const baselineMetrics = computeComparisonMetrics(baselineCases);
  const candidateMetrics = computeComparisonMetrics(candidateCases);
  const regressions = compareCaseRegressions({
    baselineCases,
    candidateCases,
  });
  const resolvedGates = evaluateComparisonGates({
    baselineMetrics,
    candidateMetrics,
    regressions,
    gates,
  });
  const failedGates = resolvedGates.filter((gate) => !gate.passed);
  const report = {
    kind: "v5_baseline_candidate_eval_comparison",
    runId: evaluation.runId,
    corpusVersion: evaluation.corpusVersion,
    caseCount: evaluation.caseCount,
    runCount: evaluation.runCount,
    store: evaluation.store,
    artifactDir: evaluation.artifactDir,
    summaryPath: evaluation.summaryPath,
    comparisonPath,
    artifactPaths: [comparisonPath, ...evaluation.artifactPaths],
    baseline: {
      ...baseline,
      runVariant: baselineRunVariant,
      summary: evaluation.variantSummaries.find((summary) => summary.variant === baselineRunVariant),
      metrics: baselineMetrics,
    },
    candidate: {
      ...candidate,
      runVariant: candidateRunVariant,
      summary: evaluation.variantSummaries.find((summary) => summary.variant === candidateRunVariant),
      metrics: candidateMetrics,
    },
    gates: resolvedGates,
    regressions,
    recommended: failedGates.length === 0,
    recommendation: {
      status: failedGates.length === 0 ? "recommended" : "not_recommended",
      failedGates: failedGates.map((gate) => gate.name),
      reasons: failedGates.map((gate) => gate.reason),
    },
  };
  await evaluationWriter.writeArtifact(comparisonPath, report);
  return report;
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
  const comparison = {
    baselineConfig: {},
    candidateConfig: {},
    gates: {},
    seen: false,
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
    } else if (arg === "--baseline-config-id") {
      comparison.seen = true;
      comparison.baselineConfig.configId = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--baseline-variant") {
      comparison.seen = true;
      comparison.baselineConfig.variant = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--candidate-config-id") {
      comparison.seen = true;
      comparison.candidateConfig.configId = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--candidate-variant") {
      comparison.seen = true;
      comparison.candidateConfig.variant = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--max-false-positive-rate") {
      comparison.seen = true;
      comparison.gates.maxFalsePositiveRate = parseNonNegativeNumber(requiredValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--max-monthly-cost-cny") {
      comparison.seen = true;
      comparison.gates.maxMonthlyEstimatedTokenCostCny = parseNonNegativeNumber(requiredValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--monthly-estimated-cost-micro-cny") {
      comparison.seen = true;
      comparison.gates.monthlyEstimatedCostMicroCny = parseNonNegativeNumber(requiredValue(argv, index, arg), arg);
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
  if (comparison.seen) {
    options.comparison = {
      baselineConfig: comparison.baselineConfig,
      candidateConfig: comparison.candidateConfig,
      gates: comparison.gates,
    };
    normalizeComparisonConfig(options.comparison.baselineConfig, "baseline");
    normalizeComparisonConfig(options.comparison.candidateConfig, "candidate");
    options.variants = [
      options.comparison.baselineConfig.variant,
      options.comparison.candidateConfig.variant,
    ];
  }
  if (options.variants.length === 0) options.variants = [...defaultV5EvaluationVariants];
  guardRuntime(options);
  if (!options.all && options.caseIds.length === 0) {
    throw new Error("v5_evaluation_case_or_all_required");
  }
  return options;
}

async function evaluateCaseVariant({
  variant,
  caseItem,
  replayCase,
  liveEvaluator,
  writer,
  liveArtifactBasePath,
  llmCallLedger,
  evaluationRunId,
}) {
  const expectedAction = caseItem.expected.action;
  const expectedFinalState = finalStateFromExpectedAction(expectedAction);
  const expectedSignals = expectedReviewSignals(caseItem);
  const baseVariant = baseVariantFromEvaluationVariant(variant);
  const prediction = liveVariants.has(baseVariant)
    ? await livePredictionForVariant({
      variant: baseVariant,
      caseItem,
      replayCase,
      liveEvaluator,
      writer,
      liveArtifactBasePath,
      llmCallLedger,
      evaluationRunId,
    })
    : predictionForVariant({
      variant: baseVariant,
      expectedAction,
      replayCase,
      expected: caseItem.expected,
      expectedSignals,
    });
  const actionCorrect = prediction.action === expectedAction;
  const finalStateCorrect = prediction.finalState === expectedFinalState;
  const passed = actionCorrect && finalStateCorrect;
  const falsePositive = prediction.action === "extract" && expectedAction !== "extract";
  const falseNegative = prediction.action === "exclude" && expectedAction !== "exclude";
  const totalUsage = normalizeUsage(prediction.usage);
  const predictedSignals = normalizePredictedSignals(prediction.signals);
  const signalScores = scoreReviewSignals({ expectedSignals, predictedSignals });
  return {
    caseId: caseItem.case.id,
    variant,
    baseVariant,
    status: passed ? "passed" : "failed",
    expectedAction,
    predictedAction: prediction.action,
    expectedFinalState,
    predictedFinalState: prediction.finalState,
    actionCorrect,
    finalStateCorrect,
    falsePositive,
    falseNegative,
    expectedSignals,
    predictedSignals,
    signalScores,
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
    llmCallLedger,
    evaluationRunId,
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
      llmCallLedger,
      ledgerContext: liveLedgerContext({ caseItem, dataClass, evaluationRunId }),
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
        llmCallLedger,
        ledgerContext: liveLedgerContext({ caseItem, dataClass, evaluationRunId }),
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
      signals: predictedSignalsFromExtraction({ extraction, policy }),
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
  llmCallLedger,
  evaluationRunId,
}) {
  if (variant !== "live-configured") throw new Error(`v5_evaluation_variant_unsupported:${variant}`);
  if (typeof liveEvaluator !== "function") throw new Error("v5_evaluation_live_evaluator_required");
  return liveEvaluator({
    caseItem,
    replayCase,
    variant,
    writer,
    liveArtifactBasePath,
    llmCallLedger,
    evaluationRunId,
    dataClass: "eval",
  });
}

function predictionForVariant({
  variant,
  expectedAction,
  replayCase,
  expected,
  expectedSignals,
}) {
  if (variant === "mock-expected-v1") {
    return {
      action: expectedAction,
      finalState: finalStateFromExpectedAction(expectedAction),
      artifactPaths: artifactPathsFromReplayCase(replayCase),
      signals: {
        hasRegistration: expectedSignals.expectsRegistration,
        hasRegistrationQr: expectedSignals.expectsRegistrationQr,
        hasPoster: expectedSignals.expectsPoster,
        hasMultipleEvents: expectedSignals.expectsMultipleEvents,
        handledDuplicateUpdate: expectedSignals.expectsDuplicateUpdate,
        eventCount: expected?.eventCount ?? 0,
      },
    };
  }
  if (variant === "mock-overfilter-v1") {
    return {
      action: "exclude",
      finalState: "excluded",
      artifactPaths: artifactPathsFromReplayCase(replayCase),
      signals: emptyPredictedSignals(),
    };
  }
  if (variant === "mock-underfilter-v1") {
    return {
      action: "extract",
      finalState: "published",
      artifactPaths: artifactPathsFromReplayCase(replayCase),
      signals: {
        ...emptyPredictedSignals(),
        eventCount: expectedAction === "extract" ? expected?.eventCount ?? 1 : 1,
      },
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
    reviewMetrics: computeReviewMetrics(results),
    totalUsage: sumUsage(results.map((item) => item.totalUsage)),
  };
}

function normalizeComparisonConfig(config, role) {
  if (!config || typeof config !== "object") {
    throw new Error(`v5_evaluation_${role}_config_required`);
  }
  const configId = clean(config.configId ?? config.id);
  if (!configId) throw new Error(`v5_evaluation_${role}_config_id_required`);
  const variant = clean(config.variant ?? config.params?.variant);
  if (!variant) throw new Error(`v5_evaluation_${role}_variant_required`);
  if (!supportedVariants.has(variant)) {
    throw new Error(`v5_evaluation_variant_unsupported:${variant}`);
  }
  return {
    configId,
    variant,
    configFingerprint: clean(config.configFingerprint),
    provider: clean(config.provider),
    model: clean(config.model),
    promptVersion: clean(config.promptVersion),
    schemaVersion: clean(config.schemaVersion),
    dataClass: clean(config.dataClass),
    params: plainObject(config.params),
  };
}

function assertExecutableDifference({ baseline, candidate }) {
  if (baseline.variant !== candidate.variant) return;
  if (comparisonFingerprint(baseline) !== comparisonFingerprint(candidate)) return;
  throw new Error("v5_evaluation_candidate_config_has_no_executable_difference");
}

function comparisonFingerprint(config) {
  return JSON.stringify({
    variant: config.variant,
    configFingerprint: config.configFingerprint,
    provider: config.provider,
    model: config.model,
    promptVersion: config.promptVersion,
    schemaVersion: config.schemaVersion,
    params: config.params,
  });
}

function comparisonRunVariant(role, config) {
  return `${config.variant}@${role}-${safeArtifactSegment(config.configId)}`;
}

function baseVariantFromEvaluationVariant(variant) {
  const normalized = clean(variant);
  return normalized?.split("@")[0];
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function casesForVariant(cases = [], variant) {
  return cases.filter((item) => item.variant === variant);
}

function computeComparisonMetrics(cases = []) {
  const caseCount = cases.length;
  const expectedExtractCount = cases.filter((item) => item.expectedAction === "extract").length;
  const predictedExtractCount = cases.filter((item) => item.predictedAction === "extract").length;
  const correctExtractCount = cases.filter(
    (item) => item.expectedAction === "extract" && item.predictedAction === "extract",
  ).length;
  const expectedExcludeCount = cases.filter((item) => item.expectedAction === "exclude").length;
  const correctExcludeCount = cases.filter(
    (item) => item.expectedAction === "exclude" && item.predictedAction === "exclude",
  ).length;
  const reviewCount = cases.filter((item) => item.predictedAction === "review").length;
  const totalUsage = sumUsage(cases.map((item) => item.totalUsage));
  const reviewMetrics = computeReviewMetrics(cases);
  const latencies = cases
    .map((item) => normalizeUsage(item.totalUsage).latencyMs)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  return {
    caseCount,
    actionAccuracy: ratio(
      cases.filter((item) => item.actionCorrect).length,
      caseCount,
    ),
    finalStateAccuracy: ratio(
      cases.filter((item) => item.finalStateCorrect).length,
      caseCount,
    ),
    falsePositiveRate: ratio(
      cases.filter((item) => item.falsePositive).length,
      caseCount,
    ),
    falseNegativeRate: ratio(
      cases.filter((item) => item.falseNegative).length,
      caseCount,
    ),
    needsReviewRate: ratio(reviewCount, caseCount),
    publicEventRecall: ratio(correctExtractCount, expectedExtractCount),
    nonEventPrecision: ratio(correctExcludeCount, expectedExcludeCount),
    autoPublishPrecision: ratio(correctExtractCount, predictedExtractCount),
    ...reviewMetrics,
    costPerArticleMicroCny: ratio(totalUsage.costMicroCny, caseCount),
    costPerPublishedEventMicroCny: nullableRatio(totalUsage.costMicroCny, predictedExtractCount),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    totalUsage,
  };
}

function compareCaseRegressions({ baselineCases = [], candidateCases = [] } = {}) {
  const baselineByCase = new Map(baselineCases.map((item) => [item.caseId, item]));
  return candidateCases.flatMap((candidateCase) => {
    const baselineCase = baselineByCase.get(candidateCase.caseId);
    if (!baselineCase || baselineCase.status !== "passed" || candidateCase.status === "passed") {
      return [];
    }
    return [{
      caseId: candidateCase.caseId,
      failureTypes: failureTypesForCase(candidateCase),
      expectedAction: candidateCase.expectedAction,
      baselineAction: baselineCase.predictedAction,
      candidateAction: candidateCase.predictedAction,
      expectedFinalState: candidateCase.expectedFinalState,
      baselineFinalState: baselineCase.predictedFinalState,
      candidateFinalState: candidateCase.predictedFinalState,
      baselineArtifactPaths: baselineCase.artifactPaths ?? [],
      candidateArtifactPaths: candidateCase.artifactPaths ?? [],
    }];
  });
}

function failureTypesForCase(caseResult) {
  const types = [];
  if (caseResult.falsePositive) types.push("false_positive");
  if (caseResult.falseNegative) types.push("false_negative");
  if (!caseResult.actionCorrect) types.push("action_mismatch");
  if (!caseResult.finalStateCorrect) types.push("final_state_mismatch");
  return types.length > 0 ? types : ["unknown_regression"];
}

function evaluateComparisonGates({
  baselineMetrics,
  candidateMetrics,
  regressions,
  gates = {},
}) {
  const maxFalsePositiveRate = finiteNumber(gates.maxFalsePositiveRate, 0.1);
  const maxMonthlyEstimatedTokenCostCny = finiteNumber(
    gates.maxMonthlyEstimatedTokenCostCny,
    100,
  );
  const monthlyEstimateMicroCny = Number(gates.monthlyEstimatedCostMicroCny);
  const hasMonthlyEstimate = Number.isFinite(monthlyEstimateMicroCny);
  const monthlyEstimatedTokenCostCny = hasMonthlyEstimate
    ? microCnyToCny(monthlyEstimateMicroCny)
    : null;
  const requireMonthlyEstimatedCost = gates.requireMonthlyEstimatedCost !== false;
  return [
    {
      name: "false_positive_rate",
      passed: candidateMetrics.falsePositiveRate <= maxFalsePositiveRate,
      value: candidateMetrics.falsePositiveRate,
      threshold: maxFalsePositiveRate,
      reason: `candidate false positive rate ${candidateMetrics.falsePositiveRate} must be <= ${maxFalsePositiveRate}`,
    },
    {
      name: "monthly_estimated_token_cost_cny",
      passed: monthlyEstimatedTokenCostCny === null
        ? !requireMonthlyEstimatedCost
        : monthlyEstimatedTokenCostCny <= maxMonthlyEstimatedTokenCostCny,
      value: monthlyEstimatedTokenCostCny,
      threshold: maxMonthlyEstimatedTokenCostCny,
      reason: monthlyEstimatedTokenCostCny === null
        ? "candidate estimated monthly token cost is required for recommendation"
        : `candidate estimated monthly token cost ${monthlyEstimatedTokenCostCny} CNY must be <= ${maxMonthlyEstimatedTokenCostCny} CNY`,
    },
    {
      name: "known_bad_regressions",
      passed: regressions.length === 0,
      value: regressions.length,
      threshold: 0,
      reason: `candidate must not regress cases that baseline passed`,
    },
    {
      name: "auto_publish_precision_at_least_baseline",
      passed: candidateMetrics.autoPublishPrecision >= baselineMetrics.autoPublishPrecision,
      value: candidateMetrics.autoPublishPrecision,
      baselineValue: baselineMetrics.autoPublishPrecision,
      reason: `candidate auto-publish precision ${candidateMetrics.autoPublishPrecision} must be >= baseline ${baselineMetrics.autoPublishPrecision}`,
    },
  ];
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

function expectedReviewSignals(caseItem) {
  const expected = caseItem?.expected ?? {};
  const labels = new Set(caseItem?.case?.labels ?? []);
  const expectedDrafts = Array.isArray(expected.eventDrafts) ? expected.eventDrafts : [];
  const registrationActions = expectedDrafts
    .map((draft) => clean(draft.registrationAction))
    .filter(Boolean);
  const expectsRegistration = Boolean(
    expected.requiresReservation ||
      registrationActions.some((action) => registrationActionRequiresUserAction(action)),
  );
  const expectsRegistrationQr = Boolean(
    labels.has("qr_registration") ||
      registrationActions.includes("qr_code") ||
      expected.evidence?.registrationQr,
  );
  const expectsPoster = Boolean(
    labels.has("poster_or_image_dominant") ||
      expected.evidence?.poster ||
      expected.evidence?.posterImage,
  );
  const expectsMultipleEvents = Boolean(
    Number(expected.eventCount) > 1 ||
      labels.has("multi_event_article") ||
      labels.has("recurring_or_multiple_occurrences"),
  );
  const expectsDuplicateUpdate = Boolean(
    labels.has("duplicate_or_update") ||
      ["same_event", "update_existing", "cancel_existing", "withdraw_existing"].includes(
        clean(expected.dedupe?.decision),
      )
  );
  return {
    expectsRegistration,
    expectsRegistrationQr,
    expectsPoster,
    expectsMultipleEvents,
    expectsDuplicateUpdate,
    expectedEventCount: Number.isInteger(expected.eventCount) ? expected.eventCount : 0,
  };
}

function predictedSignalsFromExtraction({ extraction, policy } = {}) {
  const events = Array.isArray(extraction?.events) ? extraction.events : [];
  return {
    eventCount: events.length,
    hasRegistration: events.some((event) => {
      return registrationActionRequiresUserAction(clean(event.registrationAction));
    }),
    hasRegistrationQr: events.some(hasRegistrationQrSignal),
    hasPoster: events.some(hasPosterSignal),
    hasMultipleEvents: events.length > 1 ||
      events.some((event) => Array.isArray(event.occurrenceStartsAt) && event.occurrenceStartsAt.length > 1),
    handledDuplicateUpdate: [
      "same_event",
      "update_existing",
      "cancel_existing",
      "withdraw_existing",
    ].includes(clean(policy?.dedupeDecision ?? policy?.resolutionDecision)),
  };
}

function normalizePredictedSignals(signals = {}) {
  return {
    eventCount: Number.isInteger(signals.eventCount) ? signals.eventCount : 0,
    hasRegistration: Boolean(signals.hasRegistration),
    hasRegistrationQr: Boolean(signals.hasRegistrationQr),
    hasPoster: Boolean(signals.hasPoster),
    hasMultipleEvents: Boolean(signals.hasMultipleEvents),
    handledDuplicateUpdate: Boolean(signals.handledDuplicateUpdate),
  };
}

function emptyPredictedSignals() {
  return {
    eventCount: 0,
    hasRegistration: false,
    hasRegistrationQr: false,
    hasPoster: false,
    hasMultipleEvents: false,
    handledDuplicateUpdate: false,
  };
}

function scoreReviewSignals({ expectedSignals, predictedSignals }) {
  return {
    registrationCorrect: expectedSignals.expectsRegistration
      ? predictedSignals.hasRegistration
      : true,
    registrationQrCorrect: expectedSignals.expectsRegistrationQr
      ? predictedSignals.hasRegistrationQr
      : true,
    posterCorrect: expectedSignals.expectsPoster
      ? predictedSignals.hasPoster
      : true,
    multiEventCorrect: expectedSignals.expectsMultipleEvents
      ? predictedSignals.eventCount === expectedSignals.expectedEventCount ||
        predictedSignals.hasMultipleEvents
      : true,
    duplicateUpdateCorrect: expectedSignals.expectsDuplicateUpdate
      ? predictedSignals.handledDuplicateUpdate
      : true,
  };
}

function computeReviewMetrics(results = []) {
  const expectedRegistration = results.filter((item) => item.expectedSignals?.expectsRegistration);
  const expectedQr = results.filter((item) => item.expectedSignals?.expectsRegistrationQr);
  const expectedPoster = results.filter((item) => item.expectedSignals?.expectsPoster);
  const expectedMultiEvent = results.filter((item) => item.expectedSignals?.expectsMultipleEvents);
  const expectedDuplicateUpdate = results.filter((item) => item.expectedSignals?.expectsDuplicateUpdate);
  const humanFeedbackCount = results.reduce((total, item) => total + feedbackCount(item), 0);
  const humanRejectCount = results.reduce((total, item) => total + feedbackRejectCount(item), 0);
  return {
    qrExtractionSuccessRate: reviewRatio(
      expectedQr.filter((item) => item.signalScores?.registrationQrCorrect).length,
      expectedQr.length,
    ),
    posterExtractionSuccessRate: reviewRatio(
      expectedPoster.filter((item) => item.signalScores?.posterCorrect).length,
      expectedPoster.length,
    ),
    registrationSuccessRate: reviewRatio(
      expectedRegistration.filter((item) => item.signalScores?.registrationCorrect).length,
      expectedRegistration.length,
    ),
    multiEventSplitAccuracy: reviewRatio(
      expectedMultiEvent.filter((item) => item.signalScores?.multiEventCorrect).length,
      expectedMultiEvent.length,
    ),
    duplicateUpdateAccuracy: reviewRatio(
      expectedDuplicateUpdate.filter((item) => item.signalScores?.duplicateUpdateCorrect).length,
      expectedDuplicateUpdate.length,
    ),
    humanFeedbackCount,
    humanRejectRate: ratio(humanRejectCount, humanFeedbackCount),
  };
}

function registrationActionRequiresUserAction(action) {
  return [
    "required",
    "registration_required",
    "qr_code",
    "mini_program",
    "external_url",
  ].includes(action);
}

function hasRegistrationQrSignal(event = {}) {
  return clean(event.registrationAction) === "qr_code" && Boolean(
    clean(event.registrationQr) ||
      clean(event.registrationQrUrl) ||
      clean(event.registrationQrImageUrl) ||
      evidenceContainsRole(event.evidence, ["registration_qr", "qr"]),
  );
}

function hasPosterSignal(event = {}) {
  return Boolean(
    clean(event.posterUrl) ||
      clean(event.posterImageUrl) ||
      evidenceContainsRole(event.evidence, ["poster"]),
  );
}

function evidenceContainsRole(evidence, roles) {
  if (!Array.isArray(evidence)) return false;
  return evidence.some((item) => {
    const role = clean(item?.role ?? item?.kind ?? item?.type);
    return role && roles.includes(role);
  });
}

function feedbackCount(caseResult) {
  return Array.isArray(caseResult.feedback) ? caseResult.feedback.length : 0;
}

function feedbackRejectCount(caseResult) {
  if (!Array.isArray(caseResult.feedback)) return 0;
  return caseResult.feedback.filter((item) => {
    return ["not_event", "not_public", "duplicate_event"].includes(clean(item?.feedbackType));
  }).length;
}

function reviewRatio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return 1;
  return ratio(numerator, denominator);
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

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  const value = Number(numerator) / denominator;
  return Number.isFinite(value) ? value : 0;
}

function nullableRatio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const value = Number(numerator) / denominator;
  return Number.isFinite(value) ? value : null;
}

function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * quantile) - 1),
  );
  return values[index] ?? 0;
}

function microCnyToCny(value) {
  return finiteNumber(value, 0) / 1_000_000;
}

function writerForStore({ store, artifactDir }) {
  if (store === "memory") return createMemoryV5EvaluationWriter();
  if (store === "local") return createLocalV5EvaluationWriter({ artifactDir });
  throw new Error(`v5_evaluation_store_invalid:${store}`);
}

function guardRuntime({ allowLive, maxCostCny, target, variants = [] }) {
  if (target === "production") throw new Error("v5_evaluation_refuses_production_target");
  if (variants.some((variant) => liveVariants.has(baseVariantFromEvaluationVariant(variant))) && allowLive !== true) {
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

function liveLedgerContext({ caseItem, dataClass, evaluationRunId }) {
  const bundle = caseItem?.bundle ?? {};
  return {
    dataClass,
    runId: evaluationRunId,
    pipelineRunId: evaluationRunId,
    evaluationRunId,
    articleBundleId: clean(bundle.bundleId ?? caseItem?.case?.id),
    sourceId: clean(bundle.sourceId),
    sourceUrl: clean(bundle.sourceUrl),
  };
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

function parseNonNegativeNumber(value, arg) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`v5_evaluation_number_invalid:${arg}`);
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
