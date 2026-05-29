import { describe, expect, it } from "vitest";

import {
  handleCollectorEventCandidates,
  type CollectorEventCandidate,
  type CollectorEventCandidateStore,
} from "./collector-event-candidates-route-handlers";

class RouteCandidateStore implements CollectorEventCandidateStore {
  calls: unknown[] = [];

  async findEventCandidates(input: Parameters<
    CollectorEventCandidateStore["findEventCandidates"]
  >[0]): Promise<CollectorEventCandidate[]> {
    this.calls.push(input);
    return Promise.resolve([
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
    ]);
  }
}

function post(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://example.com/api/collector/event-candidates", {
    method: "POST",
    headers: {
      authorization: "Bearer collector-secret",
      "content-type": "application/json",
      "x-collector-id": "home-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("collector event candidate route handler", () => {
  it("requires collector authentication", async () => {
    const response = await handleCollectorEventCandidates(
      post({ title: "泰国风情节" }, { authorization: "Bearer wrong" }),
      new RouteCandidateStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_collector_token",
    });
  });

  it("rejects requests without blocking fields", async () => {
    const response = await handleCollectorEventCandidates(
      post({ limit: 5 }),
      new RouteCandidateStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("returns bounded candidate events for editor-agent semantic judgment", async () => {
    const store = new RouteCandidateStore();
    const response = await handleCollectorEventCandidates(
      post({
        title: " 泰国风情节 ",
        organizer: "泰国驻华大使馆",
        startsAt: "2026-05-30T00:30:00.000Z",
        endsAt: "2026-05-31T10:00:00.000Z",
        venueName: "朝阳公园",
        sourceUrl: "https://mp.weixin.qq.com/s/example",
        limit: 3,
      }),
      store,
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(200);
    expect(store.calls).toEqual([
      {
        title: "泰国风情节",
        organizer: "泰国驻华大使馆",
        startsAt: "2026-05-30T00:30:00.000Z",
        endsAt: "2026-05-31T10:00:00.000Z",
        venueName: "朝阳公园",
        sourceUrl: "https://mp.weixin.qq.com/s/example",
        limit: 3,
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      candidates: [
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
      ],
    });
  });
});
