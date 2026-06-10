import { describe, expect, it } from "vitest";

import { decideV5PublishState } from "./publish-policy-v2.mjs";

describe("V5 Publish Policy v2", () => {
  it("publishes only when extraction and validation are valid and editor explicitly publishes", () => {
    const decision = decideV5PublishState({
      extraction: { decision: "event", confidence: 0.86 },
      validation: { status: "valid", issues: [], hardIssues: [], softIssues: [], repairableIssues: [] },
      editor: { editorDecision: "publish" },
    });

    expect(decision).toMatchObject({
      version: "v5-publish-policy.v2",
      state: "published",
      reasons: ["editor_publish_valid"],
      extractionDecision: "event",
      validationStatus: "valid",
      editorDecision: "publish",
    });
  });

  it("fails failed extractions before considering validation or editor output", () => {
    const decision = decideV5PublishState({
      extraction: { decision: "failed", reason: "provider_error" },
      validation: { status: "valid", issues: [] },
      editor: { editorDecision: "publish" },
    });

    expect(decision.state).toBe("failed");
    expect(decision.reasons).toEqual(expect.arrayContaining(["extraction_failed"]));
  });

  it("excludes non-events, invalid validation, and hard issues even when editor says publish", () => {
    const nonEvent = decideV5PublishState({
      extraction: { decision: "non_event" },
      validation: { status: "valid", issues: [] },
      editor: { editorDecision: "publish" },
    });
    const invalid = decideV5PublishState({
      extraction: { decision: "event" },
      validation: {
        status: "invalid",
        issues: [{ code: "city_not_beijing", severity: "hard" }],
        hardIssues: [{ code: "city_not_beijing", severity: "hard" }],
      },
      editor: { editorDecision: "publish" },
    });

    expect(nonEvent.state).toBe("excluded");
    expect(nonEvent.reasons).toContain("extraction_non_event");
    expect(invalid.state).toBe("excluded");
    expect(invalid.reasons).toEqual(expect.arrayContaining(["validation_invalid", "city_not_beijing"]));
  });

  it("routes soft or repairable validation issues to needs_info", () => {
    const decision = decideV5PublishState({
      extraction: { decision: "event", confidence: 0.82 },
      validation: {
        status: "needs_info",
        hardIssues: [],
        softIssues: [{ code: "event_schedule_missing", severity: "soft", repairable: true }],
        repairableIssues: [{ code: "event_schedule_missing", severity: "soft", repairable: true }],
        issues: [{ code: "event_schedule_missing", severity: "soft", repairable: true }],
      },
      editor: { editorDecision: "publish" },
    });

    expect(decision.state).toBe("needs_info");
    expect(decision.reasons).toEqual(expect.arrayContaining(["validation_needs_info", "event_schedule_missing"]));
  });

  it("surfaces editor pass failure before soft validation follow-up work", () => {
    const decision = decideV5PublishState({
      extraction: { decision: "event", confidence: 0.82 },
      validation: {
        status: "needs_info",
        softIssues: [{ code: "event_schedule_missing", severity: "soft", repairable: true }],
        issues: [{ code: "event_schedule_missing", severity: "soft", repairable: true }],
      },
      editor: { editorDecision: "failed" },
    });

    expect(decision.state).toBe("failed");
    expect(decision.reasons).toContain("editor_failed");
  });

  it("honors editor review and needs_info decisions after deterministic checks pass", () => {
    const review = decideV5PublishState({
      extraction: { decision: "event", confidence: 0.86 },
      validation: { status: "valid", issues: [] },
      editor: { editorDecision: "review" },
    });
    const needsInfo = decideV5PublishState({
      extraction: { decision: "event", confidence: 0.86 },
      validation: { status: "valid", issues: [] },
      editor: { editorDecision: "needs_info" },
    });

    expect(review).toMatchObject({
      state: "needs_review",
      reasons: ["editor_review"],
    });
    expect(needsInfo).toMatchObject({
      state: "needs_info",
      reasons: ["editor_needs_info"],
    });
  });

  it("routes low confidence or ambiguous extraction to needs_review", () => {
    const lowConfidence = decideV5PublishState({
      extraction: { decision: "event", confidence: 0.49 },
      validation: { status: "valid", issues: [] },
      editor: { editorDecision: "publish" },
    });
    const ambiguous = decideV5PublishState({
      extraction: { decision: "needs_review", confidence: 0.78 },
      validation: { status: "valid", issues: [] },
      editor: { editorDecision: "publish" },
    });

    expect(lowConfidence.state).toBe("needs_review");
    expect(lowConfidence.reasons).toContain("extraction_confidence_low");
    expect(ambiguous.state).toBe("needs_review");
    expect(ambiguous.reasons).toContain("extraction_needs_review");
  });
});
