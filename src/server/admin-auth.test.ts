import { describe, expect, it } from "vitest";

import { authenticateAdminRequest } from "./admin-auth";

function request(headers: HeadersInit) {
  return new Request("https://example.com/api/admin/collector-jobs", {
    headers,
  });
}

describe("authenticateAdminRequest", () => {
  it("accepts a matching admin bearer token", () => {
    const result = authenticateAdminRequest(
      request({ authorization: "Bearer admin-secret" }),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(result).toEqual({ ok: true });
  });

  it("reports missing server config without leaking request values", () => {
    const result = authenticateAdminRequest(
      request({ authorization: "Bearer admin-secret" }),
      {},
    );

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: "admin_auth_not_configured",
    });
  });

  it("rejects invalid admin tokens without echoing either token", () => {
    const result = authenticateAdminRequest(
      request({ authorization: "Bearer wrong-secret" }),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "invalid_admin_token",
    });
    expect(JSON.stringify(result)).not.toContain("admin-secret");
    expect(JSON.stringify(result)).not.toContain("wrong-secret");
  });
});
