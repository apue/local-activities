import { describe, expect, it } from "vitest";

import {
  getDraftBlockingReasons,
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

  it("explains missing publish fields", () => {
    expect(
      getDraftBlockingReasons({
        ...draft,
        title: undefined,
        startsAt: undefined,
        venueName: undefined,
      }),
    ).toEqual(["missing_title", "missing_start_time", "missing_venue"]);
  });

  it("formats known review states for compact UI labels", () => {
    expect(getReviewStateLabel("needs_info")).toBe("Needs info");
    expect(getReviewStateLabel("ready_for_review")).toBe("Ready");
  });
});
