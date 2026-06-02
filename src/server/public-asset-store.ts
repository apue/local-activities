import { VercelBlobAssetStorage } from "./storage/vercel-blob-storage";
import type { AssetAccess } from "./storage/asset-storage";

type PutBlob = (
  pathname: string,
  body: Buffer,
  options: {
    access: AssetAccess;
    contentType: string;
    allowOverwrite: true;
  },
) => Promise<{
  url: string;
  downloadUrl?: string;
  pathname?: string;
  contentType?: string;
  etag?: string;
}>;

export type PublicEventImageInput = {
  bytes: Buffer;
  contentType: string;
  keyHint: string;
};

export type PublicAssetStoreDeps = {
  put?: PutBlob;
};

export async function putPublicEventImage(
  input: PublicEventImageInput,
  deps: PublicAssetStoreDeps = {},
) {
  const storage = new VercelBlobAssetStorage({
    prefix: "event-posters",
    put: deps.put,
  });
  const asset = await storage.put({
    bytes: input.bytes,
    contentType: input.contentType,
    keyHint: input.keyHint,
    role: "poster",
    access: "public",
  });
  const url = await storage.getPublicUrl(asset);
  if (!url) {
    throw new Error("public_asset_url_missing");
  }

  return { url };
}
