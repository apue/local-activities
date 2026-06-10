import { createAttemptTrace, createUsagePlaceholder } from "./contracts.mjs";

export const mockFullExtractVersion = "v5-mock-full-extract.v1";
export const mockEditorPassVersion = "v5-mock-editor-pass.v1";

export function mockFullExtract({
  normalized,
  packet,
  triage,
  expected,
  now = new Date(),
} = {}) {
  if (!normalized || typeof normalized !== "object") {
    throw new Error("mock_full_extract_normalized_required");
  }
  const createdAt = isoTimestamp(now);
  const usage = usageForText([
    normalized.title,
    normalized.markdown,
    packet?.packetText,
    JSON.stringify(expected ?? {}),
  ].join("\n"));
  const action = expected?.action ?? "review";
  const events = (expected?.eventDrafts ?? []).map(normalizeExpectedEvent);
  const decision = action === "exclude"
    ? "non_event"
    : events.length > 0
    ? "event"
    : "needs_review";
  const reason = action === "exclude"
    ? "mock expected output marks article as non-event"
    : events.length > 0
    ? "mock expected event drafts available"
    : "mock expected output requires review";

  return {
    version: mockFullExtractVersion,
    decision,
    events,
    confidence: decision === "event" ? 0.9 : decision === "non_event" ? 0.84 : 0.55,
    reason,
    provider: "mock",
    model: "mock-full-extract",
    promptVersion: "v5-full-extract.mock-prompt.v1",
    schemaVersion: "v5-extraction-result.v1",
    triageDecision: triage?.decision,
    usage,
    attempts: [
      createAttemptTrace({
        attempt: 1,
        provider: "mock",
        model: "mock-full-extract",
        promptVersion: "v5-full-extract.mock-prompt.v1",
        schemaVersion: "v5-extraction-result.v1",
        usage,
        startedAt: createdAt,
        finishedAt: createdAt,
        reason,
        validatorIssues: [],
      }),
    ],
    createdAt,
  };
}

export function validateMockExtraction({ extraction, normalized, now = new Date() } = {}) {
  if (!extraction || typeof extraction !== "object") {
    throw new Error("mock_validator_extraction_required");
  }
  const issues = [];
  if (extraction.decision === "non_event") {
    issues.push({
      code: "mock_non_event",
      severity: "hard",
      message: "Mock extraction marked this article as non-event.",
    });
  }
  for (const [index, event] of (extraction.events ?? []).entries()) {
    if (!event.startsAt) {
      issues.push({
        code: "event_start_missing",
        severity: "soft",
        eventIndex: index,
        message: "Event start time is missing.",
      });
    }
    if (!event.venue && !event.address && !event.onlineUrl) {
      issues.push({
        code: "event_venue_missing",
        severity: "soft",
        eventIndex: index,
        message: "Event venue or online attendance path is missing.",
      });
    }
  }
  const status = issues.some((issue) => issue.severity === "hard")
    ? "invalid"
    : issues.length > 0
    ? "needs_info"
    : "valid";
  return {
    version: "v5-mock-validation.v1",
    status,
    issues,
    checkedAt: isoTimestamp(now),
    articleTitle: normalized?.title,
  };
}

export function mockEditorPass({
  normalized,
  extraction,
  validation,
  now = new Date(),
} = {}) {
  if (!extraction || typeof extraction !== "object") {
    throw new Error("mock_editor_extraction_required");
  }
  const createdAt = isoTimestamp(now);
  const firstEvent = extraction.events?.[0];
  const editorDecision = validation?.status === "invalid"
    ? "exclude"
    : validation?.status === "needs_info"
    ? "needs_info"
    : extraction.decision === "event"
    ? "publish"
    : "review";
  const usage = usageForText([
    normalized?.title,
    firstEvent?.title,
    firstEvent?.summary,
    validation?.issues?.map((issue) => issue.code).join(","),
  ].join("\n"));
  return {
    version: mockEditorPassVersion,
    editorDecision,
    displayTitle: firstEvent?.title ?? normalized?.title ?? "Untitled",
    summary: firstEvent?.summary ?? extraction.reason ?? "",
    tags: tagsForEvent(firstEvent),
    audience: editorDecision === "exclude" ? "not_public" : "general_public",
    qualityIssues: validation?.issues ?? [],
    corrections: [],
    reason: reasonForEditorDecision(editorDecision),
    provider: "mock",
    model: "mock-editor-pass",
    promptVersion: "v5-editor-pass.mock-prompt.v1",
    schemaVersion: "v5-editor-result.v1",
    usage,
    attempts: [
      createAttemptTrace({
        attempt: 1,
        provider: "mock",
        model: "mock-editor-pass",
        promptVersion: "v5-editor-pass.mock-prompt.v1",
        schemaVersion: "v5-editor-result.v1",
        usage,
        startedAt: createdAt,
        finishedAt: createdAt,
        reason: reasonForEditorDecision(editorDecision),
        validatorIssues: validation?.issues ?? [],
      }),
    ],
    createdAt,
  };
}

export function publishTraceFromEditor({ extraction, validation, editor } = {}) {
  const state = editor?.editorDecision === "publish"
    ? "published"
    : editor?.editorDecision === "exclude"
    ? "excluded"
    : editor?.editorDecision === "needs_info"
    ? "needs_info"
    : "needs_review";
  const reasons = [
    extraction?.decision === "non_event" ? "mock_non_event" : undefined,
    ...(validation?.issues ?? []).map((issue) => issue.code),
    editor?.reason,
  ].filter(Boolean);
  return {
    version: "v5-mock-publish-trace.v1",
    state,
    reasons,
    extractionDecision: extraction?.decision,
    validationStatus: validation?.status,
    editorDecision: editor?.editorDecision,
  };
}

function normalizeExpectedEvent(draft = {}) {
  return {
    draftId: clean(draft.draftId),
    title: clean(draft.title),
    startsAt: clean(draft.startsAt),
    endsAt: clean(draft.endsAt),
    venue: clean(draft.venueName) ?? clean(draft.venue),
    address: clean(draft.venueAddress) ?? clean(draft.address),
    city: clean(draft.city),
    organizer: clean(draft.organizer),
    registrationAction: clean(draft.registrationAction),
    registrationUrl: clean(draft.registrationUrl),
    scheduleText: clean(draft.scheduleText),
    summary: clean(draft.summary),
    evidence: Array.isArray(draft.evidence) ? draft.evidence : [],
    provenance: {
      source: "regression_expected",
    },
  };
}

function tagsForEvent(event) {
  const text = `${event?.title ?? ""} ${event?.summary ?? ""}`.toLowerCase();
  const tags = [];
  if (/film|movie|screening|电影|放映/.test(text)) tags.push("film");
  if (/beer|food|美食|啤酒|festival|节/.test(text)) tags.push("food_festival");
  if (/lecture|talk|讲座|沙龙/.test(text)) tags.push("talk");
  if (/music|performance|演出|音乐|诗歌/.test(text)) tags.push("performance");
  return tags.length ? tags : ["culture"];
}

function reasonForEditorDecision(decision) {
  if (decision === "publish") return "mock editor found publishable event facts";
  if (decision === "exclude") return "mock editor excludes non-event article";
  if (decision === "needs_info") return "mock editor requires missing event details";
  return "mock editor routes ambiguous output to review";
}

function usageForText(text) {
  const inputTokens = Math.max(1, Math.ceil(String(text ?? "").length / 4));
  const outputTokens = 24;
  return createUsagePlaceholder({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costMicroCny: 0,
    latencyMs: 0,
  });
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error("mock_harness_now_invalid");
  return date.toISOString();
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
