export const defaultVisionTriageModel = "Qwen/Qwen3-VL-8B-Instruct";
export const defaultVisionExtractionModel = defaultVisionTriageModel;
export const defaultVisionEscalationModel = "Qwen/Qwen3-VL-30B-A3B-Instruct";

export const escalationTriggerDescriptions = {
  low_confidence: "First-pass confidence is below the escalation threshold.",
  ambiguous_public_eligibility:
    "The article may not be a public attendee-facing event.",
  multi_event_complexity: "The article appears to contain multiple events.",
  schedule_complexity: "The article appears long-running or recurring.",
  qr_registration_incomplete:
    "QR evidence exists but registration details are incomplete.",
  missing_required_event_fields:
    "Required event fields are missing after first-pass extraction.",
};

const defaultEscalationConfidenceThreshold = 0.85;
const requiredEventFields = new Set(["title", "startsAt", "venueName"]);
const complexScheduleKinds = new Set(["multi_day", "long_running", "recurring"]);

export function readVisionModelPolicy(env = {}) {
  const triageModel = clean(env.VISION_TRIAGE_MODEL) ?? defaultVisionTriageModel;
  const extractionModel =
    clean(env.VISION_EXTRACTION_MODEL) ??
    clean(env.OPENAI_MODEL) ??
    defaultVisionExtractionModel;
  const escalationModel =
    clean(env.VISION_ESCALATION_MODEL) ?? defaultVisionEscalationModel;

  return {
    triageModel,
    extractionModel,
    escalationModel,
    legacyExtractionModel: !clean(env.VISION_EXTRACTION_MODEL)
      ? clean(env.OPENAI_MODEL)
      : undefined,
  };
}

export function classifyVisionEscalation({
  confidence,
  publicEligibility,
  publicEligibilityConfidence,
  eventCount,
  scheduleKind,
  signals = [],
  missingFields = [],
  hasQrEvidence = false,
  registrationFieldsComplete = true,
  confidenceThreshold = defaultEscalationConfidenceThreshold,
} = {}) {
  const triggers = [];
  const normalizedSignals = new Set(signals.map(normalizeToken));
  const normalizedMissingFields = new Set(missingFields.map(normalizeToken));

  if (typeof confidence === "number" && confidence < confidenceThreshold) {
    triggers.push("low_confidence");
  }

  if (
    publicEligibility === "unknown" ||
    publicEligibility === "private_or_internal" ||
    (typeof publicEligibilityConfidence === "number" &&
      publicEligibilityConfidence < confidenceThreshold) ||
    normalizedSignals.has("ambiguous_public_eligibility")
  ) {
    triggers.push("ambiguous_public_eligibility");
  }

  if (
    (Number.isInteger(eventCount) && eventCount > 1) ||
    normalizedSignals.has("multi_event")
  ) {
    triggers.push("multi_event_complexity");
  }

  if (
    complexScheduleKinds.has(normalizeToken(scheduleKind)) ||
    normalizedSignals.has("recurring") ||
    normalizedSignals.has("long_running")
  ) {
    triggers.push("schedule_complexity");
  }

  if (
    hasQrEvidence &&
    (!registrationFieldsComplete ||
      normalizedSignals.has("qr_registration_incomplete"))
  ) {
    triggers.push("qr_registration_incomplete");
  }

  if (
    [...requiredEventFields].some((field) =>
      normalizedMissingFields.has(normalizeToken(field)),
    )
  ) {
    triggers.push("missing_required_event_fields");
  }

  return {
    action: triggers.length > 0 ? "escalate" : "first_pass_accept",
    triggers: [...new Set(triggers)],
  };
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function clean(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
