import { describe, expect, it } from "vitest";

import type { EventDraftUpload } from "../../contracts/collector";
import type { CollectorEventCandidate } from "../collector-event-candidates-route-handlers";
import { resolveEventDedupe } from "./dedupe-resolver";

const baseDraft: EventDraftUpload = {
  articleUrl: "https://mp.weixin.qq.com/s/beiping-2026-repeat",
  extractionAttemptId: "attempt-255",
  captureMode: "text_complete",
  publicEligibility: "public",
  eventKind: "single",
  scheduleKind: "single",
  title: "Beiping Beer Festival",
  organizer: "Beiping Machine",
  startsAt: "2026-06-20T10:00:00.000+08:00",
  endsAt: "2026-06-20T14:00:00.000+08:00",
  timezone: "Asia/Shanghai",
  venueName: "Beiping Machine Taproom",
  venueAddress: "北京市朝阳区酒仙桥路4号",
  city: "Beijing",
  reservationStatus: "not_required",
  signals: ["ready_for_review"],
  evidenceAssetIds: [],
  fieldEvidence: {},
  confidence: 0.96,
};

const baseCandidate: CollectorEventCandidate = {
  eventId: "event-beiping-beer-festival",
  title: "Beiping Beer Festival 2026",
  organizer: "Beiping Machine",
  startsAt: "2026-06-20T10:00:00.000+08:00",
  endsAt: "2026-06-20T14:00:00.000+08:00",
  timezone: "Asia/Shanghai",
  city: "Beijing",
  venueName: "Beiping Machine Taproom",
  venueAddress: "北京市朝阳区酒仙桥路4号",
  sourceUrl: "https://mp.weixin.qq.com/s/original-beiping",
  status: "published",
  publishedAt: "2026-06-01T08:00:00.000Z",
};

describe("deterministic V4 dedupe resolver", () => {
  it("routes exact repeat articles as same_event without using live lookup behavior", () => {
    const decision = resolveEventDedupe(baseDraft, [baseCandidate]);

    expect(decision).toEqual({
      decision: "same_event",
      canonicalEventId: "event-beiping-beer-festival",
      reviewState: "possible_duplicate",
      publishBlockers: [
        {
          code: "duplicate_event",
          message: "Matches an existing event and requires duplicate resolution before publishing.",
        },
      ],
      productVisibleReasons: [
        "Same organizer, start time, and venue as an existing event.",
      ],
      match: expect.objectContaining({
        eventId: "event-beiping-beer-festival",
        score: expect.any(Number),
      }),
    });
    expect(decision.match?.score).toBeGreaterThanOrEqual(0.9);
  });

  it("routes same event with changed public fields as update_existing", () => {
    const decision = resolveEventDedupe(
      {
        ...baseDraft,
        endsAt: "2026-06-20T15:00:00.000+08:00",
        registrationUrl: "https://example.com/register-new",
        scheduleText: "Updated end time and registration link.",
      },
      [baseCandidate],
    );

    expect(decision).toMatchObject({
      decision: "update_existing",
      canonicalEventId: "event-beiping-beer-festival",
      reviewState: "needs_review",
      proposedChanges: {
        endsAt: "2026-06-20T15:00:00.000+08:00",
        registrationUrl: "https://example.com/register-new",
        scheduleText: "Updated end time and registration link.",
      },
      publishBlockers: [
        expect.objectContaining({ code: "event_update_requires_review" }),
      ],
    });
  });

  it("routes explicit cancellation candidates as cancel_existing", () => {
    const decision = resolveEventDedupe(
      {
        ...baseDraft,
        eventKind: "cancellation",
        title: "Beiping Beer Festival cancelled",
        summary: "The previously announced event has been cancelled.",
      },
      [baseCandidate],
    );

    expect(decision).toMatchObject({
      decision: "cancel_existing",
      canonicalEventId: "event-beiping-beer-festival",
      reviewState: "needs_review",
      proposedChanges: {
        status: "cancelled",
      },
      publishBlockers: [
        expect.objectContaining({ code: "event_cancellation_requires_review" }),
      ],
    });
  });

  it("keeps weak local matches as possible_duplicate for operator review", () => {
    const decision = resolveEventDedupe(
      {
        ...baseDraft,
        title: "Beiping International Night",
        venueName: "Beiping Machine Taproom",
      },
      [baseCandidate],
    );

    expect(decision).toMatchObject({
      decision: "possible_duplicate",
      canonicalEventId: "event-beiping-beer-festival",
      reviewState: "possible_duplicate",
      publishBlockers: [
        expect.objectContaining({ code: "possible_duplicate" }),
      ],
    });
  });

  it("rejects non-public, news, and non-Beijing candidates before duplicate matching", () => {
    expect(
      resolveEventDedupe(
        { ...baseDraft, publicEligibility: "not_public" },
        [baseCandidate],
      ),
    ).toMatchObject({
      decision: "reject",
      reviewState: "needs_review",
      publishBlockers: [expect.objectContaining({ code: "not_public_activity" })],
    });

    expect(
      resolveEventDedupe({ ...baseDraft, eventKind: "news" }, [baseCandidate]),
    ).toMatchObject({
      decision: "reject",
      publishBlockers: [expect.objectContaining({ code: "news_not_event" })],
    });

    expect(
      resolveEventDedupe(
        { ...baseDraft, city: "Shanghai" as EventDraftUpload["city"] },
        [baseCandidate],
      ),
    ).toMatchObject({
      decision: "reject",
      publishBlockers: [expect.objectContaining({ code: "not_beijing_event" })],
    });
  });

  it("routes missing but human-readable event information to review, not reject", () => {
    const decision = resolveEventDedupe(
      {
        ...baseDraft,
        startsAt: undefined,
        scheduleText: "Saturday afternoon, exact time shown in source poster.",
      },
      [],
    );

    expect(decision).toMatchObject({
      decision: "review",
      reviewState: "needs_info",
      publishBlockers: [
        expect.objectContaining({ code: "missing_required_public_field" }),
      ],
      productVisibleReasons: [
        "Missing required public fields, but the draft still has human-readable event information.",
      ],
    });
  });

  it("routes unmatched complete public candidates as new_event", () => {
    expect(resolveEventDedupe(baseDraft, [])).toMatchObject({
      decision: "new_event",
      reviewState: "ready_for_review",
      publishBlockers: [],
      productVisibleReasons: ["No local candidate matched this event."],
    });
  });
});
