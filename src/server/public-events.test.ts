import { describe, expect, it } from "vitest";

import {
  buildUpcomingEventFilter,
  filterUpcomingPublishedEvents,
  formatPublicEventOccurrences,
  formatPublicEventSchedule,
  formatReservationStatus,
  formatPublicEventTime,
  getPublicEventFromClient,
  isPublicEventEnded,
  listPublicArchiveEventsFromClient,
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
            occurrence_starts_at: null,
          },
          { ...baseEvent, event_id: "draft", status: "draft" },
          { ...baseEvent, event_id: "cancelled", status: "cancelled" },
          { ...baseEvent, event_id: "withdrawn", status: "withdrawn" },
        ],
        now,
      ).map((event) => event.event_id),
    ).toEqual(["event-1"]);
  });

  it("filters out non-public and news-like canonical rows before public rendering", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");

    expect(
      filterUpcomingPublishedEvents(
        [
          baseEvent,
          {
            ...baseEvent,
            event_id: "non-public",
            public_eligibility: "not_public",
          },
          {
            ...baseEvent,
            event_id: "news",
            event_kind: "news",
            title: "Ambassador visit recap",
          },
          {
            ...baseEvent,
            event_id: "rejected-resolution",
            resolution_decision: "not_public_activity",
          },
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

  it("keeps recurring events when a future occurrence is available", () => {
    const now = new Date("2026-06-10T00:00:00.000Z");

    expect(
      filterUpcomingPublishedEvents(
        [
          {
            ...baseEvent,
            event_id: "weekly-library",
            starts_at: "2026-05-03T06:00:00.000Z",
            ends_at: "2026-05-03T09:00:00.000Z",
            schedule_text: null,
            schedule_kind: "recurring",
            occurrence_starts_at: [
              "2026-06-06T06:00:00.000Z",
              "2026-06-13T06:00:00.000Z",
            ],
          },
        ],
        now,
      ).map((event) => event.event_id),
    ).toEqual(["weekly-library"]);
  });

  it("lists archive events including ended published public-renderable rows", async () => {
    const query = {
      select() {
        return query;
      },
      eq() {
        return query;
      },
      order() {
        return query;
      },
      async limit() {
        return {
          data: [
            {
              ...baseEvent,
              event_id: "ended-public",
              starts_at: "2026-05-01T06:00:00.000Z",
              ends_at: "2026-05-01T08:00:00.000Z",
              schedule_text: null,
              occurrence_starts_at: null,
            },
            {
              ...baseEvent,
              event_id: "upcoming-public",
              starts_at: "2026-06-10T06:00:00.000Z",
              ends_at: "2026-06-10T08:00:00.000Z",
            },
            {
              ...baseEvent,
              event_id: "not-public",
              public_eligibility: "not_public",
            },
          ],
          error: null,
        };
      },
    };
    const client = {
      from() {
        return query;
      },
    } as unknown as PublicEventsClient;

    await expect(listPublicArchiveEventsFromClient(client)).resolves.toEqual([
      expect.objectContaining({ eventId: "ended-public" }),
      expect.objectContaining({ eventId: "upcoming-public" }),
    ]);
  });

  it("deduplicates public cards with the same real-world event key", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");

    expect(
      filterUpcomingPublishedEvents(
        [
          baseEvent,
          {
            ...baseEvent,
            event_id: "event-duplicate",
            source_url: "https://mp.weixin.qq.com/s/duplicate",
          },
        ],
        now,
      ).map((event) => event.event_id),
    ).toEqual(["event-1"]);
  });

  it("builds the database-side upcoming filter before applying result limits", () => {
    expect(
      buildUpcomingEventFilter(new Date("2026-06-01T00:00:00.000Z")),
    ).toBe(
      "starts_at.gte.2026-06-01T00:00:00.000Z,ends_at.gte.2026-06-01T00:00:00.000Z,schedule_kind.eq.recurring",
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
      registrationQrImageUrl: undefined,
      registrationQrImageAlt: undefined,
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

  it("shapes public QR registration evidence when available", () => {
    expect(
      shapePublicEvent({
        ...baseEvent,
        registration_url: null,
        registration_action: "扫码报名",
        registration_qr_image_url: "https://cdn.example.com/qr/register.png",
        registration_qr_image_alt: "Italian Design Weekend registration QR",
      }),
    ).toMatchObject({
      registrationAction: "扫码报名",
      registrationUrl: undefined,
      registrationQrImageUrl: "https://cdn.example.com/qr/register.png",
      registrationQrImageAlt: "Italian Design Weekend registration QR",
    });
  });

  it("shapes clean public source URLs from shared text values", () => {
    expect(
      shapePublicEvent({
        ...baseEvent,
        source_url:
          "活动分享：准备好感受泰国农业精品 https://mp.weixin.qq.com/s/r14ZCPdt5E56TFXzUPJ5Dg 。",
      }),
    ).toMatchObject({
      sourceUrl: "https://mp.weixin.qq.com/s/r14ZCPdt5E56TFXzUPJ5Dg",
    });
  });

  it("lists public canonical events with schedule, poster, and registration evidence", async () => {
    const query = {
      select() {
        return query;
      },
      eq() {
        return query;
      },
      or() {
        return query;
      },
      order() {
        return query;
      },
      async limit() {
        return {
          data: [
            {
              ...baseEvent,
              registration_action: "扫码报名",
              registration_qr_image_url:
                "https://cdn.example.com/qr/register.png",
              registration_qr_image_alt:
                "Italian Design Weekend registration QR",
            },
          ],
          error: null,
        };
      },
    };
    const client = {
      from() {
        return query;
      },
    } as unknown as PublicEventsClient;

    await expect(
      listPublicUpcomingEventsFromClient(
        client,
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        scheduleText: "6月6日 14:00-16:00",
        posterImageUrl: "https://cdn.example.com/posters/event.png",
        registrationAction: "扫码报名",
        registrationQrImageUrl: "https://cdn.example.com/qr/register.png",
      }),
    ]);
  });

  it("scopes public list and detail queries to production data", async () => {
    const listCalls: Array<[string, unknown[]]> = [];
    await listPublicUpcomingEventsFromClient(
      fallbackListClient(listCalls),
      new Date("2026-06-01T00:00:00.000Z"),
    );
    expect(listCalls).toContainEqual(["eq", ["data_class", "production"]]);

    const detailCalls: Array<[string, unknown[]]> = [];
    await getPublicEventFromClient(
      fallbackSingleClient(detailCalls),
      "event-1",
      new Date("2026-06-01T00:00:00.000Z"),
    );
    expect(detailCalls).toContainEqual(["eq", ["data_class", "production"]]);
  });

  it("scopes public archive queries to production published rows", async () => {
    const calls: Array<[string, unknown[]]> = [];
    await listPublicArchiveEventsFromClient(archiveListClient(calls));

    expect(calls).toContainEqual(["eq", ["data_class", "production"]]);
    expect(calls).toContainEqual(["eq", ["status", "published"]]);
    expect(calls).toContainEqual(["order", ["starts_at", { ascending: false }]]);
    expect(calls).toContainEqual(["limit", [200]]);
  });

  it("formats public reservation status without exposing unknown", () => {
    expect(formatReservationStatus("required")).toBe("需要预约");
    expect(formatReservationStatus("not_required")).toBe("无需预约");
    expect(formatReservationStatus("unknown")).toBe("无需预约");
  });

  it("formats event time in Asia Shanghai for public display", () => {
    expect(formatPublicEventTime(baseEvent)).toContain("6月6日");
  });

  it("formats long-running exhibition schedules for public display", () => {
    expect(
      formatPublicEventSchedule({
        ...baseEvent,
        starts_at: "2026-06-07T02:00:00.000Z",
        ends_at: "2026-08-31T11:00:00.000Z",
        schedule_text: null,
        schedule_kind: "long_running",
      }),
    ).toContain("6月7日-8月31日");
  });

  it("formats recurring schedules from upcoming occurrences", () => {
    expect(
      formatPublicEventSchedule({
        ...baseEvent,
        starts_at: "2026-05-03T06:00:00.000Z",
        ends_at: "2026-05-03T09:00:00.000Z",
        schedule_text: null,
        schedule_kind: "recurring",
        occurrence_starts_at: [
          "2026-06-06T06:00:00.000Z",
          "2026-06-13T06:00:00.000Z",
        ],
      }),
    ).toContain("每周");
  });

  it("formats detail occurrences for recurring and series-like events", () => {
    expect(
      formatPublicEventOccurrences({
        ...baseEvent,
        schedule_text: null,
        occurrence_starts_at: [
          "2026-06-06T06:00:00.000Z",
          "2026-06-13T06:00:00.000Z",
        ],
      }),
    ).toEqual([
      expect.stringContaining("6月6日"),
      expect.stringContaining("6月13日"),
    ]);
  });

  it("formats multi-day schedules as date ranges", () => {
    expect(
      formatPublicEventSchedule({
        ...baseEvent,
        starts_at: "2026-06-06T02:00:00.000Z",
        ends_at: "2026-06-08T10:00:00.000Z",
        schedule_text: null,
        schedule_kind: "multi_day",
      }),
    ).toContain("6月6日-6月8日");
  });

  it("does not mark recurring events with future occurrences as ended", () => {
    expect(
      isPublicEventEnded(
        {
          ...baseEvent,
          starts_at: "2026-05-01T06:00:00.000Z",
          ends_at: null,
          occurrence_starts_at: [
            "2026-05-31T06:00:00.000Z",
            "2026-06-07T06:00:00.000Z",
          ],
          schedule_kind: "recurring",
        },
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("marks past single events as ended", () => {
    expect(
      isPublicEventEnded(
        {
          ...baseEvent,
          starts_at: "2026-05-01T06:00:00.000Z",
          ends_at: "2026-05-01T08:00:00.000Z",
          occurrence_starts_at: null,
        },
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("returns an empty public list when the backing store is temporarily unavailable", async () => {
    const query = {
      select() {
        return query;
      },
      eq() {
        return query;
      },
      or() {
        return query;
      },
      order() {
        return query;
      },
      async limit() {
        return {
          data: null,
          error: { message: "relation missing" },
        };
      },
    };
    const client = {
      from() {
        return query;
      },
    } as unknown as PublicEventsClient;

    await expect(
      listPublicUpcomingEventsFromClient(
        client,
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual([]);
  });

  it("selects schedule fields in public queries", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const query = {
      select(...selectArgs: unknown[]) {
        calls.push(["select", selectArgs]);
        return query;
      },
      eq() {
        return query;
      },
      or() {
        return query;
      },
      order() {
        return query;
      },
      async limit() {
        return {
          data: [{ ...baseEvent, schedule_text: undefined }],
          error: null,
        };
      },
    };
    const client = {
      from(...args: unknown[]) {
        calls.push(["from", args]);
        return query;
      },
    } as unknown as PublicEventsClient;

    const events = await listPublicUpcomingEventsFromClient(
      client,
      new Date("2026-06-01T00:00:00.000Z"),
    );

    expect(calls).toContainEqual(["from", ["canonical_events"]]);
    expect(calls[1]?.[1]?.[0]).toContain("poster_image_url");
    expect(calls[1]?.[1]?.[0]).toContain("schedule_text");
    expect(calls[1]?.[1]?.[0]).toContain("public_eligibility");
    expect(calls[1]?.[1]?.[0]).toContain("event_kind");
    expect(calls[1]?.[1]?.[0]).toContain("schedule_kind");
    expect(calls[1]?.[1]?.[0]).toContain("recurrence_rule");
    expect(calls[1]?.[1]?.[0]).toContain("occurrence_starts_at");
    expect(calls[1]?.[1]?.[0]).toContain("resolution_decision");
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

  it("keeps ended published public-renderable detail pages accessible", async () => {
    const client = singleEventClient({
      ...baseEvent,
      event_id: "ended-public",
      starts_at: "2026-05-01T06:00:00.000Z",
      ends_at: "2026-05-01T08:00:00.000Z",
      schedule_text: null,
      occurrence_starts_at: null,
    });

    await expect(
      getPublicEventFromClient(
        client,
        "ended-public",
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      eventId: "ended-public",
      status: "published",
    });
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

function archiveListClient(calls: Array<[string, unknown[]]>) {
  const query = {
    select(...args: unknown[]) {
      calls.push(["select", args]);
      return query;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", args]);
      return query;
    },
    order(...args: unknown[]) {
      calls.push(["order", args]);
      return query;
    },
    async limit(...args: unknown[]) {
      calls.push(["limit", args]);
      return {
        data: [],
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

function singleEventClient(event: CanonicalEventRow) {
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    async maybeSingle() {
      return {
        data: event,
        error: null,
      };
    },
  };

  return {
    from() {
      return query;
    },
  } as unknown as PublicEventsClient;
}
