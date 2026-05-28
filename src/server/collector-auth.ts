import { timingSafeEqual } from "node:crypto";

type CollectorAuthEnv = {
  [key: string]: string | undefined;
  COLLECTOR_API_KEY?: string;
};

export type CollectorAuthResult =
  | {
      ok: true;
      collectorId: string;
    }
  | {
      ok: false;
      status: 400 | 401 | 500;
      error:
        | "collector_auth_not_configured"
        | "missing_collector_id"
        | "invalid_collector_token";
    };

export function authenticateCollectorRequest(
  request: Request,
  env: CollectorAuthEnv,
): CollectorAuthResult {
  const expectedToken = env.COLLECTOR_API_KEY?.trim();
  if (!expectedToken) {
    return {
      ok: false,
      status: 500,
      error: "collector_auth_not_configured",
    };
  }

  const collectorId = request.headers.get("x-collector-id")?.trim();
  if (!collectorId) {
    return {
      ok: false,
      status: 400,
      error: "missing_collector_id",
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
      error: "invalid_collector_token",
    };
  }

  return {
    ok: true,
    collectorId,
  };
}

function secureCompare(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
