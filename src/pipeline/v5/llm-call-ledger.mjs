import { ALLOWED_V5_DATA_CLASSES, createUsagePlaceholder } from "./contracts.mjs";

const allowedDataClasses = new Set(ALLOWED_V5_DATA_CLASSES);
const allowedStatuses = new Set(["succeeded", "failed"]);

export function createMemoryLlmCallLedger({ rows = [] } = {}) {
  const state = {
    rows: rows.map((row) => normalizeLlmCallLedgerRow(row)),
  };
  return {
    get rows() {
      return state.rows;
    },
    async recordCall(row) {
      const normalized = normalizeLlmCallLedgerRow(row);
      state.rows.push(normalized);
      return normalized;
    },
    async listCalls(filters = {}) {
      return filterLlmCallLedgerRows(state.rows, filters);
    },
  };
}

export function normalizeLlmCallLedgerRow(row = {}) {
  const callId = clean(row.callId ?? row.usageId);
  if (!callId) throw new Error("llm_call_ledger_call_id_required");
  const dataClass = clean(row.dataClass) ?? "eval";
  if (!allowedDataClasses.has(dataClass)) throw new Error(`llm_call_ledger_data_class_invalid:${dataClass}`);
  const operation = clean(row.operation);
  if (!operation) throw new Error("llm_call_ledger_operation_required");
  const provider = clean(row.provider);
  if (!provider) throw new Error("llm_call_ledger_provider_required");
  const model = clean(row.model);
  if (!model) throw new Error("llm_call_ledger_model_required");
  const status = clean(row.status) ?? "failed";
  if (!allowedStatuses.has(status)) throw new Error(`llm_call_ledger_status_invalid:${status}`);

  return removeUndefined({
    callId,
    usageId: clean(row.usageId) ?? callId,
    recordedAt: isoTimestamp(row.recordedAt ?? new Date()),
    pipelineRunId: clean(row.pipelineRunId),
    pipelineStepId: clean(row.pipelineStepId),
    dataClass,
    operation,
    provider,
    model,
    promptVersion: clean(row.promptVersion),
    schemaVersion: clean(row.schemaVersion),
    params: plainObject(row.params),
    status,
    errorCode: clean(row.errorCode),
    usage: createUsagePlaceholder(row.usage),
    requestArtifactPath: clean(row.requestArtifactPath),
    responseArtifactPath: clean(row.responseArtifactPath),
    sourceId: clean(row.sourceId),
    sourceUrl: clean(row.sourceUrl),
    articleBundleId: clean(row.articleBundleId),
    evaluationRunId: clean(row.evaluationRunId),
    metadata: plainObject(row.metadata),
  });
}

export function filterLlmCallLedgerRows(rows = [], filters = {}) {
  return rows.filter((row) => {
    if (filters.dataClass && row.dataClass !== filters.dataClass) return false;
    if (filters.provider && row.provider !== filters.provider) return false;
    if (filters.model && row.model !== filters.model) return false;
    if (filters.operation && row.operation !== filters.operation) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.sourceId && row.sourceId !== filters.sourceId) return false;
    if (filters.articleBundleId && row.articleBundleId !== filters.articleBundleId) return false;
    if (filters.startsAt && row.recordedAt < isoTimestamp(filters.startsAt)) return false;
    if (filters.endsAt && row.recordedAt > isoTimestamp(filters.endsAt)) return false;
    return true;
  });
}

export async function recordLlmCall(ledger, row) {
  if (!ledger || typeof ledger.recordCall !== "function") return undefined;
  return ledger.recordCall(row);
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("llm_call_ledger_recorded_at_invalid");
  return date.toISOString();
}

function removeUndefined(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
