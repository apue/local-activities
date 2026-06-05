import { describe, expect, it } from "vitest";

import type { AdminEventDraftRecord } from "./admin-service";
import { computePublishDecision } from "./publish-policy";

const baseDraft: AdminEventDraftRecord = {
  id: "draft-1",
  articleUrl: "https://mp.weixin.qq.com/s/activity",
  title: "Korean Culture Activity",
  startsAt: "2026-06-20T07:00:00.000Z",
  endsAt: "2026-06-20T09:00:00.000Z",
  timezone: "Asia/Shanghai",
  city: "Beijing",
  venueName: "Korean Cultural Center",
  reservationStatus: "not_required",
  summary: "A complete public event.",
  confidence: 0.96,
  reviewState: "ready_for_review",
  evidenceAssetIds: [],
  fieldEvidence: {},
  publicEligibility: "public",
  scheduleKind: "single",
  resolutionDecision: "new_event",
};

describe("publish policy", () => {
  it("allows high-confidence complete public drafts without blockers", () => {
    expect(computePublishDecision(baseDraft)).toEqual({
      canPublish: true,
      canPublishWithOverride: false,
      requiresOperatorOverride: false,
      hardBlockers: [],
      softBlockers: [],
      disabledReason: undefined,
    });
  });

  it("hard-blocks non-public official visit/news content", () => {
    expect(
      computePublishDecision({
        ...baseDraft,
        publicEligibility: "not_public",
        triageDecision: "official_visit",
      }),
    ).toMatchObject({
      canPublish: false,
      hardBlockers: [
        expect.objectContaining({ code: "not_public_activity" }),
        expect.objectContaining({ code: "excluded_triage_decision" }),
      ],
      disabledReason: "Not public activity",
    });
  });

  it("hard-blocks non-renderable schedules and unresolved duplicates", () => {
    const decision = computePublishDecision({
      ...baseDraft,
      scheduleKind: "unsupported",
      resolutionDecision: "same_event",
      canonicalEventId: "event-1",
    });

    expect(decision.canPublish).toBe(false);
    expect(decision.hardBlockers.map((blocker) => blocker.code)).toEqual([
      "non_renderable_schedule",
      "unresolved_resolution",
    ]);
  });

  it("hard-blocks drafts that are still marked possible duplicate", () => {
    const decision = computePublishDecision({
      ...baseDraft,
      reviewState: "possible_duplicate",
    });

    expect(decision.canPublish).toBe(false);
    expect(decision.canPublishWithOverride).toBe(false);
    expect(decision.hardBlockers[0]).toMatchObject({
      code: "possible_duplicate_review_state",
    });
  });

  it("hard-blocks QR-required events without QR evidence", () => {
    const decision = computePublishDecision({
      ...baseDraft,
      reservationStatus: "required",
      registrationUrl: undefined,
      registrationQrAssetId: undefined,
    });

    expect(decision.canPublish).toBe(false);
    expect(decision.hardBlockers[0]).toMatchObject({
      code: "missing_required_qr_evidence",
    });
  });

  it("allows QR-required events with stored QR image evidence", () => {
    const decision = computePublishDecision({
      ...baseDraft,
      reservationStatus: "required",
      registrationUrl: undefined,
      registrationQrAssetId: undefined,
      registrationQrImageUrl: "https://blob.example.com/qr/register.png",
    });

    expect(decision.canPublish).toBe(true);
    expect(decision.hardBlockers).toEqual([]);
  });

  it("allows QR-required events with an explicit registration action", () => {
    const decision = computePublishDecision({
      ...baseDraft,
      reservationStatus: "required",
      registrationUrl: undefined,
      registrationQrAssetId: undefined,
      registrationQrImageUrl: undefined,
      registrationAction: "Email the cultural center to reserve a seat.",
    });

    expect(decision.canPublish).toBe(true);
    expect(decision.hardBlockers).toEqual([]);
  });

  it("soft-blocks low-confidence or missing end time until override reason exists", () => {
    const softBlocked = computePublishDecision({
      ...baseDraft,
      endsAt: undefined,
      confidence: 0.62,
    });
    expect(softBlocked.canPublish).toBe(false);
    expect(softBlocked.canPublishWithOverride).toBe(true);
    expect(softBlocked.requiresOperatorOverride).toBe(true);
    expect(softBlocked.disabledReason).toBe("Operator override reason required");
    expect(softBlocked.softBlockers.map((blocker) => blocker.code)).toEqual([
      "low_confidence",
      "missing_end_time",
    ]);

    expect(
      computePublishDecision(
        {
          ...baseDraft,
          endsAt: undefined,
          confidence: 0.62,
        },
        { operatorOverrideReason: "Human reviewed schedule and venue." },
      ),
    ).toMatchObject({
      canPublish: true,
      canPublishWithOverride: true,
      requiresOperatorOverride: false,
      softBlockers: [
        expect.objectContaining({ code: "low_confidence" }),
        expect.objectContaining({ code: "missing_end_time" }),
      ],
    });
  });

  it("deduplicates repeated backend and stored blocker codes", () => {
    const decision = computePublishDecision({
      ...baseDraft,
      endsAt: undefined,
      softBlockers: [
        { code: "missing_end_time", message: "No end time extracted" },
      ],
    });

    expect(decision.softBlockers.map((blocker) => blocker.code)).toEqual([
      "missing_end_time",
    ]);
    expect(decision.softBlockers[0]?.message).toBe("Missing end time");
  });
});
