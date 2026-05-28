import { describe, expect, it } from "vitest";

import {
  canonicalEventReviewStateSchema,
  canonicalEventSchema,
  publicEventStatusSchema,
} from "./event";

describe("event contracts", () => {
  it("accepts a published public event with action-critical fields", () => {
    const result = canonicalEventSchema.parse({
      id: "event-001",
      title: "Italian Design Weekend",
      organizer: "Italian Cultural Institute",
      startsAt: "2026-06-06T06:00:00.000Z",
      endsAt: "2026-06-06T08:00:00.000Z",
      timezone: "Asia/Shanghai",
      city: "Beijing",
      venueName: "Italian Cultural Institute",
      venueAddress: "Sanlitun, Beijing",
      reservationStatus: "required",
      registrationUrl: "https://example.com/register",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      status: "published",
      reviewState: "approved",
    });

    expect(result.status).toBe("published");
    expect(result.reviewState).toBe("approved");
  });

  it("rejects invalid public and review states", () => {
    expect(() => publicEventStatusSchema.parse("ready_for_review")).toThrow();
    expect(() => canonicalEventReviewStateSchema.parse("published")).toThrow();
  });
});
