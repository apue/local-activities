export function classifyWriteTarget(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return { kind: "missing", baseUrl: "" };

  const hostname = new URL(normalized).hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return { kind: "local", baseUrl: normalized, hostname };
  }
  if (hostname === "activities.example" || hostname.endsWith(".example")) {
    return { kind: "test", baseUrl: normalized, hostname };
  }
  if (
    hostname === "local-activities.vercel.app" ||
    hostname.endsWith("whatsinfor.me")
  ) {
    return { kind: "production", baseUrl: normalized, hostname };
  }
  if (hostname.endsWith(".vercel.app")) {
    return { kind: "preview", baseUrl: normalized, hostname };
  }
  return { kind: "hosted", baseUrl: normalized, hostname };
}

export function assertHostedWriteAllowed({
  command,
  baseUrl,
  allowHostedWrite = false,
  allowPublicFixtureData = false,
  requiresPublicFixtureData = false,
}) {
  const target = classifyWriteTarget(baseUrl);
  if (target.kind === "missing") throw new Error(`${command}_missing_target_base_url`);
  const hosted = ["hosted", "preview", "production"].includes(target.kind);
  if (hosted && !allowHostedWrite) {
    throw new Error(`${command}_requires_allow_hosted_write`);
  }
  if (
    requiresPublicFixtureData &&
    target.kind === "production" &&
    !allowPublicFixtureData
  ) {
    throw new Error(`${command}_refuses_production_public_fixture_data`);
  }
  return target;
}

export function writeTargetSummary({
  command,
  target,
  runId,
  writeMode,
  usageEnvironment,
}) {
  return [
    `command=${command}`,
    `target=${target.kind}`,
    `baseUrl=${target.baseUrl}`,
    runId ? `runId=${runId}` : undefined,
    writeMode ? `writeMode=${writeMode}` : undefined,
    usageEnvironment ? `usageEnvironment=${usageEnvironment}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export function normalizeEvalUsageEnvironment(env = process.env) {
  const explicit =
    clean(env.VISION_EVAL_USAGE_ENVIRONMENT) ?? clean(env.USAGE_ENVIRONMENT);
  if (explicit) return explicit.startsWith("eval") ? explicit : `eval:${explicit}`;
  const base = clean(env.VERCEL_ENV) ?? clean(env.NODE_ENV) ?? "local";
  return base.startsWith("eval") ? base : `eval:${base}`;
}

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return new URL(trimmed).toString().replace(/\/+$/, "");
}

function clean(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
