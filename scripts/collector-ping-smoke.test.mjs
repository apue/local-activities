import { describe, expect, it } from "vitest";

import {
  buildCollectorPingHeaders,
  formatCollectorPingSmokeSummary,
  readCollectorPingSmokeConfig,
  runCollectorPingSmoke,
} from "./collector-ping-smoke.mjs";

describe("collector ping smoke", () => {
  it("reports missing config explicitly", () => {
    expect(readCollectorPingSmokeConfig({})).toEqual({
      ok: false,
      missing: ["APP_BASE_URL", "COLLECTOR_API_KEY", "COLLECTOR_ID"],
    });
  });

  it("checks collector ping with collector auth and validates response shape", async () => {
    const calls = [];
    const result = await runCollectorPingSmoke({
      env: {
        APP_BASE_URL: "https://local-activities.example/",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({
          ok: true,
          collectorId: "home-1",
        });
      },
    });

    expect(calls).toEqual([
      {
        url: "https://local-activities.example/api/collector/ping",
        init: {
          method: "GET",
          headers: {
            authorization: "Bearer collector-secret",
            "content-type": "application/json",
            "x-collector-id": "home-1",
          },
        },
      },
    ]);
    expect(result).toEqual({
      kind: "passed",
      baseUrl: "https://local-activities.example",
      collectorId: "home-1",
    });
  });

  it("fails when the ping response is not authenticated or has the wrong shape", async () => {
    await expect(
      runCollectorPingSmoke({
        env: {
          APP_BASE_URL: "https://local-activities.example",
          COLLECTOR_API_KEY: "collector-secret",
          COLLECTOR_ID: "home-1",
        },
        fetchImpl: async () =>
          jsonResponse({ ok: false, error: "invalid_collector_token" }, 401),
      }),
    ).rejects.toThrow("collector_ping_failed:401:invalid_collector_token");

    await expect(
      runCollectorPingSmoke({
        env: {
          APP_BASE_URL: "https://local-activities.example",
          COLLECTOR_API_KEY: "collector-secret",
          COLLECTOR_ID: "home-1",
        },
        fetchImpl: async () => jsonResponse({ ok: true }),
      }),
    ).rejects.toThrow("collector_ping_shape_failed");
  });

  it("formats summaries and headers without exposing collector secrets", () => {
    expect(buildCollectorPingHeaders("home-1", "collector-secret")).toEqual({
      authorization: "Bearer collector-secret",
      "content-type": "application/json",
      "x-collector-id": "home-1",
    });

    const summary = formatCollectorPingSmokeSummary({
      kind: "passed",
      baseUrl: "https://local-activities.example",
      collectorId: "home-1",
    });

    expect(summary).toContain("Collector ping smoke passed");
    expect(summary).toContain("collectorId=home-1");
    expect(summary).not.toContain("collector-secret");
  });
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
