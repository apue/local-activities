import { put as vercelBlobPut } from "@vercel/blob";

import type {
  AssetAccess,
  AssetStorage,
  PutAssetInput,
  StoredAsset,
} from "./asset-storage";
import { buildAssetStorageKey, contentHash } from "./storage-key";

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

export type VercelBlobAssetStorageOptions = {
  prefix?: string;
  put?: PutBlob;
};

export class VercelBlobAssetStorage implements AssetStorage {
  private readonly prefix: string;
  private readonly putBlob: PutBlob;

  constructor(options: VercelBlobAssetStorageOptions = {}) {
    this.prefix = options.prefix ?? "runtime-assets";
    this.putBlob = options.put ?? vercelBlobPut;
  }

  async put(input: PutAssetInput): Promise<StoredAsset> {
    const access = input.access ?? "public";
    const hash = contentHash(input.bytes);
    const key = buildAssetStorageKey({
      prefix: this.prefix,
      role: input.role,
      keyHint: input.keyHint,
      contentType: input.contentType,
      contentHash: hash,
    });
    const blob = await this.putBlob(key, input.bytes, {
      access,
      contentType: input.contentType,
      allowOverwrite: true,
    });
    const storedKey = blob.pathname ?? key;

    return {
      assetId: `vercel_blob:${storedKey}`,
      provider: "vercel_blob",
      key: storedKey,
      access,
      publicUrl: access === "public" ? blob.url : undefined,
      downloadUrl: blob.downloadUrl,
      contentType: blob.contentType ?? input.contentType,
      byteSize: input.bytes.byteLength,
      contentHash: hash,
      etag: blob.etag,
    };
  }

  async getPublicUrl(asset: StoredAsset) {
    return asset.access === "public" ? (asset.publicUrl ?? null) : null;
  }
}
