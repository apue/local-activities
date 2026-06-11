import { createHash } from "node:crypto";

const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;

export function createLiveArtifactRecorder({
  writer,
  basePath,
  dataClass = "eval",
} = {}) {
  if (!writer || typeof writer.writeArtifact !== "function") {
    throw new Error("live_artifact_recorder_writer_required");
  }
  const cleanBasePath = clean(basePath);
  if (!cleanBasePath) throw new Error("live_artifact_recorder_base_path_required");
  let sequence = 0;
  const pointers = [];

  return {
    dataClass,
    pointers,
    paths() {
      return pointers.map((pointer) => pointer.path);
    },
    pointersByKind(kind) {
      return pointers.filter((pointer) => pointer.kind === kind);
    },
    async write(kind, value, { fileName } = {}) {
      const cleanKind = clean(kind);
      if (!cleanKind) throw new Error("live_artifact_recorder_kind_required");
      sequence += 1;
      const sanitizedValue = redactSecrets(value);
      const artifact = {
        ...(isPlainObject(sanitizedValue) ? sanitizedValue : { value: sanitizedValue }),
        kind: cleanKind,
        dataClass,
      };
      const path = `${cleanBasePath}/${fileName ?? `${String(sequence).padStart(3, "0")}-${cleanKind}.json`}`;
      await writer.writeArtifact(path, artifact);
      const pointer = {
        artifactId: `${cleanKind}-${sequence}`,
        path,
        kind: cleanKind,
        hash: hashJson(artifact),
      };
      pointers.push(pointer);
      return pointer;
    },
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function redactSecrets(value) {
  return redactValue(value);
}

function redactValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(bearerPattern, "Bearer [REDACTED]");
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? "[REDACTED]" : redactValue(item, seen);
  }
  return output;
}

function isSensitiveKey(key) {
  const normalized = String(key ?? "").toLowerCase();
  return normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie" ||
    normalized === "apikey" ||
    normalized === "api_key" ||
    normalized === "api-key" ||
    normalized === "x-api-key" ||
    normalized === "secret" ||
    normalized.endsWith("_secret") ||
    normalized.endsWith("-secret") ||
    normalized === "password" ||
    normalized === "token" ||
    normalized === "access_token" ||
    normalized === "refresh_token" ||
    normalized === "id_token";
}

function hashJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
