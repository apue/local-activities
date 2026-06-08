import { createClient } from "@supabase/supabase-js";

import {
  defaultArticleBundlesBucket,
  edgePayloadFromManifest,
} from "./bundle-files.mjs";

const defaultAnalyzeFunctionName = "analyze-article-bundle";

export function createSupabaseCaptureAdapter({
  client,
  bucket = defaultArticleBundlesBucket,
  analyzeFunctionName = defaultAnalyzeFunctionName,
  analyzeFunctionUrl,
  analyzeFunctionTimeoutMs = 180_000,
  collectorEdgeToken,
  collectorId,
  fetchImpl = fetch,
} = {}) {
  if (!client) throw new Error("supabase_client_required");

  return {
    async findExistingBundle({ sourceUrl, contentHash, mode = "production" }) {
      const { data, error } = await client
        .from("article_bundles")
        .select("bundle_id, storage_prefix, status")
        .eq("source_url", sourceUrl)
        .eq("content_hash", contentHash)
        .eq("mode", mode)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        bundleId: data.bundle_id,
        storagePrefix: data.storage_prefix,
        status: data.status,
      };
    },

    async uploadAndAnalyzeBundle({ files, manifest, storagePrefix }) {
      const token = clean(collectorEdgeToken);
      if (!token) throw new Error("collector_edge_token_required");
      const objectPrefix = storageObjectPrefix({ storagePrefix, bucket });
      for (const file of files) {
        const objectPath = `${objectPrefix}/${file.path}`;
        const { error } = await client.storage.from(bucket).upload(
          objectPath,
          file.body,
          {
            contentType: file.contentType,
            cacheControl: "3600",
            upsert: true,
          },
        );
        if (error) throw error;
      }

      const payload = edgePayloadFromManifest({ manifest, storagePrefix });
      const headers = removeUndefined({
        "x-collector-edge-token": token,
        "x-collector-id": clean(collectorId),
      });
      if (clean(analyzeFunctionUrl)) {
        await invokeExplicitFunctionUrl({
          url: analyzeFunctionUrl,
          payload,
          headers,
          timeoutMs: analyzeFunctionTimeoutMs,
          fetchImpl,
        });
      } else {
        const { error: invokeError } = await client.functions.invoke(
          analyzeFunctionName,
          {
            body: payload,
            headers,
          },
        );
        if (invokeError) throw invokeError;
      }
      return payload;
    },
  };
}

export function createSupabaseCaptureClientFromEnv({
  env = process.env,
  createClientImpl = createClient,
  fetchImpl,
} = {}) {
  const supabaseUrl =
    clean(env.NEXT_PUBLIC_SUPABASE_URL) ?? clean(env.SUPABASE_URL) ?? clean(env.SUPA_URL);
  const supabaseSecretKey =
    clean(env.SUPABASE_SECRET_KEY) ??
    clean(env.SUPABASE_SERVICE_ROLE_KEY) ??
    clean(env.SUPA_SERVICE_KEY);
  if (!supabaseUrl) throw new Error("missing_next_public_supabase_url");
  if (!supabaseSecretKey) throw new Error("missing_supabase_secret_key");
  const options = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
  if (fetchImpl) options.global = { fetch: fetchImpl };
  return createClientImpl(supabaseUrl, supabaseSecretKey, options);
}

function storageObjectPrefix({ storagePrefix, bucket }) {
  const prefix = String(storagePrefix ?? "");
  const bucketPrefix = `${bucket}/`;
  return prefix.startsWith(bucketPrefix) ? prefix.slice(bucketPrefix.length) : prefix;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

async function invokeExplicitFunctionUrl({
  url,
  payload,
  headers,
  timeoutMs,
  fetchImpl,
}) {
  const controller = new AbortController();
  let timeoutId;
  try {
    const response = await withTimeout(
      fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }),
      timeoutMs,
      () => controller.abort(),
      (id) => {
        timeoutId = id;
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `analyze_function_url_failed:${response.status}${text ? `:${text}` : ""}`,
      );
    }
  } catch (error) {
    if (
      controller.signal.aborted ||
      error?.message === `analyze_function_url_timeout:${timeoutMs}`
    ) {
      throw new Error(`analyze_function_url_timeout:${timeoutMs}`);
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function withTimeout(promise, timeoutMs, onTimeout, setTimerId) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      const id = setTimeout(() => {
        onTimeout();
        reject(new Error(`analyze_function_url_timeout:${timeoutMs}`));
      }, timeoutMs);
      setTimerId(id);
    }),
  ]);
}
