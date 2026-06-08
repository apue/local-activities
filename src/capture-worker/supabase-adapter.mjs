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
  collectorEdgeToken,
  collectorId,
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
      const { error: invokeError } = await client.functions.invoke(
        analyzeFunctionName,
        {
          body: payload,
          headers: removeUndefined({
            "x-collector-edge-token": token,
            "x-collector-id": clean(collectorId),
          }),
        },
      );
      if (invokeError) throw invokeError;
      return payload;
    },
  };
}

export function createSupabaseCaptureClientFromEnv({
  env = process.env,
  createClientImpl = createClient,
} = {}) {
  const supabaseUrl =
    clean(env.NEXT_PUBLIC_SUPABASE_URL) ?? clean(env.SUPABASE_URL) ?? clean(env.SUPA_URL);
  const supabaseSecretKey =
    clean(env.SUPABASE_SECRET_KEY) ??
    clean(env.SUPABASE_SERVICE_ROLE_KEY) ??
    clean(env.SUPA_SERVICE_KEY);
  if (!supabaseUrl) throw new Error("missing_next_public_supabase_url");
  if (!supabaseSecretKey) throw new Error("missing_supabase_secret_key");
  return createClientImpl(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
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
