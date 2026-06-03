import { put as vercelBlobPut } from "@vercel/blob";

type PutBlob = (
  pathname: string,
  body: Buffer,
  options: {
    access: "public";
    contentType: string;
    addRandomSuffix: true;
  },
) => Promise<{ url: string }>;

export type PublicEventImageInput = {
  bytes: Buffer;
  contentType: string;
  keyHint: string;
};

export type PublicEventAssetRole =
  | "poster"
  | "registration_qr"
  | "article_image"
  | "screenshot";

export type PublicEventAssetInput = PublicEventImageInput & {
  role: PublicEventAssetRole;
};

export type PublicAssetStoreDeps = {
  put?: PutBlob;
};

export async function putPublicEventImage(
  input: PublicEventImageInput,
  deps: PublicAssetStoreDeps = {},
) {
  return putPublicEventAsset({ ...input, role: "poster" }, deps);
}

export async function putPublicEventAsset(
  input: PublicEventAssetInput,
  deps: PublicAssetStoreDeps = {},
) {
  const put = deps.put ?? vercelBlobPut;
  const extension = extensionForContentType(input.contentType);
  const pathname = `${assetDirectory(input.role)}/${slugify(input.keyHint)}-${Date.now()}${extension}`;
  const blob = await put(pathname, input.bytes, {
    access: "public",
    contentType: input.contentType,
    addRandomSuffix: true,
  });

  return { url: blob.url };
}

function assetDirectory(role: PublicEventAssetRole) {
  if (role === "poster") return "event-posters";
  return `event-assets/${role}`;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "event-poster";
}

function extensionForContentType(contentType: string) {
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  return ".png";
}
