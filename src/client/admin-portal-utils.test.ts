import { describe, expect, it } from "vitest";

import {
  canRunDraftReviewAction,
  getDraftBlockingReasons,
  formatLlmCostCny,
  formatTokenCount,
  getReviewStateLabel,
  isDraftPublishableForDisplay,
} from "./admin-portal-utils";

const draft = {
  id: "draft-1",
  articleUrl: "https://mp.weixin.qq.com/s/example",
  title: "Italian Design Weekend",
  organizer: "Italian Cultural Institute",
  startsAt: "2026-06-06T06:00:00.000Z",
  venueName: "Italian Cultural Institute",
  reservationStatus: "required",
  reviewState: "ready_for_review",
  publishDecision: {
    canPublish: true,
    canPublishWithOverride: false,
    requiresOperatorOverride: false,
    hardBlockers: [],
    softBlockers: [],
  },
};

describe("admin portal utils", () => {
  it("uses backend publish decisions instead of local field checks", () => {
    expect(isDraftPublishableForDisplay(draft)).toBe(true);
    expect(getDraftBlockingReasons(draft)).toEqual([]);
    expect(
      isDraftPublishableForDisplay({
        ...draft,
        title: undefined,
        startsAt: undefined,
        venueName: undefined,
      }),
    ).toBe(true);
  });

  it("returns backend blocker codes and disables hard-blocked publish", () => {
    const blockedDraft = {
      ...draft,
      publishDecision: {
        canPublish: false,
        canPublishWithOverride: false,
        requiresOperatorOverride: false,
        hardBlockers: [
          {
            code: "not_public_activity",
            message: "Not public activity",
          },
        ],
        softBlockers: [],
        disabledReason: "Not public activity",
      },
    };

    expect(isDraftPublishableForDisplay(blockedDraft)).toBe(false);
    expect(getDraftBlockingReasons(blockedDraft)).toEqual([
      "not_public_activity",
    ]);
  });

  it("allows soft-blocked publish only with operator override text", () => {
    const softBlockedDraft = {
      ...draft,
      publishDecision: {
        canPublish: false,
        canPublishWithOverride: true,
        requiresOperatorOverride: true,
        hardBlockers: [],
        softBlockers: [
          {
            code: "missing_end_time",
            message: "Missing end time",
          },
        ],
        disabledReason: "Operator override reason required",
      },
    };

    expect(isDraftPublishableForDisplay(softBlockedDraft)).toBe(false);
    expect(
      isDraftPublishableForDisplay(softBlockedDraft, "Poster confirms schedule."),
    ).toBe(true);
    expect(getDraftBlockingReasons(softBlockedDraft)).toEqual([
      "missing_end_time",
    ]);
  });

  it("keeps review actions off for closed draft states", () => {
    expect(canRunDraftReviewAction(draft)).toBe(true);
    expect(canRunDraftReviewAction({ ...draft, reviewState: "approved" })).toBe(
      false,
    );
    expect(canRunDraftReviewAction({ ...draft, reviewState: "rejected" })).toBe(
      false,
    );
  });

  it("formats known review states for compact UI labels", () => {
    expect(getReviewStateLabel("needs_info")).toBe("Needs info");
    expect(getReviewStateLabel("ready_for_review")).toBe("Ready");
  });

  it("formats LLM usage counts and micro-CNY costs for admin display", () => {
    expect(formatTokenCount(1650)).toBe("1,650");
    expect(formatLlmCostCny(2100)).toBe("¥0.0021");
    expect(formatLlmCostCny(0)).toBe("¥0.0000");
  });
});
