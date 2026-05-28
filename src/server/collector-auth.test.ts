import { describe, expect, it } from "vitest";

import { authenticateCollectorRequest } from "./collector-auth";

function request(headers: HeadersInit) {
  return new Request("https://example.com/api/collector/ping", { headers });
}

describe("authenticateCollectorRequest", () => {
  it("accepts a matching bearer token and collector id", () => {
    const result = authenticateCollectorRequest(
      request({
        authorization: "Bearer collector-secret",
        "x-collector-id": "home-192-168-0-16",
      }),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(result).toEqual({
      ok: true,
      collectorId: "home-192-168-0-16",
    });
  });

  it("reports missing server configuration without leaking details", () => {
    const result = authenticateCollectorRequest(
      request({
        authorization: "Bearer collector-secret",
        "x-collector-id": "home-192-168-0-16",
      }),
      {},
    );

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: "collector_auth_not_configured",
    });
  });

  it("rejects missing collector id before accepting a valid token", () => {
    const result = authenticateCollectorRequest(
      request({
        authorization: "Bearer collector-secret",
      }),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "missing_collector_id",
    });
  });

  it("rejects malformed authorization headers", () => {
    const result = authenticateCollectorRequest(
      request({
        authorization: "collector-secret",
        "x-collector-id": "home-192-168-0-16",
      }),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "invalid_collector_token",
    });
  });

  it("rejects invalid tokens without echoing configured secrets", () => {
    const result = authenticateCollectorRequest(
      request({
        authorization: "Bearer wrong-secret",
        "x-collector-id": "home-192-168-0-16",
      }),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "invalid_collector_token",
    });
    expect(JSON.stringify(result)).not.toContain("collector-secret");
    expect(JSON.stringify(result)).not.toContain("wrong-secret");
  });
});
