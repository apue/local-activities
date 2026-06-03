import { describe, expect, it } from "vitest";

import {
  buildUpcomingEventFilter,
  filterUpcomingPublishedEvents,
  formatReservationStatus,
  formatPublicEventTime,
  getPublicEventFromClient,
  listPublicUpcomingEventsFromClient,
  shapePublicEvent,
  type CanonicalEventRow,
  type PublicEventsClient,
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
  poster_image_url: "https://cdn.example.com/posters/event.png",
  poster_image_alt: "Italian Design Weekend poster",
  poster_image_source_url: "https://mp.weixin.qq.com/poster.png",
  summary: "A weekend programme about Italian design.",
  schedule_text: "6月6日 14:00-16:00",
  entry_notes: null,
  status: "published",
  published_at: "2026-05-28T08:00:00.000Z",
  public_eligibility: "public",
  event_kind: "recurring",
  schedule_kind: "recurring",
  recurrence_rule: "FREQ=WEEKLY;BYDAY=SA",
  occurrence_starts_at: ["2026-06-06T06:00:00.000Z"],
  poster_asset_id: "asset-poster-1",
  qr_asset_id: "asset-qr-1",
  registration_qr_asset_id: "asset-qr-1",
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

  it("builds the database-side upcoming filter before applying result limits", () => {
    expect(
      buildUpcomingEventFilter(new Date("2026-06-01T00:00:00.000Z")),
    ).toBe(
      "starts_at.gte.2026-06-01T00:00:00.000Z,ends_at.gte.2026-06-01T00:00:00.000Z",
    );
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
      posterImageUrl: "https://cdn.example.com/posters/event.png",
      posterImageAlt: "Italian Design Weekend poster",
      posterImageSourceUrl: "https://mp.weixin.qq.com/poster.png",
      summary: "A weekend programme about Italian design.",
      scheduleText: "6月6日 14:00-16:00",
      scheduleKind: "recurring",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SA",
      occurrenceStartsAt: ["2026-06-06T06:00:00.000Z"],
      entryNotes: undefined,
      status: "published",
    });
    expect(Object.keys(shaped)).not.toContain("reviewState");
    expect(Object.keys(shaped)).not.toContain("confidence");
    expect(Object.keys(shaped)).not.toContain("hardBlockers");
    expect(Object.keys(shaped)).not.toContain("publicEligibility");
    expect(Object.keys(shaped)).not.toContain("posterAssetId");
  });

  it("formats public reservation status without exposing unknown", () => {
    expect(formatReservationStatus("required")).toBe("需要预约");
    expect(formatReservationStatus("not_required")).toBe("无需预约");
    expect(formatReservationStatus("unknown")).toBe("无需预约");
  });

  it("formats event time in Asia Shanghai for public display", () => {
    expect(formatPublicEventTime(baseEvent)).toContain("6月6日");
  });

  it("returns an empty public list when the backing store is temporarily unavailable", async () => {
    const client = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  or() {
                    return {
                      order() {
                        return {
                          async limit() {
                            return {
                              data: null,
                              error: { message: "relation missing" },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as PublicEventsClient;

    await expect(
      listPublicUpcomingEventsFromClient(
        client,
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual([]);
  });

  it("selects V2 schedule fields in public queries", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const client = {
      from(...args: unknown[]) {
        calls.push(["from", args]);
        return {
          select(...selectArgs: unknown[]) {
            calls.push(["select", selectArgs]);
            return {
              eq() {
                return {
                  or() {
                    return {
                      order() {
                        return {
                          async limit() {
                            return {
                              data: [{ ...baseEvent, schedule_text: undefined }],
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as PublicEventsClient;

    const events = await listPublicUpcomingEventsFromClient(
      client,
      new Date("2026-06-01T00:00:00.000Z"),
    );

    expect(calls).toContainEqual(["from", ["canonical_events"]]);
    expect(calls[1]?.[1]?.[0]).toContain("poster_image_url");
    expect(calls[1]?.[1]?.[0]).toContain("schedule_text");
    expect(calls[1]?.[1]?.[0]).toContain("schedule_kind");
    expect(calls[1]?.[1]?.[0]).toContain("recurrence_rule");
    expect(calls[1]?.[1]?.[0]).toContain("occurrence_starts_at");
    expect(events[0]?.scheduleText).toBeUndefined();
  });

  it("falls back to base public columns before the poster migration is applied", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const client = fallbackListClient(calls);

    const events = await listPublicUpcomingEventsFromClient(
      client,
      new Date("2026-06-01T00:00:00.000Z"),
    );

    expect(calls.filter(([name]) => name === "select")).toEqual([
      [
        "select",
        [
          expect.stringContaining("poster_image_url"),
        ],
      ],
      [
        "select",
        [
          expect.not.stringContaining("poster_image_url"),
        ],
      ],
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Italian Design Weekend");
    expect(events[0]?.posterImageUrl).toBeUndefined();
  });

  it("falls back to base public columns for detail reads before the poster migration is applied", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const client = fallbackSingleClient(calls);

    const event = await getPublicEventFromClient(
      client,
      "event-1",
      new Date("2026-06-01T00:00:00.000Z"),
    );

    const selectedColumns = calls
      .filter(([name]) => name === "select")
      .map(([, args]) => String(args[0]));
    expect(selectedColumns[0]).toContain("poster_image_url");
    expect(selectedColumns[1]).not.toContain("poster_image_url");
    expect(event?.eventId).toBe("event-1");
    expect(event?.posterImageUrl).toBeUndefined();
  });
});

function fallbackListClient(calls: Array<[string, unknown[]]>) {
  let attempts = 0;
  const query = {
    select(...args: unknown[]) {
      calls.push(["select", args]);
      attempts += 1;
      return query;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", args]);
      return query;
    },
    or(...args: unknown[]) {
      calls.push(["or", args]);
      return query;
    },
    order(...args: unknown[]) {
      calls.push(["order", args]);
      return query;
    },
    async limit(...args: unknown[]) {
      calls.push(["limit", args]);
      if (attempts === 1) {
        return {
          data: null,
          error: {
            message: "column canonical_events.poster_image_url does not exist",
          },
        };
      }
      return {
        data: [
          {
            ...baseEvent,
            poster_image_url: undefined,
            poster_image_alt: undefined,
            poster_image_source_url: undefined,
          },
        ],
        error: null,
      };
    },
  };

  return {
    from(...args: unknown[]) {
      calls.push(["from", args]);
      return query;
    },
  } as unknown as PublicEventsClient;
}

function fallbackSingleClient(calls: Array<[string, unknown[]]>) {
  let attempts = 0;
  const query = {
    select(...args: unknown[]) {
      calls.push(["select", args]);
      attempts += 1;
      return query;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", args]);
      return query;
    },
    async maybeSingle(...args: unknown[]) {
      calls.push(["maybeSingle", args]);
      if (attempts === 1) {
        return {
          data: null,
          error: {
            message: "column canonical_events.poster_image_url does not exist",
          },
        };
      }
      return {
        data: {
          ...baseEvent,
          poster_image_url: undefined,
          poster_image_alt: undefined,
          poster_image_source_url: undefined,
        },
        error: null,
      };
    },
  };

  return {
    from(...args: unknown[]) {
      calls.push(["from", args]);
      return query;
    },
  } as unknown as PublicEventsClient;
}
