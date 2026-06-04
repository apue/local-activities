import { describe, expect, it } from "vitest";

import {
  classifyVisionEscalation,
  defaultVisionEscalationModel,
  defaultVisionExtractionModel,
  defaultVisionTriageModel,
  readVisionModelPolicy,
} from "./vision-model-policy.mjs";

describe("vision model policy", () => {
  it("defaults to Qwen 8B first-pass and Qwen 30B escalation", () => {
    expect(readVisionModelPolicy({})).toEqual({
      triageModel: defaultVisionTriageModel,
      extractionModel: defaultVisionExtractionModel,
      escalationModel: defaultVisionEscalationModel,
      legacyExtractionModel: undefined,
    });
  });

  it("prefers explicit vision extraction model over legacy OPENAI_MODEL", () => {
    expect(
      readVisionModelPolicy({
        OPENAI_MODEL: "legacy-model",
        VISION_TRIAGE_MODEL: "triage-model",
        VISION_EXTRACTION_MODEL: "extraction-model",
        VISION_ESCALATION_MODEL: "escalation-model",
      }),
    ).toEqual({
      triageModel: "triage-model",
      extractionModel: "extraction-model",
      escalationModel: "escalation-model",
      legacyExtractionModel: undefined,
    });
  });

  it("keeps legacy OPENAI_MODEL as extraction fallback", () => {
    expect(readVisionModelPolicy({ OPENAI_MODEL: "legacy-model" })).toMatchObject({
      triageModel: defaultVisionTriageModel,
      extractionModel: "legacy-model",
      escalationModel: defaultVisionEscalationModel,
      legacyExtractionModel: "legacy-model",
    });
  });

  it("accepts confident simple public events on the first pass", () => {
    expect(
      classifyVisionEscalation({
        confidence: 0.96,
        publicEligibility: "public",
        publicEligibilityConfidence: 0.97,
        eventCount: 1,
        scheduleKind: "single",
        missingFields: [],
        hasQrEvidence: true,
        registrationFieldsComplete: true,
      }),
    ).toEqual({
      action: "first_pass_accept",
      triggers: [],
    });
  });

  it("escalates uncertain, non-public, multi-event, schedule, QR, and field gaps", () => {
    expect(
      classifyVisionEscalation({
        confidence: 0.72,
        publicEligibility: "unknown",
        eventCount: 2,
        scheduleKind: "recurring",
        missingFields: ["startsAt"],
        hasQrEvidence: true,
        registrationFieldsComplete: false,
      }),
    ).toEqual({
      action: "escalate",
      triggers: [
        "low_confidence",
        "ambiguous_public_eligibility",
        "multi_event_complexity",
        "schedule_complexity",
        "qr_registration_incomplete",
        "missing_required_event_fields",
      ],
    });
  });
});
