/// <reference lib="deno.ns" />

import { createClient } from "npm:@supabase/supabase-js@2";
import type {
  AnalyzeRequest,
  DatabaseWriter,
  ExtractedEvent,
} from "./types.ts";

const analysisClaimLeaseMs = 30 * 60 * 1000;

export function createSupabaseDatabaseWriter({
  url,
  serviceRoleKey,
}: {
  url: string;
  serviceRoleKey: string;
}): DatabaseWriter {
  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return {
    async insert(table, payload) {
      const { data, error } = await client.from(table).insert(payload).select();
      if (error) throw error;
      return data;
    },
    async upsert(table, payload, options) {
      const { data, error } = await client.from(table).upsert(payload, options)
        .select();
      if (error) throw error;
      return data;
    },
    async writeArticleBundle(payload, status) {
      if (status === "analysis_started") {
        const retry = await client.from("article_bundles")
          .update(payload)
          .eq("bundle_id", payload.bundle_id)
          .eq("status", "failed")
          .select("bundle_id");
        if (retry.error) throw retry.error;
        if (retry.data?.length) return "written";

        const staleCutoff = new Date(Date.now() - analysisClaimLeaseMs)
          .toISOString();
        const stale = await client.from("article_bundles")
          .update(payload)
          .eq("bundle_id", payload.bundle_id)
          .eq("status", "analysis_started")
          .lt("updated_at", staleCutoff)
          .select("bundle_id");
        if (stale.error) throw stale.error;
        if (stale.data?.length) return "written";

        const insert = await client.from("article_bundles").insert(payload)
          .select("bundle_id");
        if (!insert.error) return "written";
        if (insert.error.code !== "23505") throw insert.error;
        return await articleBundleSkipResult(client, String(payload.bundle_id));
      }

      const { data, error } = await client.from("article_bundles")
        .update(payload)
        .eq("bundle_id", payload.bundle_id)
        .neq("status", "processed")
        .select("bundle_id");
      if (error) throw error;
      if (data?.length) return "written";
      const skipped = await articleBundleSkipResult(
        client,
        String(payload.bundle_id),
      );
      if (skipped === "skipped_processed") return skipped;

      if (status === "processed") {
        const insert = await client.from("article_bundles").insert(payload)
          .select("bundle_id");
        if (!insert.error) return "written";
        if (insert.error.code !== "23505") throw insert.error;
      }
      return "skipped_existing";
    },
    async findCanonicalCandidates(
      event: ExtractedEvent,
      request: AnalyzeRequest,
    ) {
      const bySource = await client.from("canonical_events")
        .select("event_id,title,starts_at,source_url")
        .eq("source_url", request.sourceUrl)
        .limit(5);
      if (bySource.error) throw bySource.error;
      if (bySource.data?.length) return bySource.data;
      if (!event.startsAt) return [];
      const byTitle = await client.from("canonical_events")
        .select("event_id,title,starts_at,source_url")
        .eq("title", event.title)
        .eq("starts_at", event.startsAt)
        .limit(5);
      if (byTitle.error) throw byTitle.error;
      return byTitle.data ?? [];
    },
    async findArticleBundle(bundleId, mode) {
      const { data, error } = await client.from("article_bundles")
        .select("status")
        .eq("bundle_id", bundleId)
        .eq("mode", mode)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}

export function createSupabaseStorageReader({
  url,
  serviceRoleKey,
}: {
  url: string;
  serviceRoleKey: string;
}) {
  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return {
    async downloadText(bucket: string, path: string): Promise<string | null> {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) {
        if ("statusCode" in error && String(error.statusCode) === "404") {
          return null;
        }
        throw error;
      }
      return await data.text();
    },
    async downloadBytes(
      bucket: string,
      path: string,
    ): Promise<Uint8Array | null> {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) {
        if ("statusCode" in error && String(error.statusCode) === "404") {
          return null;
        }
        throw error;
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async uploadBytes(
      bucket: string,
      path: string,
      body: Uint8Array,
      options?: { contentType?: string; upsert?: boolean },
    ): Promise<void> {
      const { error } = await client.storage.from(bucket).upload(path, body, {
        contentType: options?.contentType,
        upsert: options?.upsert ?? true,
      });
      if (error) throw error;
    },
    async createSignedUrl(
      bucket: string,
      path: string,
      expiresInSeconds: number,
    ): Promise<string | null> {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(
        path,
        expiresInSeconds,
      );
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
    async createPublicUrl(bucket: string, path: string): Promise<string> {
      const { data } = client.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    },
  };
}

async function articleBundleSkipResult(
  client: { from(table: string): any },
  bundleId: string,
) {
  const { data, error } = await client.from("article_bundles")
    .select("status")
    .eq("bundle_id", bundleId)
    .maybeSingle();
  if (error) throw error;
  const status = (data as { status?: string } | null)?.status;
  return status === "processed"
    ? "skipped_processed" as const
    : "skipped_existing" as const;
}
