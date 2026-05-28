import { timingSafeEqual } from "node:crypto";

type AdminAuthEnv = {
  [key: string]: string | undefined;
  ADMIN_ACCESS_TOKEN?: string;
};

export type AdminAuthResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      status: 401 | 500;
      error: "admin_auth_not_configured" | "invalid_admin_token";
    };

export function authenticateAdminRequest(
  request: Request,
  env: AdminAuthEnv,
): AdminAuthResult {
  const expectedToken = env.ADMIN_ACCESS_TOKEN?.trim();
  if (!expectedToken) {
    return {
      ok: false,
      status: 500,
      error: "admin_auth_not_configured",
    };
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!token || !secureCompare(token, expectedToken)) {
    return {
      ok: false,
      status: 401,
      error: "invalid_admin_token",
    };
  }

  return { ok: true };
}

function secureCompare(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
