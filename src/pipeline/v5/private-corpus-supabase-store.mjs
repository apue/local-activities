import { createCapturedArticleBundle } from "../../capture/article-bundle.mjs";

const articleBundlesBucket = "article-bundles";

export function createSupabasePrivateCorpusStore({ client } = {}) {
  if (!client) throw new Error("private_corpus_supabase_client_required");
  return {
    async getFeedbackById(feedbackId) {
      const { data, error } = await client
        .from("admin_feedback_ledger")
        .select("*")
        .eq("feedback_id", feedbackId)
        .maybeSingle();
      if (error) throw error;
      return data ? toFeedbackRecord(data) : null;
    },

    async getPipelineRunById(runId) {
      const { data, error } = await client
        .from("pipeline_runs")
        .select("*")
        .eq("run_id", runId)
        .maybeSingle();
      if (error) throw error;
      return data ? toPipelineRunRecord(data) : null;
    },

    async getArticleBundleById(bundleId) {
      const { data, error } = await client
        .from("article_bundles")
        .select("*")
        .eq("bundle_id", bundleId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        bundleId: data.bundle_id,
        dataClass: data.data_class,
        sourceMetadata: {
          sourceId: data.source_id ?? undefined,
          sourceName: data.source_name ?? undefined,
          sourceUrl: data.source_url,
          publishedAt: data.published_at ?? undefined,
        },
        capturedBundle: await readCapturedBundleFromStorage({ client, row: data }),
      };
    },
  };
}

async function readCapturedBundleFromStorage({ client, row }) {
  const bucket = row.storage_bucket ?? articleBundlesBucket;
  const prefix = stripBucketPrefix(row.storage_prefix, bucket);
  const manifest = await readJsonObject(client, bucket, `${prefix}/manifest.json`, true);
  const html = await readText(client, bucket, `${prefix}/article.html`) ?? "";
  const text = await readText(client, bucket, `${prefix}/article.txt`) ?? "";
  const linksFile = await readJsonObject(client, bucket, `${prefix}/links.json`, false);
  const diagnosticsFile = await readJsonObject(client, bucket, `${prefix}/diagnostics.json`, false);
  const images = await Promise.all(
    arrayValue(manifest.images).map((image, index) =>
      toCapturedImage({ client, bucket, prefix, image, index }),
    ),
  );

  return createCapturedArticleBundle({
    captureId: manifest.captureId ?? row.bundle_id,
    sourceId: manifest.sourceId ?? row.source_id,
    sourceName: manifest.sourceName ?? row.source_name,
    provider: manifest.sourceProvider ?? row.source_provider ?? "wechat2rss",
    sourceUrl: manifest.sourceUrl ?? row.source_url,
    canonicalUrl: manifest.canonicalUrl ?? row.canonical_url ?? row.source_url,
    finalUrl: manifest.finalUrl ?? row.canonical_url ?? row.source_url,
    title: manifest.title,
    authorName: manifest.authorName,
    publishedAt: manifest.publishedAt ?? row.published_at,
    capturedAt: manifest.capturedAt ?? row.captured_at,
    languageHints: arrayValue(manifest.languageHints),
    captureMode: manifest.captureMode,
    text,
    html,
    images,
    links: arrayValue(linksFile.links),
    miniPrograms: arrayValue(linksFile.miniPrograms),
    diagnostics: arrayValue(diagnosticsFile.diagnostics),
    captureWarnings: arrayValue(diagnosticsFile.captureWarnings),
    contentHash: manifest.contentHash ?? row.content_hash,
  });
}

async function toCapturedImage({ client, bucket, prefix, image, index }) {
  const imageId = clean(image.id) ?? clean(image.imageId) ?? `image-${index + 1}`;
  const relativePath = clean(image.path) ?? clean(image.storagePath);
  const storagePath = relativePath
    ? joinStoragePath(prefix, stripBucketPrefix(relativePath, bucket))
    : undefined;
  const hasBytes = image.hasBytes === true && storagePath;
  const body = hasBytes
    ? await readRequiredImageBytes(client, bucket, storagePath)
    : undefined;
  return {
    id: imageId,
    path: relativePath,
    sourceUrl: clean(image.sourceUrl),
    storagePath,
    role: clean(image.role) ?? clean(image.roleHint),
    width: numberValue(image.width),
    height: numberValue(image.height),
    contentType: clean(image.contentType),
    body,
    contentHash: clean(image.contentHash),
    alt: clean(image.alt) ?? clean(image.altText),
    textContent: clean(image.nearbyText),
  };
}

async function readRequiredImageBytes(client, bucket, storagePath) {
  try {
    return await readBytes(client, bucket, storagePath);
  } catch (error) {
    if (String(error?.statusCode ?? "") === "404") {
      throw new Error(`private_corpus_bundle_image_missing:${storagePath}`);
    }
    throw error;
  }
}

async function readText(client, bucket, objectPath) {
  const { data, error } = await client.storage.from(bucket).download(objectPath);
  if (error) {
    if (String(error.statusCode ?? "") === "404") return null;
    throw error;
  }
  return await data.text();
}

async function readBytes(client, bucket, objectPath) {
  const { data, error } = await client.storage.from(bucket).download(objectPath);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

async function readJsonObject(client, bucket, objectPath, required) {
  const text = await readText(client, bucket, objectPath);
  if (!text) {
    if (required) throw new Error(`private_corpus_bundle_file_missing:${objectPath}`);
    return {};
  }
  const value = JSON.parse(text);
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  throw new Error(`private_corpus_bundle_json_invalid:${objectPath}`);
}

function toFeedbackRecord(row) {
  return {
    id: row.feedback_id,
    dataClass: row.data_class,
    feedbackType: row.feedback_type,
    pipelineRunId: row.pipeline_run_id ?? undefined,
    articleBundleId: row.article_bundle_id ?? undefined,
    draftId: row.draft_id ?? undefined,
    eventId: row.event_id ?? undefined,
    fieldName: row.field_name ?? undefined,
    oldValue: row.old_value ?? undefined,
    correctedValue: row.corrected_value ?? undefined,
    reason: row.reason ?? undefined,
    createdBy: row.created_by,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPipelineRunRecord(row) {
  return {
    runId: row.run_id,
    dataClass: row.data_class,
    sourceKind: row.source_kind ?? undefined,
    sourceId: row.source_id ?? undefined,
    articleBundleId: row.article_bundle_id ?? undefined,
    status: row.status,
    decision: row.decision ?? undefined,
    reason: row.reason ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    metadata: row.metadata ?? {},
  };
}

function stripBucketPrefix(value, bucket) {
  const text = String(value ?? "").replace(/^\/+|\/+$/g, "");
  const prefix = `${bucket}/`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function joinStoragePath(prefix, relativePath) {
  const cleanPrefix = String(prefix ?? "").replace(/^\/+|\/+$/g, "");
  const cleanRelativePath = String(relativePath ?? "").replace(/^\/+/, "");
  return cleanRelativePath.startsWith(`${cleanPrefix}/`)
    ? cleanRelativePath
    : `${cleanPrefix}/${cleanRelativePath}`;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
