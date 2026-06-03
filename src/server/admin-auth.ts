import { timingSafeEqual } from "node:crypto";

type AdminAuthEnv = {
  [key: string]: string | undefined;
  ADMIN_ACCESS_TOKEN?: string;
};

export const adminSessionCookieName = "admin_session";

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
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const cookieToken = readCookie(request, adminSessionCookieName);
  const token = bearerToken || cookieToken;

  if (!token || !secureCompare(token, expectedToken)) {
    return {
      ok: false,
      status: 401,
      error: "invalid_admin_token",
    };
  }

  return { ok: true };
}

export function adminSessionCookie(token: string) {
  return `${adminSessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return "";
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return "";
}

function secureCompare(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
