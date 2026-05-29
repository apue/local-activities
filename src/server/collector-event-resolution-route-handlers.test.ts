import { describe, expect, it } from "vitest";

import {
  handleCollectorEventResolution,
  type CollectorEventResolutionStore,
} from "./collector-event-resolution-route-handlers";

class RouteResolutionStore implements CollectorEventResolutionStore {
  mentions: unknown[] = [];
  revisions: unknown[] = [];

  async recordEventMention(input: Parameters<
    CollectorEventResolutionStore["recordEventMention"]
  >[0]) {
    this.mentions.push(input);
    return { id: "mention-1" };
  }

  async recordEventRevision(input: Parameters<
    CollectorEventResolutionStore["recordEventRevision"]
  >[0]) {
    this.revisions.push(input);
    return { id: "revision-1" };
  }
}

function post(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://example.com/api/collector/event-resolution", {
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

describe("collector event resolution route handler", () => {
  it("requires collector authentication", async () => {
    const response = await handleCollectorEventResolution(
      post(
        {
          decision: "same_event",
          eventDraftId: "draft-1",
          canonicalEventId: "event-1",
          confidence: 0.94,
          rationale: "Same title and overlapping time.",
        },
        { authorization: "Bearer wrong" },
      ),
      new RouteResolutionStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_collector_token",
    });
  });

  it("rejects update decisions without a target event", async () => {
    const response = await handleCollectorEventResolution(
      post({
        decision: "update_existing",
        eventDraftId: "draft-1",
        confidence: 0.88,
        rationale: "Updated venue.",
        proposedChanges: {
          venueName: "New Hall",
        },
      }),
      new RouteResolutionStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("records same-event decisions as event mentions", async () => {
    const store = new RouteResolutionStore();
    const response = await handleCollectorEventResolution(
      post({
        decision: "same_event",
        eventDraftId: "draft-1",
        canonicalEventId: "event-1",
        confidence: 0.94,
        rationale: "Same title and overlapping time.",
        sourceEvidence: {
          title: ["泰国风情节"],
        },
      }),
      store,
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(200);
    expect(store.mentions).toEqual([
      {
        collectorId: "home-1",
        eventDraftId: "draft-1",
        canonicalEventId: "event-1",
        matchScore: 0.94,
        matchReason: {
          decision: "same_event",
          rationale: "Same title and overlapping time.",
          sourceEvidence: {
            title: ["泰国风情节"],
          },
        },
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      resolution: {
        id: "mention-1",
        kind: "mention",
      },
    });
  });

  it("records update decisions as approved event revisions", async () => {
    const store = new RouteResolutionStore();
    const response = await handleCollectorEventResolution(
      post({
        decision: "update_existing",
        eventDraftId: "draft-1",
        canonicalEventId: "event-1",
        confidence: 0.9,
        rationale: "Venue changed in the newer source.",
        proposedChanges: {
          venueName: "New Hall",
          venueAddress: "北京市朝阳区新地址",
        },
      }),
      store,
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(200);
    expect(store.revisions).toEqual([
      {
        collectorId: "home-1",
        eventDraftId: "draft-1",
        canonicalEventId: "event-1",
        revisionType: "update",
        proposedChanges: {
          venueName: "New Hall",
          venueAddress: "北京市朝阳区新地址",
        },
        reviewState: "approved",
        sourceEvidence: {
          decision: "update_existing",
          confidence: 0.9,
          rationale: "Venue changed in the newer source.",
          sourceEvidence: undefined,
        },
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      resolution: {
        id: "revision-1",
        kind: "revision",
        revisionType: "update",
      },
    });
  });
});
