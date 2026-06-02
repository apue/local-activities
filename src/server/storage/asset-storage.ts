export type AssetStorageProvider = "vercel_blob";

export type AssetAccess = "public" | "private";

export type RuntimeAssetRole =
  | "poster"
  | "qr"
  | "screenshot"
  | "article_image"
  | "cover";

export type PutAssetInput = {
  bytes: Buffer;
  contentType: string;
  keyHint: string;
  role: RuntimeAssetRole;
  access?: AssetAccess;
};

export type StoredAsset = {
  assetId: string;
  provider: AssetStorageProvider;
  key: string;
  access: AssetAccess;
  publicUrl?: string;
  downloadUrl?: string;
  contentType: string;
  byteSize: number;
  contentHash: string;
  etag?: string;
};

export type AssetStorage = {
  put(input: PutAssetInput): Promise<StoredAsset>;
  getPublicUrl(asset: StoredAsset): Promise<string | null>;
};
