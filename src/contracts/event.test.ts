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
      posterImageUrl: "https://cdn.example.com/posters/event.png",
      posterImageAlt: "Italian Design Weekend poster",
      posterImageSourceUrl: "https://mp.weixin.qq.com/poster.png",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      status: "published",
      reviewState: "approved",
    });

    expect(result.status).toBe("published");
    expect(result.posterImageUrl).toBe(
      "https://cdn.example.com/posters/event.png",
    );
    expect(result.reviewState).toBe("approved");
  });

  it("rejects invalid public and review states", () => {
    expect(() => publicEventStatusSchema.parse("ready_for_review")).toThrow();
    expect(() => canonicalEventReviewStateSchema.parse("published")).toThrow();
  });

  it("accepts public-safe Event Pipeline V2 canonical fields", () => {
    const result = canonicalEventSchema.parse({
      id: "event-recurring",
      title: "Weekly Library Meetup",
      startsAt: "2026-06-06T08:00:00.000Z",
      timezone: "Asia/Shanghai",
      city: "Beijing",
      reservationStatus: "not_required",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      scheduleText: "Every Saturday 16:00-17:00",
      publicEligibility: "public",
      eventKind: "recurring",
      scheduleKind: "recurring",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SA",
      occurrenceStartsAt: [
        "2026-06-06T08:00:00.000Z",
        "2026-06-13T08:00:00.000Z",
      ],
      posterAssetId: "asset-poster-1",
      qrAssetId: "asset-qr-1",
      registrationQrAssetId: "asset-qr-1",
      status: "published",
      reviewState: "approved",
    });

    expect(result.scheduleKind).toBe("recurring");
    expect(result.occurrenceStartsAt).toHaveLength(2);
  });
});
