import { createHmac, timingSafeEqual } from "node:crypto";

type CollectorScopedTokenPayload = {
  collectorId: string;
  jobId: string;
  expiresAt: string;
};

export function createCollectorScopedToken(input: CollectorScopedTokenPayload & {
  secret: string;
}) {
  const payload = encodeBase64Url(
    JSON.stringify({
      collectorId: input.collectorId,
      jobId: input.jobId,
      expiresAt: input.expiresAt,
    }),
  );
  const signature = sign(payload, input.secret);
  return `scoped.${payload}.${signature}`;
}

export function verifyCollectorScopedToken(input: {
  token: string;
  collectorId: string;
  jobId?: string;
  secret?: string;
  now?: Date;
}): boolean {
  const secret = input.secret?.trim();
  if (!secret || !input.token.startsWith("scoped.")) return false;

  const [, payload, signature] = input.token.split(".");
  if (!payload || !signature) return false;
  if (!secureCompare(signature, sign(payload, secret))) return false;

  const parsed = parsePayload(payload);
  if (!parsed) return false;
  if (parsed.collectorId !== input.collectorId) return false;
  if (parsed.jobId !== input.jobId) return false;
  if (Date.parse(parsed.expiresAt) <= (input.now ?? new Date()).getTime()) {
    return false;
  }

  return true;
}

function parsePayload(payload: string): CollectorScopedTokenPayload | null {
  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as Partial<
      CollectorScopedTokenPayload
    >;
    if (
      typeof parsed.collectorId !== "string" ||
      typeof parsed.jobId !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      Number.isNaN(Date.parse(parsed.expiresAt))
    ) {
      return null;
    }
    return {
      collectorId: parsed.collectorId,
      jobId: parsed.jobId,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function secureCompare(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}
