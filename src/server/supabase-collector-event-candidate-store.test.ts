import { describe, expect, it } from "vitest";

import { getSupabaseCollectorEventCandidateStore } from "./supabase-collector-event-candidate-store";

describe("supabase collector event candidate store", () => {
  it("queries bounded canonical event candidates using blocking fields", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const store = getSupabaseCollectorEventCandidateStore(
      supabaseClientReturning(calls, {
        canonical_events: [
          {
            event_id: "event-1",
            title: "泰国风情节",
            organizer: "泰国驻华大使馆",
            starts_at: "2026-05-30T00:30:00.000Z",
            ends_at: "2026-05-30T10:00:00.000Z",
            timezone: "Asia/Shanghai",
            city: "Beijing",
            venue_name: "朝阳公园",
            venue_address: "北京市朝阳区朝阳公园",
            source_url: "https://mp.weixin.qq.com/s/example",
            schedule_text: "5月30日至31日每日8:30-18:00",
            status: "published",
            published_at: "2026-05-29T08:00:00.000Z",
          },
        ],
        event_drafts: [
          {
            draft_id: "draft-1",
            title: "泰国风情节",
            organizer: "泰国驻华大使馆",
            starts_at: "2026-05-30T00:30:00.000Z",
            ends_at: "2026-05-30T10:00:00.000Z",
            timezone: "Asia/Shanghai",
            city: "Beijing",
            venue_name: "朝阳公园",
            venue_address: "北京市朝阳区朝阳公园",
            article_url: "https://mp.weixin.qq.com/s/draft",
            schedule_text: "5月30日至31日每日8:30-18:00",
            review_state: "ready_for_review",
          },
        ],
      }),
    );

    await expect(
      store.findEventCandidates({
        title: "泰国风情节",
        organizer: "泰国驻华大使馆",
        startsAt: "2026-05-30T00:30:00.000Z",
        endsAt: "2026-05-31T10:00:00.000Z",
        venueName: "朝阳公园",
        sourceUrl: "https://mp.weixin.qq.com/s/example",
        limit: 3,
      }),
    ).resolves.toEqual([
      {
        eventId: "event-1",
        title: "泰国风情节",
        organizer: "泰国驻华大使馆",
        startsAt: "2026-05-30T00:30:00.000Z",
        endsAt: "2026-05-30T10:00:00.000Z",
        timezone: "Asia/Shanghai",
        city: "Beijing",
        venueName: "朝阳公园",
        venueAddress: "北京市朝阳区朝阳公园",
        sourceUrl: "https://mp.weixin.qq.com/s/example",
        scheduleText: "5月30日至31日每日8:30-18:00",
        status: "published",
        publishedAt: "2026-05-29T08:00:00.000Z",
      },
      {
        eventId: "draft-1",
        title: "泰国风情节",
        organizer: "泰国驻华大使馆",
        startsAt: "2026-05-30T00:30:00.000Z",
        endsAt: "2026-05-30T10:00:00.000Z",
        timezone: "Asia/Shanghai",
        city: "Beijing",
        venueName: "朝阳公园",
        venueAddress: "北京市朝阳区朝阳公园",
        sourceUrl: "https://mp.weixin.qq.com/s/draft",
        scheduleText: "5月30日至31日每日8:30-18:00",
        status: "draft",
        publishedAt: null,
      },
    ]);
    expect(calls).toContainEqual(["from", ["canonical_events"]]);
    expect(calls).toContainEqual(["from", ["event_drafts"]]);
    expect(calls).toContainEqual([
      "select",
      [
        "event_id,title,organizer,starts_at,ends_at,timezone,city,venue_name,venue_address,source_url,schedule_text,status,published_at",
      ],
    ]);
    expect(calls).toContainEqual(["in", ["status", ["published", "cancelled"]]]);
    expect(calls).toContainEqual(["eq", ["source_url", "https://mp.weixin.qq.com/s/example"]]);
    expect(calls).toContainEqual(["ilike", ["title", "%泰国风情节%"]]);
    expect(calls).toContainEqual(["ilike", ["organizer", "%泰国驻华大使馆%"]]);
    expect(calls).toContainEqual(["ilike", ["venue_name", "%朝阳公园%"]]);
    expect(calls.filter(([name]) => name === "limit")).toEqual([
      ["limit", [3]],
      ["limit", [3]],
    ]);
  });
});

function supabaseClientReturning(
  calls: Array<[string, unknown[]]>,
  rowsByTable: Record<string, unknown[]>,
) {
  const query = {
    select(...args: unknown[]) {
      calls.push(["select", args]);
      return query;
    },
    in(...args: unknown[]) {
      calls.push(["in", args]);
      return query;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", args]);
      return query;
    },
    ilike(...args: unknown[]) {
      calls.push(["ilike", args]);
      return query;
    },
    gte(...args: unknown[]) {
      calls.push(["gte", args]);
      return query;
    },
    lte(...args: unknown[]) {
      calls.push(["lte", args]);
      return query;
    },
    order(...args: unknown[]) {
      calls.push(["order", args]);
      return query;
    },
    limit(...args: unknown[]) {
      calls.push(["limit", args]);
      return Promise.resolve({ data: rowsByTable[currentTable], error: null });
    },
  };
  let currentTable = "";

  return {
    from(...args: unknown[]) {
      currentTable = String(args[0]);
      calls.push(["from", args]);
      return query;
    },
  } as never;
}
