import { describe, expect, it } from "vitest";

import {
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
};

describe("admin portal utils", () => {
  it("marks drafts with minimum public fields as publishable", () => {
    expect(isDraftPublishableForDisplay(draft)).toBe(true);
    expect(getDraftBlockingReasons(draft)).toEqual([]);
  });

  it("accepts venue address as the minimum venue field", () => {
    expect(
      isDraftPublishableForDisplay({
        ...draft,
        organizer: undefined,
        venueName: undefined,
        venueAddress: "北京市朝阳区朝阳公园",
        reservationStatus: undefined,
      }),
    ).toBe(true);
  });

  it("explains missing publish fields", () => {
    expect(
      getDraftBlockingReasons({
        ...draft,
        title: undefined,
        startsAt: undefined,
        venueName: undefined,
        venueAddress: undefined,
      }),
    ).toEqual(["missing_title", "missing_start_time", "missing_venue"]);
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
