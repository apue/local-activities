import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const originalCollectorApiKey = process.env.COLLECTOR_API_KEY;

describe("GET /api/collector/ping", () => {
  afterEach(() => {
    process.env.COLLECTOR_API_KEY = originalCollectorApiKey;
  });

  it("returns collector identity when authenticated", async () => {
    process.env.COLLECTOR_API_KEY = "collector-secret";

    const response = await GET(
      new Request("https://example.com/api/collector/ping", {
        headers: {
          authorization: "Bearer collector-secret",
          "x-collector-id": "home-192-168-0-16",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      collectorId: "home-192-168-0-16",
    });
  });

  it("returns sanitized auth errors", async () => {
    process.env.COLLECTOR_API_KEY = "collector-secret";

    const response = await GET(
      new Request("https://example.com/api/collector/ping", {
        headers: {
          authorization: "Bearer wrong-secret",
          "x-collector-id": "home-192-168-0-16",
        },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_collector_token",
    });
  });
});
