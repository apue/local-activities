import { createHash } from "node:crypto";

import type { RuntimeAssetRole } from "./asset-storage";

export type AssetStorageKeyInput = {
  prefix: string;
  role: RuntimeAssetRole;
  keyHint: string;
  contentType: string;
  contentHash: string;
};

export function contentHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildAssetStorageKey(input: AssetStorageKeyInput) {
  const prefix = normalizePathSegment(input.prefix) || "runtime-assets";
  const role = normalizePathSegment(input.role);
  const slug = slugify(input.keyHint, input.role);
  const hash = input.contentHash.slice(0, 16);
  const extension = extensionForContentType(input.contentType);

  return `${prefix}/${role}/${slug}-${hash}${extension}`;
}

export function slugify(value: string, fallback = "asset") {
  const slug = value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || fallback;
}

function normalizePathSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^-+|-+$/g, "");
}

function extensionForContentType(contentType: string) {
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/svg+xml") return ".svg";
  if (contentType === "text/plain") return ".txt";
  if (contentType === "text/html") return ".html";
  return ".bin";
}
