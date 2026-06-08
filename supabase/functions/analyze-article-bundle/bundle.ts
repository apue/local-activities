import type { ArticleBundle, BundleImage, StorageReader } from "./types.ts";

const articleBundleBucket = "article-bundles";

export async function readArticleBundle(
  storage: StorageReader,
  { storagePrefix }: { storagePrefix: string },
): Promise<ArticleBundle> {
  const objectPrefix = stripBucketPrefix(storagePrefix, articleBundleBucket);
  const manifest = await readJsonRecord(
    storage,
    `${objectPrefix}/manifest.json`,
    true,
  );
  const html = await readText(storage, `${objectPrefix}/article.html`) ?? "";
  const text = await readText(storage, `${objectPrefix}/article.txt`) ?? "";
  const links = await readLinks(storage, `${objectPrefix}/links.json`);
  const diagnostics = await readDiagnostics(
    storage,
    `${objectPrefix}/diagnostics.json`,
  );
  const images = await signByteBackedImages(
    storage,
    uniqueImages(objectPrefix, [
      ...imageArrayFrom(manifest.images),
      ...await readJsonArray(
        storage,
        `${objectPrefix}/images.json`,
      ) as unknown[],
      ...await readJsonArray(
        storage,
        `${objectPrefix}/image-references.json`,
      ) as unknown[],
    ]),
  );

  return { manifest, html, text, links, diagnostics, images };
}

async function signByteBackedImages(
  storage: StorageReader,
  images: BundleImage[],
): Promise<BundleImage[]> {
  const createSignedUrl = storage.createSignedUrl;
  if (!createSignedUrl) return images;
  return await Promise.all(images.map(async (image) => {
    if (image.publicUrl || !image.hasBytes || !image.bundleStoragePath) {
      return image;
    }
    const signedUrl = await createSignedUrl(
      articleBundleBucket,
      image.bundleStoragePath,
      10 * 60,
    );
    return signedUrl ? { ...image, publicUrl: signedUrl } : image;
  }));
}

function stripBucketPrefix(storagePrefix: string, bucket: string): string {
  const prefix = storagePrefix.replace(/^\/+|\/+$/g, "");
  const bucketPrefix = `${bucket}/`;
  return prefix.startsWith(bucketPrefix)
    ? prefix.slice(bucketPrefix.length)
    : prefix;
}

async function readText(
  storage: StorageReader,
  path: string,
): Promise<string | null> {
  return await storage.downloadText(articleBundleBucket, path);
}

async function readJsonRecord(
  storage: StorageReader,
  path: string,
  required = false,
): Promise<Record<string, unknown>> {
  const text = await readText(storage, path);
  if (!text) {
    if (required) throw new Error(`missing_bundle_file:${path}`);
    return {};
  }
  const value = JSON.parse(text) as unknown;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`invalid_json_object:${path}`);
}

async function readJsonArray(
  storage: StorageReader,
  path: string,
): Promise<unknown[]> {
  const text = await readText(storage, path);
  if (!text) return [];
  const value = JSON.parse(text) as unknown;
  if (Array.isArray(value)) return value;
  throw new Error(`invalid_json_array:${path}`);
}

async function readLinks(
  storage: StorageReader,
  path: string,
): Promise<unknown[]> {
  const value = await readJsonValue(storage, path);
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) throw new Error(`invalid_links_file:${path}`);
  return [
    ...arrayValue(value.links),
    ...arrayValue(value.miniPrograms),
  ];
}

async function readDiagnostics(
  storage: StorageReader,
  path: string,
): Promise<unknown[]> {
  const value = await readJsonValue(storage, path);
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) throw new Error(`invalid_diagnostics_file:${path}`);
  return [
    ...arrayValue(value.diagnostics),
    ...arrayValue(value.captureWarnings),
  ];
}

async function readJsonValue(
  storage: StorageReader,
  path: string,
): Promise<unknown | undefined> {
  const text = await readText(storage, path);
  if (!text) return undefined;
  return JSON.parse(text) as unknown;
}

function imageArrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqueImages(objectPrefix: string, values: unknown[]): BundleImage[] {
  const seen = new Set<string>();
  const images: BundleImage[] = [];
  for (const value of values) {
    if (!isRecord(value)) continue;
    const imageId = clean(value.imageId) ?? clean(value.id) ??
      clean(value.assetId);
    const storagePath = clean(value.storagePath) ??
      clean(value.localStoragePath) ??
      clean(value.path);
    if (!imageId || !storagePath || seen.has(imageId)) continue;
    seen.add(imageId);
    images.push({
      imageId,
      storagePath,
      bundleStoragePath: bundleStoragePath(objectPrefix, storagePath),
      hasBytes: value.hasBytes === true,
      sourceUrl: clean(value.sourceUrl),
      publicUrl: clean(value.publicUrl),
      contentType: clean(value.contentType),
      contentHash: clean(value.contentHash) ?? clean(value.byteHash),
      width: numberValue(value.width),
      height: numberValue(value.height),
      altText: clean(value.altText) ?? clean(value.alt),
      nearbyText: clean(value.nearbyText),
      roleHint: clean(value.roleHint),
    });
  }
  return images;
}

function bundleStoragePath(objectPrefix: string, storagePath: string): string {
  const path = storagePath.replace(/^\/+/, "");
  const bucketPrefix = `${articleBundleBucket}/`;
  const pathWithoutBucket = path.startsWith(bucketPrefix)
    ? path.slice(bucketPrefix.length)
    : path;
  if (pathWithoutBucket.startsWith(`${objectPrefix}/`)) {
    return pathWithoutBucket;
  }
  return `${objectPrefix}/${pathWithoutBucket}`;
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
