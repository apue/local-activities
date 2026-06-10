export const ALLOWED_V5_DATA_CLASSES = Object.freeze(["production", "eval", "test", "smoke"]);

const allowedDataClasses = new Set(ALLOWED_V5_DATA_CLASSES);
const usageFieldNames = Object.freeze([
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "costMicroCny",
  "latencyMs",
]);
const artifactPointerFieldNames = Object.freeze(["artifactId", "path", "kind", "hash"]);
const nodeResultContractVersion = "v5-node-result.v1";

export class V5PipelineContractError extends Error {
  constructor({ nodeName = "unknown", violations = [] } = {}) {
    super(`v5_pipeline_contract_violation:${nodeName}:${violations.map((item) => item.reason).join(",")}`);
    this.name = "V5PipelineContractError";
    this.nodeName = nodeName;
    this.violations = violations;
  }
}

export function createPipelineContext(context = {}) {
  const normalizedContext = {
    ...context,
    dataClass: clean(context.dataClass),
    runId: clean(context.runId),
  };
  return validatePipelineContext(normalizedContext);
}

export function validatePipelineContext(context) {
  const violations = contextViolations(context);
  if (violations.length > 0) {
    throw new V5PipelineContractError({ nodeName: "pipeline_context", violations });
  }
  return context;
}

export function createUsagePlaceholder(usage = {}, { latencyMs = 0 } = {}) {
  const inputTokens = preserveOrDefaultNonNegativeInteger(usage.inputTokens, 0);
  const outputTokens = preserveOrDefaultNonNegativeInteger(usage.outputTokens, 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: preserveOrDefaultNonNegativeInteger(
      usage.totalTokens,
      isNonNegativeInteger(inputTokens) && isNonNegativeInteger(outputTokens)
        ? inputTokens + outputTokens
        : 0,
    ),
    costMicroCny: preserveOrDefaultNonNegativeInteger(usage.costMicroCny, 0),
    latencyMs: preserveOrDefaultNonNegativeInteger(usage.latencyMs, latencyMs),
  };
}

export function createArtifactPointer(pointer = {}) {
  return {
    ...pointer,
    artifactId: optionalClean(pointer.artifactId),
    path: optionalClean(pointer.path),
    kind: optionalClean(pointer.kind),
    hash: optionalClean(pointer.hash),
  };
}

export function createAttemptTrace(attempt = {}) {
  const latencyMs = computeLatencyMs(attempt.startedAt, attempt.finishedAt);
  return {
    ...attempt,
    attempt: positiveInteger(attempt.attempt, 1),
    provider: clean(attempt.provider),
    model: clean(attempt.model),
    promptVersion: clean(attempt.promptVersion),
    schemaVersion: clean(attempt.schemaVersion),
    usage: createUsagePlaceholder(attempt.usage, { latencyMs }),
    startedAt: clean(attempt.startedAt),
    finishedAt: clean(attempt.finishedAt),
    reason: clean(attempt.reason),
    validatorIssues: Array.isArray(attempt.validatorIssues) ? attempt.validatorIssues : [],
  };
}

export function buildNodeResult(result = {}) {
  const startedAt = clean(result.startedAt);
  const finishedAt = clean(result.finishedAt);
  const latencyMs = computeLatencyMs(startedAt, finishedAt);
  const attempts = Array.isArray(result.attempts)
    ? result.attempts.map((attempt) => createAttemptTrace(attempt))
    : undefined;

  return {
    ...result,
    nodeName: clean(result.nodeName),
    nodeVersion: clean(result.nodeVersion),
    contractVersion: clean(result.contractVersion) ?? nodeResultContractVersion,
    startedAt,
    finishedAt,
    latencyMs,
    status: clean(result.status),
    decision: clean(result.decision),
    reason: clean(result.reason),
    inputArtifacts: Array.isArray(result.inputArtifacts)
      ? result.inputArtifacts.map((pointer) => createArtifactPointer(pointer))
      : [],
    outputArtifacts: Array.isArray(result.outputArtifacts)
      ? result.outputArtifacts.map((pointer) => createArtifactPointer(pointer))
      : [],
    attempts,
    usage: createUsagePlaceholder(result.usage, { latencyMs }),
  };
}

export function collectV5ContractViolations(result) {
  const violations = [];
  if (!result || typeof result !== "object") {
    return [{ reason: "v5_node_result_required" }];
  }

  if (!clean(result.nodeName)) {
    violations.push({ reason: "v5_node_result_node_name_required" });
  }
  if (!clean(result.nodeVersion)) {
    violations.push({ reason: "v5_node_result_node_version_required" });
  }
  if (!clean(result.contractVersion)) {
    violations.push({ reason: "v5_node_result_contract_version_required" });
  }
  violations.push(...contextViolations(result.context));
  violations.push(...requiredTextViolations(result, [
    ["startedAt", "v5_node_result_started_at_required"],
    ["finishedAt", "v5_node_result_finished_at_required"],
    ["status", "v5_node_result_status_required"],
    ["decision", "v5_node_result_decision_required"],
    ["reason", "v5_node_result_reason_required"],
  ]));
  violations.push(...timestampViolations(result, "v5_node_result"));
  if (!Array.isArray(result.inputArtifacts)) {
    violations.push({ reason: "v5_node_result_input_artifacts_required" });
  } else {
    violations.push(...artifactPointerViolations(result.inputArtifacts, "inputArtifacts"));
  }
  if (!Array.isArray(result.outputArtifacts)) {
    violations.push({ reason: "v5_node_result_output_artifacts_required" });
  } else {
    violations.push(...artifactPointerViolations(result.outputArtifacts, "outputArtifacts"));
  }
  violations.push(...usageViolations(result.usage, "v5_node_result_usage"));
  if (result.latencyMs !== undefined && !isNonNegativeInteger(result.latencyMs)) {
    violations.push({ reason: "v5_node_result_latency_ms_invalid", value: result.latencyMs });
  }
  if (!Array.isArray(result.externalCalls)) {
    violations.push({ reason: "v5_node_result_external_calls_required" });
  }
  if (result.attempts !== undefined) {
    if (!Array.isArray(result.attempts)) {
      violations.push({ reason: "v5_node_result_attempts_array_required" });
    } else {
      violations.push(...attemptTraceViolations(result.attempts));
    }
  }
  if (result.errors !== undefined && !Array.isArray(result.errors)) {
    violations.push({ reason: "v5_node_result_errors_array_required" });
  }
  if (!Array.isArray(result.validationIssues)) {
    violations.push({ reason: "v5_node_result_validation_issues_required" });
  }
  return violations;
}

export function assertV5Contract(result) {
  const violations = collectV5ContractViolations(result);
  if (violations.length > 0) {
    throw new V5PipelineContractError({ nodeName: clean(result?.nodeName) ?? "unknown", violations });
  }
  return result;
}

function contextViolations(context) {
  const violations = [];
  if (!context || typeof context !== "object") {
    return [{ reason: "v5_context_required" }];
  }
  if (!allowedDataClasses.has(context.dataClass)) {
    violations.push({
      reason: "v5_context_data_class_invalid",
      value: context.dataClass,
    });
  }
  if (!clean(context.runId)) {
    violations.push({ reason: "v5_context_run_id_required" });
  }
  return violations;
}

function requiredTextViolations(object, fields) {
  const violations = [];
  for (const [fieldName, reason] of fields) {
    if (!clean(object[fieldName])) {
      violations.push({ reason });
    }
  }
  return violations;
}

function timestampViolations(object, prefix) {
  const violations = [];
  const startedAt = clean(object.startedAt);
  const finishedAt = clean(object.finishedAt);
  if (startedAt && !isValidTimestamp(startedAt)) {
    violations.push({ reason: `${prefix}_started_at_invalid`, value: startedAt });
  }
  if (finishedAt && !isValidTimestamp(finishedAt)) {
    violations.push({ reason: `${prefix}_finished_at_invalid`, value: finishedAt });
  }
  if (startedAt && finishedAt && isValidTimestamp(startedAt) && isValidTimestamp(finishedAt)) {
    if (Date.parse(finishedAt) < Date.parse(startedAt)) {
      violations.push({ reason: `${prefix}_time_order_invalid` });
    }
  }
  return violations;
}

function artifactPointerViolations(pointers, fieldName) {
  const violations = [];
  pointers.forEach((pointer, index) => {
    if (!pointer || typeof pointer !== "object" || Array.isArray(pointer)) {
      violations.push({
        reason: "v5_artifact_pointer_object_required",
        fieldName,
        index,
      });
      return;
    }
    if (!clean(pointer.artifactId) && !clean(pointer.path)) {
      violations.push({
        reason: "v5_artifact_pointer_identity_required",
        fieldName,
        index,
      });
    }
    if (!clean(pointer.kind)) {
      violations.push({
        reason: "v5_artifact_pointer_kind_required",
        fieldName,
        index,
      });
    }
    if (!clean(pointer.hash)) {
      violations.push({
        reason: "v5_artifact_pointer_hash_required",
        fieldName,
        index,
      });
    }
    for (const pointerFieldName of artifactPointerFieldNames) {
      if (pointer[pointerFieldName] !== undefined && !clean(pointer[pointerFieldName])) {
        violations.push({
          reason: "v5_artifact_pointer_field_invalid",
          fieldName,
          pointerFieldName,
          index,
        });
      }
    }
  });
  return violations;
}

function usageViolations(usage, prefix) {
  const violations = [];
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return [{ reason: `${prefix}_required` }];
  }
  for (const fieldName of usageFieldNames) {
    if (!isNonNegativeInteger(usage[fieldName])) {
      violations.push({
        reason: `${prefix}_${snakeCase(fieldName)}_invalid`,
        value: usage[fieldName],
      });
    }
  }
  return violations;
}

function attemptTraceViolations(attempts) {
  const violations = [];
  attempts.forEach((attempt, index) => {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) {
      violations.push({ reason: "v5_attempt_trace_object_required", index });
      return;
    }
    if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) {
      violations.push({ reason: "v5_attempt_trace_attempt_invalid", index, value: attempt.attempt });
    }
    violations.push(...requiredTextViolations(attempt, [
      ["provider", "v5_attempt_trace_provider_required"],
      ["model", "v5_attempt_trace_model_required"],
      ["promptVersion", "v5_attempt_trace_prompt_version_required"],
      ["schemaVersion", "v5_attempt_trace_schema_version_required"],
      ["startedAt", "v5_attempt_trace_started_at_required"],
      ["finishedAt", "v5_attempt_trace_finished_at_required"],
      ["reason", "v5_attempt_trace_reason_required"],
    ]).map((violation) => ({ ...violation, index })));
    violations.push(...timestampViolations(attempt, "v5_attempt_trace").map((violation) => ({
      ...violation,
      index,
    })));
    violations.push(...usageViolations(attempt.usage, "v5_attempt_trace_usage").map((violation) => ({
      ...violation,
      index,
    })));
    if (!Array.isArray(attempt.validatorIssues)) {
      violations.push({ reason: "v5_attempt_trace_validator_issues_array_required", index });
    }
  });
  return violations;
}

function computeLatencyMs(startedAt, finishedAt) {
  if (!isValidTimestamp(startedAt) || !isValidTimestamp(finishedAt)) {
    return 0;
  }
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

function isValidTimestamp(value) {
  if (!clean(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function optionalClean(value) {
  return value === undefined ? undefined : clean(value);
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.trunc(number);
}

function preserveOrDefaultNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null) return nonNegativeInteger(fallback);
  if (Number.isInteger(value) && value >= 0) return value;
  return value;
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1) {
    return fallback;
  }
  return number;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function snakeCase(value) {
  return String(value).replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}
