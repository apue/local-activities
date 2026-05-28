import { timingSafeEqual } from "node:crypto";

type InternalAuthEnv = {
  [key: string]: string | undefined;
  INTERNAL_API_SECRET?: string;
};

export type InternalAuthResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      status: 401 | 500;
      error: "internal_auth_not_configured" | "invalid_internal_token";
    };

export function authenticateInternalRequest(
  request: Request,
  env: InternalAuthEnv,
): InternalAuthResult {
  const expectedToken = env.INTERNAL_API_SECRET?.trim();
  if (!expectedToken) {
    return {
      ok: false,
      status: 500,
      error: "internal_auth_not_configured",
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
      error: "invalid_internal_token",
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
