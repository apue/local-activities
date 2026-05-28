import { describe, expect, it } from "vitest";

import {
  filterUpcomingPublishedEvents,
  formatPublicEventTime,
  shapePublicEvent,
  type CanonicalEventRow,
} from "./public-events";

const baseEvent: CanonicalEventRow = {
  event_id: "event-1",
  title: "Italian Design Weekend",
  organizer: "Italian Cultural Institute",
  starts_at: "2026-06-06T06:00:00.000Z",
  ends_at: "2026-06-06T08:00:00.000Z",
  timezone: "Asia/Shanghai",
  city: "Beijing",
  venue_name: "Italian Cultural Institute",
  venue_address: "Sanlitun, Beijing",
  reservation_status: "required",
  registration_action: null,
  registration_url: "https://example.com/register",
  source_url: "https://mp.weixin.qq.com/s/example",
  summary: "A weekend programme about Italian design.",
  entry_notes: null,
  status: "published",
  published_at: "2026-05-28T08:00:00.000Z",
};

describe("public event helpers", () => {
  it("filters out expired, draft, cancelled, and withdrawn events", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");

    expect(
      filterUpcomingPublishedEvents(
        [
          baseEvent,
          {
            ...baseEvent,
            event_id: "expired",
            starts_at: "2026-05-01T06:00:00.000Z",
            ends_at: "2026-05-01T08:00:00.000Z",
          },
          { ...baseEvent, event_id: "draft", status: "draft" },
          { ...baseEvent, event_id: "cancelled", status: "cancelled" },
          { ...baseEvent, event_id: "withdrawn", status: "withdrawn" },
        ],
        now,
      ).map((event) => event.event_id),
    ).toEqual(["event-1"]);
  });

  it("keeps ongoing published events when the end time is still future", () => {
    const now = new Date("2026-06-06T07:00:00.000Z");

    expect(
      filterUpcomingPublishedEvents([baseEvent], now).map(
        (event) => event.event_id,
      ),
    ).toEqual(["event-1"]);
  });

  it("shapes public events without draft or admin-only fields", () => {
    const shaped = shapePublicEvent(baseEvent);

    expect(shaped).toEqual({
      eventId: "event-1",
      title: "Italian Design Weekend",
      organizer: "Italian Cultural Institute",
      startsAt: "2026-06-06T06:00:00.000Z",
      endsAt: "2026-06-06T08:00:00.000Z",
      timezone: "Asia/Shanghai",
      city: "Beijing",
      venueName: "Italian Cultural Institute",
      venueAddress: "Sanlitun, Beijing",
      reservationStatus: "required",
      registrationAction: undefined,
      registrationUrl: "https://example.com/register",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      summary: "A weekend programme about Italian design.",
      entryNotes: undefined,
      status: "published",
    });
    expect(Object.keys(shaped)).not.toContain("reviewState");
    expect(Object.keys(shaped)).not.toContain("confidence");
  });

  it("formats event time in Asia Shanghai for public display", () => {
    expect(formatPublicEventTime(baseEvent)).toContain("6月6日");
  });
});
