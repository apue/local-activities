import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultArtifactBucket = "eval-artifacts";
const productionTables = new Set([
  "canonical_events",
  "dedupe_decisions",
  "event_drafts",
  "evidence_assets",
  "excluded_articles",
  "processing_ledger",
]);
const allowedEvaluationTables = new Set([
  "evaluation_runs",
  "evaluation_case_results",
  "llm_usage_ledger",
]);

export const defaultEvaluationVariantIds = [
  "mock-expected-v1",
  "mock-overfilter-v1",
];

export function resolveExtractorVariants({
  variantIds = defaultEvaluationVariantIds,
  allowLive = false,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  return variantIds.map((variantId) => {
    if (variantId === "mock-expected-v1") return createMockExpectedVariant();
    if (variantId === "mock-overfilter-v1") return createMockOverfilterVariant();
    if (variantId === "live-configured") {
      if (!allowLive) throw new Error("evaluation_live_variant_requires_allow_live");
      return createConfiguredLiveVariant({ env, fetchImpl });
    }
    throw new Error(`evaluation_variant_unknown:${variantId}`);
  });
}

export function createMockExpectedVariant() {
  return {
    id: "mock-expected-v1",
    provider: "mock",
    model: "expected-output",
    promptVersion: "mock-expected-v1",
    schemaVersion: "analysis-output-v1",
    parameters: { behavior: "expected" },
    async analyze({ caseItem }) {
      return expectedToAnalysisOutput(caseItem, {
        usage: mockUsageForCase(caseItem, { latencyMs: 12 }),
      });
    },
  };
}

export function createMockOverfilterVariant() {
  return {
    id: "mock-overfilter-v1",
    provider: "mock",
    model: "overfilter",
    promptVersion: "mock-overfilter-v1",
    schemaVersion: "analysis-output-v1",
    parameters: { behavior: "exclude_event_cases" },
    async analyze({ caseItem }) {
      if (["extract", "review"].includes(caseItem.expected.action)) {
        return excludedOutput({
          reason: "mock_overfilter_excluded_event_case",
          confidence: 0.61,
          usage: mockUsageForCase(caseItem, { latencyMs: 7 }),
        });
      }
      return expectedToAnalysisOutput(caseItem, {
        usage: mockUsageForCase(caseItem, { latencyMs: 7 }),
      });
    },
  };
}

export function createConfiguredLiveVariant({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const baseUrl = clean(env.ANALYSIS_LLM_BASE_URL) ??
    clean(env.SILICONFLOW_BASE_URL) ??
    clean(env.ALIYUN_MODELSTUDIO_BASE_URL);
  const apiKey = clean(env.ANALYSIS_LLM_API_KEY) ??
    clean(env.SILICONFLOW_API_KEY) ??
    clean(env.ALIYUN_MODELSTUDIO_API_KEY);
  const model = clean(env.ANALYSIS_LLM_MODEL) ?? clean(env.EVALUATION_LLM_MODEL);
  if (!baseUrl) throw new Error("evaluation_live_base_url_required");
  if (!apiKey) throw new Error("evaluation_live_api_key_required");
  if (!model) throw new Error("evaluation_live_model_required");
  const inputTokenMicroCny = numberFromEnv(env.EVALUATION_INPUT_TOKEN_MICRO_CNY);
  const outputTokenMicroCny = numberFromEnv(env.EVALUATION_OUTPUT_TOKEN_MICRO_CNY);
  if (!positiveNumber(inputTokenMicroCny) || !positiveNumber(outputTokenMicroCny)) {
    throw new Error("evaluation_live_pricing_required");
  }

  return {
    id: `live-${safeId(model)}`,
    provider: clean(env.ANALYSIS_LLM_PROVIDER) ?? "openai-compatible",
    model,
    promptVersion: clean(env.ANALYSIS_PROMPT_VERSION) ?? "analyze-article-bundle-v1",
    schemaVersion: "analysis-output-v1",
    live: true,
    parameters: {
      baseUrl,
      maxOutputTokens: numberFromEnv(env.ANALYSIS_LLM_MAX_OUTPUT_TOKENS),
      timeoutMs: (numberFromEnv(env.ANALYSIS_LLM_TIMEOUT_SECONDS) ?? 60) * 1000,
      inputTokenMicroCny,
      outputTokenMicroCny,
    },
    async analyze({ caseItem }) {
      if (!caseItem.bundle) throw new Error("evaluation_live_bundle_required");
      return await analyzeWithOpenAiCompatibleProvider({
        baseUrl,
        apiKey,
        model,
        bundle: caseItem.bundle,
        fetchImpl,
        maxOutputTokens: numberFromEnv(env.ANALYSIS_LLM_MAX_OUTPUT_TOKENS),
        timeoutMs: (numberFromEnv(env.ANALYSIS_LLM_TIMEOUT_SECONDS) ?? 60) * 1000,
      });
    },
  };
}

export async function runEvaluation({
  corpus,
  variants,
  variantIds,
  caseIds,
  writer = createMemoryEvaluationWriter(),
  artifactBucket = defaultArtifactBucket,
  artifactPrefix = "runs",
  allowLive = false,
  maxCostCny = 0,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  if (!corpus?.manifest || !Array.isArray(corpus.cases)) {
    throw new Error("evaluation_corpus_required");
  }
  const selectedVariants = variants ??
    resolveExtractorVariants({ variantIds, allowLive, env, fetchImpl });
  const selectedCases = selectCases({ cases: corpus.cases, caseIds });
  const reports = [];
  for (const variant of selectedVariants) {
    reports.push(await runVariantEvaluation({
      corpus,
      cases: selectedCases,
      variant,
      writer,
      artifactBucket,
      artifactPrefix,
      maxCostMicroCny: Math.floor(Number(maxCostCny ?? 0) * 1_000_000),
      now,
    }));
  }
  return {
    ok: true,
    corpusVersion: corpus.manifest.version,
    caseCount: selectedCases.length,
    runCount: reports.length,
    runs: reports,
    writer,
  };
}

export function scoreEvaluationCase({ caseItem, output, error } = {}) {
  if (!caseItem?.expected) throw new Error("evaluation_case_expected_required");
  const expected = caseItem.expected;
  const expectedAction = expected.action;
  const actualAction = error
    ? "failed"
    : caseItem.captureResult?.ok === false
    ? "capture_failure"
    : actualActionFromOutput(output);
  const expectedEventCount = expected.eventCount ?? 0;
  const actualEventCount = output?.events?.length ?? 0;
  const expectedPublishState = expected.publish?.state;
  const actualPublishState = publishStateFromOutput(output, actualAction);
  const expectedDedupe = expected.dedupe?.decision;
  const actualDedupe = output?.dedupe?.decision;
  const expectedEvidence = actionableEvidence(expected.evidence ?? {});
  const actualEvidence = actionableEvidence(evidenceCountsFromOutput(output));

  const errors = [];
  const actionMatch = expectedAction === actualAction;
  if (!actionMatch) errors.push("action_mismatch");
  const eventCountMatch = expectedEventCount === actualEventCount;
  if (!eventCountMatch) errors.push("event_count_mismatch");
  const publishStateMatch = !expectedPublishState ||
    expectedPublishState === actualPublishState;
  if (!publishStateMatch) errors.push("publish_state_mismatch");
  const evidenceMatch = evidenceCountsMatch(expectedEvidence, actualEvidence);
  if (!evidenceMatch) errors.push("evidence_mismatch");
  const dedupeMatch = expectedEventCount === 0 || !expectedDedupe ||
    normalizeDedupeDecision(expectedDedupe) === actualDedupe;
  if (!dedupeMatch) errors.push("dedupe_mismatch");
  if (error) errors.push("provider_error");

  const falsePositive = ["exclude", "capture_failure"].includes(expectedAction) &&
    ["extract", "review"].includes(actualAction);
  const falseNegative = ["extract", "review"].includes(expectedAction) &&
    ["exclude", "capture_failure", "failed"].includes(actualAction);
  const passed = errors.length === 0;

  return {
    passed,
    expectedAction,
    actualAction,
    errors,
    scores: {
      actionMatch,
      eventCountMatch,
      publishStateMatch,
      evidenceMatch,
      dedupeMatch,
      falsePositive,
      falseNegative,
      expectedEventCount,
      actualEventCount,
      expectedPublishState,
      actualPublishState,
      expectedEvidence,
      actualEvidence,
      expectedDedupe,
      actualDedupe,
    },
  };
}

export function createMemoryEvaluationWriter() {
  const state = {
    rows: {
      evaluation_runs: [],
      evaluation_case_results: [],
      llm_usage_ledger: [],
    },
    artifacts: new Map(),
  };
  return {
    state,
    async writeEvaluationRun(row) {
      upsertRow(state.rows.evaluation_runs, cleanObject(row), "run_id");
    },
    async writeEvaluationCaseResult(row) {
      upsertRow(
        state.rows.evaluation_case_results,
        cleanObject(row),
        (item) => `${item.run_id}:${item.case_id}`,
      );
    },
    async writeUsage(row) {
      upsertRow(state.rows.llm_usage_ledger, cleanObject(row), "usage_id");
    },
    async writeArtifact(artifactPath, value) {
      state.artifacts.set(artifactPath, value);
    },
    table(name) {
      return state.rows[name] ?? [];
    },
    artifacts() {
      return state.artifacts;
    },
  };
}

export function createLocalEvaluationWriter({ artifactDir } = {}) {
  if (!artifactDir) throw new Error("evaluation_artifact_dir_required");
  const memory = createMemoryEvaluationWriter();
  return {
    ...memory,
    async writeArtifact(artifactPath, value) {
      await memory.writeArtifact(artifactPath, value);
      const filePath = path.join(artifactDir, artifactPath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

export async function createSupabaseEvaluationWriter({
  env = process.env,
  client,
  artifactBucket = defaultArtifactBucket,
} = {}) {
  if (artifactBucket !== defaultArtifactBucket) {
    throw new Error(`evaluation_artifact_bucket_forbidden:${artifactBucket}`);
  }
  const supabase = client ?? await createSupabaseClientFromEnv(env);
  return {
    async writeEvaluationRun(row) {
      await upsertSupabase(supabase, "evaluation_runs", row, "run_id");
    },
    async writeEvaluationCaseResult(row) {
      await upsertSupabase(
        supabase,
        "evaluation_case_results",
        row,
        "run_id,case_id",
      );
    },
    async writeUsage(row) {
      const usageRow = cleanObject(row);
      if (usageRow.mode !== "eval") {
        throw new Error("evaluation_usage_mode_required");
      }
      if (!clean(usageRow.evaluation_run_id)) {
        throw new Error("evaluation_usage_run_id_required");
      }
      await upsertSupabase(supabase, "llm_usage_ledger", usageRow, "usage_id");
    },
    async writeArtifact(artifactPath, value) {
      const { error } = await supabase.storage.from(artifactBucket).upload(
        artifactPath,
        `${JSON.stringify(value, null, 2)}\n`,
        {
          contentType: "application/json",
          upsert: true,
        },
      );
      if (error) throw error;
    },
  };
}

async function runVariantEvaluation({
  corpus,
  cases,
  variant,
  writer,
  artifactBucket,
  artifactPrefix,
  maxCostMicroCny,
  now,
}) {
  validateEvaluationWriter(writer);
  const startedAt = now.toISOString();
  const runId = `eval-${safeId(variant.id)}-${timestampId(now)}`;
  const reportPath = `${artifactPrefix}/${runId}/report.json`;
  let accumulatedCostMicroCny = 0;
  const runBase = {
    run_id: runId,
    provider: variant.provider,
    model: variant.model,
    prompt_version: variant.promptVersion,
    schema_version: variant.schemaVersion,
    parameters: variant.parameters ?? {},
    corpus_version: corpus.manifest.version,
    status: "running",
    started_at: startedAt,
    case_count: cases.length,
    pass_count: 0,
    fail_count: 0,
    summary: {},
    artifact_bucket: artifactBucket,
    artifact_path: reportPath,
  };
  await writer.writeEvaluationRun(runBase);

  const caseResults = [];
  const usageRows = [];
  try {
    for (const caseItem of cases) {
      if (variant.live && maxCostMicroCny <= 0) {
        throw new Error("evaluation_live_budget_required");
      }
      if (variant.live && accumulatedCostMicroCny >= maxCostMicroCny) {
        throw new Error("evaluation_live_budget_exhausted");
      }
      const result = await runEvaluationCase({
        runId,
        caseItem,
        variant,
        writer,
        artifactPrefix,
      });
      accumulatedCostMicroCny += result.usageRow.cost_micro_cny;
      caseResults.push(result.caseResult);
      usageRows.push(result.usageRow);
      if (variant.live && accumulatedCostMicroCny > maxCostMicroCny) {
        throw new Error("evaluation_live_budget_exhausted");
      }
    }
  } catch (error) {
    const summary = summarizeEvaluation({ caseResults, usageRows });
    const failedRun = {
      ...runBase,
      status: "failed",
      completed_at: new Date(now.getTime() + summary.totalLatencyMs).toISOString(),
      pass_count: summary.passCount,
      fail_count: summary.failCount + 1,
      summary: {
        ...summary,
        failure: errorDetails(error),
      },
    };
    await writer.writeEvaluationRun(failedRun);
    throw error;
  }

  const summary = summarizeEvaluation({ caseResults, usageRows });
  const completedAt = new Date(now.getTime() + summary.totalLatencyMs)
    .toISOString();
  const finalRun = {
    ...runBase,
    status: "completed",
    completed_at: completedAt,
    pass_count: summary.passCount,
    fail_count: summary.failCount,
    summary,
  };
  const report = {
    run: finalRun,
    variant: publicVariant(variant),
    corpus: {
      version: corpus.manifest.version,
      description: corpus.manifest.description,
      caseCount: cases.length,
    },
    cases: caseResults,
  };
  await writer.writeArtifact(reportPath, report);
  await writer.writeEvaluationRun(finalRun);
  return report;
}

async function runEvaluationCase({
  runId,
  caseItem,
  variant,
  writer,
  artifactPrefix,
}) {
  const caseStarted = Date.now();
  let output;
  let providerError;
  try {
    if (caseItem.captureResult?.ok === false) {
      output = undefined;
    } else {
      output = await variant.analyze({ caseItem, bundle: caseItem.bundle });
    }
  } catch (error) {
    providerError = error;
  }

  const score = scoreEvaluationCase({
    caseItem,
    output,
    error: providerError,
  });
  const usage = normalizeUsage(output?.usage, {
    latencyMs: Math.max(Date.now() - caseStarted, 0),
  });
  const usageId = `usage-${runId}-${safeId(caseItem.case.id)}`;
  const costMicroCny = estimateCostMicroCny(usage, variant.parameters ?? {});
  const usageRow = {
    usage_id: usageId,
    operation: "evaluation_case",
    provider: variant.provider,
    model: variant.model,
    status: providerError ? "failed" : "succeeded",
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    cached_input_tokens: usage.cachedInputTokens ?? 0,
    reasoning_output_tokens: usage.reasoningOutputTokens ?? 0,
    cost_micro_cny: costMicroCny,
    latency_ms: usage.latencyMs,
    evaluation_run_id: runId,
    mode: "eval",
    metadata: {
      caseId: caseItem.case.id,
      variantId: variant.id,
      promptVersion: variant.promptVersion,
      schemaVersion: variant.schemaVersion,
    },
  };
  await writer.writeUsage(usageRow);

  const artifactPath = `${artifactPrefix}/${runId}/cases/${safeId(caseItem.case.id)}.json`;
  const caseArtifact = {
    case: caseItem.case,
    expected: caseItem.expected,
    actual: {
      action: score.actualAction,
      output,
      error: providerError ? errorDetails(providerError) : undefined,
    },
    scores: score.scores,
    errors: score.errors,
  };
  await writer.writeArtifact(artifactPath, caseArtifact);

  const caseResult = {
    result_id: `eval-result-${runId}-${safeId(caseItem.case.id)}`,
    run_id: runId,
    case_id: caseItem.case.id,
    expected_action: score.expectedAction,
    actual_action: score.actualAction,
    passed: score.passed,
    scores: {
      ...score.scores,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        costMicroCny,
        latencyMs: usage.latencyMs,
      },
    },
    errors: score.errors.map((reason) => ({ reason })),
    usage_id: usageId,
    artifact_path: artifactPath,
  };
  await writer.writeEvaluationCaseResult(caseResult);
  return { caseResult, usageRow };
}

function expectedToAnalysisOutput(caseItem, { usage } = {}) {
  const expected = caseItem.expected;
  if (expected.action === "exclude") {
    return excludedOutput({
      reason: expected.publish?.reasons?.[0] ?? "expected_exclusion",
      confidence: expected.requiresReservation ? 0.93 : 0.96,
      usage,
      excludedArticle: {
        triageDecision: exclusionTriageDecision(expected),
        exclusionReason: expected.publish?.reasons?.[0] ?? "expected_exclusion",
        publicSignals: [],
        exclusionSignals: expected.publish?.reasons ?? [],
      },
    });
  }

  const events = (expected.eventDrafts ?? []).map((draft, index) =>
    eventFromDraft({
      draft,
      expected,
      caseItem,
      index,
    })
  );
  return {
    decision: decisionFromExpectedPublish(expected.publish?.state),
    reason: expected.publish?.reasons?.[0] ?? "expected_extraction",
    confidence: expected.action === "review" ? 0.78 : 0.96,
    events,
    dedupe: {
      decision: normalizeDedupeDecision(expected.dedupe?.decision),
      confidence: expected.dedupe?.decision === "same_event" ? 0.94 : 0.91,
      candidates: expected.dedupe?.canonicalEventId
        ? [{ eventId: expected.dedupe.canonicalEventId }]
        : [],
      reasoning: expected.dedupe?.productVisibleReasons?.[0] ??
        expected.publish?.reasons?.[0] ??
        "expected_dedupe",
    },
    usage: normalizeUsage(usage),
  };
}

function eventFromDraft({ draft, expected, caseItem, index }) {
  const evidence = evidenceSelectionsFromExpected({ expected, caseItem, eventIndex: index });
  return {
    title: draft.title ?? `Expected event ${index + 1}`,
    organizer: draft.organizer,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    timezone: draft.timezone ?? "Asia/Shanghai",
    city: draft.city ?? "Beijing",
    venueName: draft.venueName,
    venueAddress: draft.venueAddress,
    reservationStatus: expected.requiresReservation ? "required" : "not_required",
    registrationAction: index < (expected.evidence?.miniProgramActionCount ?? 0)
      ? "mini_program"
      : draft.registrationAction,
    registrationUrl: index < (expected.evidence?.registrationUrlCount ?? 0)
      ? draft.registrationUrl ?? "https://example.com/register"
      : draft.registrationUrl,
    scheduleText: draft.scheduleText,
    summary: draft.summary,
    publicEligibility: draft.publicEligibility ?? expected.publicEligibility ?? "public",
    triageDecision: "public_activity",
    triageAction: expected.action === "review" ? "review" : "extract",
    eventKind: eventKindFromExpected(expected),
    scheduleKind: scheduleKindFromExpected(expected),
    recurrenceRule: draft.recurrenceRule,
    occurrenceStartsAt: draft.occurrenceStartsAt ?? [],
    confidence: expected.action === "review" ? 0.78 : 0.96,
    publicSignals: ["regression_expected_public_event"],
    exclusionSignals: [],
    evidence,
    publish: {
      createCanonicalEvent: expected.publish?.state === "public",
      confidence: expected.publish?.state === "public" ? 0.96 : 0.75,
    },
  };
}

function excludedOutput({
  reason,
  confidence,
  usage,
  excludedArticle,
} = {}) {
  return {
    decision: "excluded",
    reason: reason ?? "excluded",
    confidence: confidence ?? 0.9,
    events: [],
    excludedArticle: excludedArticle ?? {
      triageDecision: "not_event",
      exclusionReason: reason ?? "excluded",
      publicSignals: [],
      exclusionSignals: [reason ?? "excluded"],
    },
    dedupe: {
      decision: "insufficient_info",
      confidence: confidence ?? 0.9,
      candidates: [],
      reasoning: reason ?? "excluded",
    },
    usage: normalizeUsage(usage),
  };
}

function evidenceSelectionsFromExpected({ expected, caseItem, eventIndex }) {
  const evidence = [];
  if (eventIndex < (expected.evidence?.posterCount ?? 0)) {
    evidence.push({
      imageId: imageIdForSelection(caseItem, "poster", eventIndex),
      role: "poster",
      confidence: 0.91,
    });
  }
  if (eventIndex < (expected.evidence?.qrCodeCount ?? 0)) {
    evidence.push({
      imageId: imageIdForSelection(caseItem, "qr", eventIndex),
      role: "qr",
      confidence: 0.88,
    });
  }
  return evidence;
}

function imageIdForSelection(caseItem, role, index) {
  const images = caseItem.bundle?.images ?? [];
  const preferred = images.find((image) =>
    String(image.role ?? image.roleHint ?? "").includes(role)
  ) ?? images[index];
  return preferred?.id ?? preferred?.imageId ?? `${role}-${index + 1}`;
}

function actualActionFromOutput(output) {
  if (!output || output.decision === "excluded" || !output.events?.length) {
    return "exclude";
  }
  if (
    output.decision === "needs_review" &&
    output.events.some((event) => event.triageAction === "review")
  ) {
    return "review";
  }
  return "extract";
}

function publishStateFromOutput(output, actualAction) {
  if (actualAction === "capture_failure" || actualAction === "failed") {
    return actualAction;
  }
  if (!output) return "failed";
  return ({
    published: "public",
    needs_review: "needs_review",
    needs_info: "needs_info",
    excluded: "rejected",
    duplicate: "blocked",
  })[output.decision] ?? "needs_review";
}

function decisionFromExpectedPublish(state) {
  return ({
    public: "published",
    needs_review: "needs_review",
    needs_info: "needs_info",
    rejected: "excluded",
    blocked: "duplicate",
  })[state] ?? "needs_review";
}

function normalizeDedupeDecision(value) {
  if (value === "reject") return "insufficient_info";
  if (value === "same") return "same_event";
  return [
    "new_event",
    "same_event",
    "update_existing",
    "cancel_existing",
    "withdraw_existing",
    "insufficient_info",
  ].includes(value)
    ? value
    : "new_event";
}

function eventKindFromExpected(expected) {
  const reasons = expected.publish?.reasons ?? [];
  if (reasons.includes("long_running_exhibition")) return "long_running";
  if (reasons.includes("recurring_schedule")) return "recurring";
  return "single";
}

function scheduleKindFromExpected(expected) {
  const kind = eventKindFromExpected(expected);
  return kind === "long_running" || kind === "recurring" ? kind : "single";
}

function exclusionTriageDecision(expected) {
  const reasons = expected.publish?.reasons ?? [];
  if (reasons.includes("not_beijing")) return "unsupported";
  if (reasons.includes("not_general_public")) return "internal_or_private";
  if (reasons.includes("official_visit_non_public_news")) return "official_visit";
  if (reasons.includes("generic_not_event")) return "not_event";
  return "not_event";
}

function evidenceCountsFromOutput(output) {
  const counts = {
    posterCount: 0,
    qrCodeCount: 0,
    registrationUrlCount: 0,
    miniProgramActionCount: 0,
  };
  for (const event of output?.events ?? []) {
    for (const selection of event.evidence ?? []) {
      if (selection.role === "poster") counts.posterCount += 1;
      if (selection.role === "qr" || selection.role === "registration") {
        counts.qrCodeCount += 1;
      }
    }
    if (event.registrationUrl) counts.registrationUrlCount += 1;
    if (String(event.registrationAction ?? "").includes("mini")) {
      counts.miniProgramActionCount += 1;
    }
  }
  return counts;
}

function actionableEvidence(value) {
  return {
    posterCount: integer(value.posterCount),
    qrCodeCount: integer(value.qrCodeCount),
    registrationUrlCount: integer(value.registrationUrlCount),
    miniProgramActionCount: integer(value.miniProgramActionCount),
  };
}

function evidenceCountsMatch(expected, actual) {
  return Object.keys(expected).every((key) => expected[key] === actual[key]);
}

function summarizeEvaluation({ caseResults, usageRows }) {
  const caseCount = caseResults.length;
  const passCount = caseResults.filter((item) => item.passed).length;
  const failCount = caseCount - passCount;
  const falsePositiveCount = caseResults.filter((item) =>
    item.scores.falsePositive
  ).length;
  const falseNegativeCount = caseResults.filter((item) =>
    item.scores.falseNegative
  ).length;
  const totalTokens = sum(usageRows, "total_tokens");
  const totalCostMicroCny = sum(usageRows, "cost_micro_cny");
  const totalLatencyMs = sum(usageRows, "latency_ms");
  return {
    caseCount,
    passCount,
    failCount,
    passRate: caseCount ? passCount / caseCount : 0,
    actionAccuracy: ratio(
      caseResults.filter((item) => item.scores.actionMatch).length,
      caseCount,
    ),
    eventCountAccuracy: ratio(
      caseResults.filter((item) => item.scores.eventCountMatch).length,
      caseCount,
    ),
    publishStateAccuracy: ratio(
      caseResults.filter((item) => item.scores.publishStateMatch).length,
      caseCount,
    ),
    evidenceAccuracy: ratio(
      caseResults.filter((item) => item.scores.evidenceMatch).length,
      caseCount,
    ),
    falsePositiveCount,
    falseNegativeCount,
    totalInputTokens: sum(usageRows, "input_tokens"),
    totalOutputTokens: sum(usageRows, "output_tokens"),
    totalTokens,
    totalCostMicroCny,
    totalLatencyMs,
    averageLatencyMs: caseCount ? totalLatencyMs / caseCount : 0,
    failedCaseIds: caseResults
      .filter((item) => !item.passed)
      .map((item) => item.case_id),
  };
}

async function analyzeWithOpenAiCompatibleProvider({
  baseUrl,
  apiKey,
  model,
  bundle,
  fetchImpl,
  maxOutputTokens,
  timeoutMs,
}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You evaluate a captured Beijing cultural activity article. Return strict JSON matching the existing analysis-output-v1 schema.",
          },
          {
            role: "user",
            content: JSON.stringify({
              articleText: String(bundle.text ?? "").slice(0, 24000),
              html: String(bundle.html ?? "").slice(0, 12000),
              links: bundle.links ?? [],
              images: bundle.images ?? [],
            }),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: maxOutputTokens,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`evaluation_provider_http_${response.status}`);
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (!content) throw new Error("evaluation_provider_empty_output");
    const parsed = JSON.parse(content);
    return {
      decision: parsed.decision,
      reason: parsed.reason,
      confidence: clamp(parsed.confidence),
      events: Array.isArray(parsed.events) ? parsed.events : [],
      excludedArticle: parsed.excludedArticle,
      dedupe: parsed.dedupe ?? { decision: "insufficient_info" },
      usage: normalizeUsage(parsed.usage, {
        inputTokens: body?.usage?.prompt_tokens,
        outputTokens: body?.usage?.completion_tokens,
        totalTokens: body?.usage?.total_tokens,
        cachedInputTokens: body?.usage?.prompt_tokens_details?.cached_tokens,
        reasoningOutputTokens: body?.usage?.completion_tokens_details?.reasoning_tokens,
        latencyMs: Date.now() - started,
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

function mockUsageForCase(caseItem, overrides = {}) {
  const textTokens = Math.ceil(String(caseItem.bundle?.text ?? "").length / 4);
  const outputTokens = 80 + (caseItem.expected.eventCount ?? 0) * 60;
  return {
    inputTokens: 100 + textTokens,
    outputTokens,
    totalTokens: 100 + textTokens + outputTokens,
    costMicroCny: 0,
    ...overrides,
  };
}

function normalizeUsage(usage, fallback = {}) {
  const inputTokens = integer(usage?.inputTokens ?? fallback.inputTokens);
  const outputTokens = integer(usage?.outputTokens ?? fallback.outputTokens);
  const totalTokens = integer(
    usage?.totalTokens ?? fallback.totalTokens ?? inputTokens + outputTokens,
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costMicroCny: integer(usage?.costMicroCny ?? fallback.costMicroCny),
    cachedInputTokens: integer(usage?.cachedInputTokens ?? fallback.cachedInputTokens),
    reasoningOutputTokens: integer(
      usage?.reasoningOutputTokens ?? fallback.reasoningOutputTokens,
    ),
    latencyMs: integer(usage?.latencyMs ?? fallback.latencyMs),
  };
}

function estimateCostMicroCny(usage, parameters) {
  const inputRate = Number(parameters.inputTokenMicroCny ?? 0);
  const outputRate = Number(parameters.outputTokenMicroCny ?? 0);
  const explicit = Number(usage.costMicroCny ?? 0);
  if (explicit > 0) return Math.round(explicit);
  return Math.round(
    usage.inputTokens * inputRate + usage.outputTokens * outputRate,
  );
}

function selectCases({ cases, caseIds }) {
  if (!caseIds?.length) return cases;
  const wanted = new Set(caseIds);
  const selected = cases.filter((item) => wanted.has(item.case.id));
  if (selected.length !== wanted.size) {
    const selectedIds = new Set(selected.map((item) => item.case.id));
    const missing = [...wanted].filter((caseId) => !selectedIds.has(caseId));
    throw new Error(`evaluation_case_unknown:${missing.join(",")}`);
  }
  return selected;
}

function validateEvaluationWriter(writer) {
  for (const method of [
    "writeEvaluationRun",
    "writeEvaluationCaseResult",
    "writeUsage",
    "writeArtifact",
  ]) {
    if (typeof writer?.[method] !== "function") {
      throw new Error(`evaluation_writer_missing_method:${method}`);
    }
  }
}

async function createSupabaseClientFromEnv(env) {
  const supabaseUrl = clean(env.NEXT_PUBLIC_SUPABASE_URL) ??
    clean(env.SUPABASE_URL) ??
    clean(env.SUPA_URL);
  const serviceKey = clean(env.SUPABASE_SECRET_KEY) ??
    clean(env.SUPABASE_SERVICE_ROLE_KEY) ??
    clean(env.SUPA_SERVICE_KEY);
  if (!supabaseUrl) throw new Error("evaluation_missing_supabase_url");
  if (!serviceKey) throw new Error("evaluation_missing_supabase_service_key");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function upsertSupabase(client, table, row, onConflict) {
  if (!allowedEvaluationTables.has(table)) {
    throw new Error(`evaluation_forbidden_table:${table}`);
  }
  if (productionTables.has(table)) {
    throw new Error(`evaluation_production_table_forbidden:${table}`);
  }
  const { error } = await client.from(table).upsert(cleanObject(row), {
    onConflict,
  });
  if (error) throw error;
}

function upsertRow(rows, row, key) {
  const keyValue = typeof key === "function" ? key(row) : row[key];
  const index = rows.findIndex((item) =>
    (typeof key === "function" ? key(item) : item[key]) === keyValue
  );
  if (index >= 0) rows[index] = row;
  else rows.push(row);
}

function publicVariant(variant) {
  return {
    id: variant.id,
    provider: variant.provider,
    model: variant.model,
    promptVersion: variant.promptVersion,
    schemaVersion: variant.schemaVersion,
    parameters: variant.parameters ?? {},
    live: variant.live === true,
  };
}

function cleanObject(value) {
  if (Array.isArray(value)) return value.map(cleanObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, cleanObject(item)]),
  );
}

function errorDetails(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : undefined,
  };
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + integer(row[key]), 0);
}

function timestampId(date) {
  return date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function safeId(value) {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function integer(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function numberFromEnv(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
