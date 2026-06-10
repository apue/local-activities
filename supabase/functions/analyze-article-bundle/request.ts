import type { AnalyzeDataClass, AnalyzeRequest } from "./types.ts";

export function authenticateCollector(
  request: Request,
  { collectorEdgeToken }: { collectorEdgeToken?: string },
): boolean {
  const expected = clean(collectorEdgeToken);
  if (!expected) return false;
  const headerToken = clean(request.headers.get("x-collector-edge-token"));
  const bearer = bearerToken(request.headers.get("authorization"));
  return headerToken === expected || bearer === expected;
}

export async function parseAnalyzeRequest(
  request: Request,
): Promise<AnalyzeRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("invalid_json");
  }
  if (!isRecord(body)) throw new Error("invalid_request_body");

  const dataClass = parseDataClass(body.dataClass);
  const parsed: AnalyzeRequest = {
    sourceUrl: requiredString(body, "sourceUrl"),
    bundleId: requiredString(body, "bundleId"),
    storagePrefix: requiredString(body, "storagePrefix"),
    contentHash: requiredString(body, "contentHash"),
    sourceProvider: requiredString(body, "sourceProvider"),
    dataClass,
  };

  const publishedAt = optionalString(body, "publishedAt");
  const sourceId = optionalString(body, "sourceId");
  const sourceName = optionalString(body, "sourceName");
  if (publishedAt) parsed.publishedAt = publishedAt;
  if (sourceId) parsed.sourceId = sourceId;
  if (sourceName) parsed.sourceName = sourceName;
  return parsed;
}

function parseDataClass(value: unknown): AnalyzeDataClass {
  if (value === undefined || value === null || value === "") {
    return "production";
  }
  if (
    value === "production" ||
    value === "eval" ||
    value === "test" ||
    value === "smoke"
  ) return value;
  throw new Error("invalid_data_class");
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = optionalString(body, field);
  if (!value) throw new Error(`missing_${field}`);
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`invalid_${field}`);
  const text = String(value).trim();
  return text || undefined;
}

function bearerToken(value: string | null): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return clean(match?.[1]);
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
