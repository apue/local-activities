import { describe, expect, it } from "vitest";

import {
  createCaptureWorkerRuntime,
  createIdempotencyAdapterForArgs,
  parseArgs,
} from "./capture-worker.mjs";

describe("capture worker CLI", () => {
  it("ignores the pnpm argument separator", () => {
    expect(
      parseArgs([
        "--",
        "--dry-run",
        "--mode",
        "eval",
        "--env-file",
        ".env.collector",
        "--limit",
        "3",
        "--proxy-url",
        "http://127.0.0.1:7897",
      ]),
    ).toEqual({
      dryRun: true,
      mode: "eval",
      envFiles: [".env.collector"],
      limit: 3,
      proxyUrl: "http://127.0.0.1:7897",
      help: false,
    });
  });

  it("rejects invalid capture limits", () => {
    expect(() => parseArgs(["--limit", "0"])).toThrow("invalid_limit:0");
    expect(() => parseArgs(["--limit", "1.5"])).toThrow("invalid_limit:1.5");
    expect(() => parseArgs(["--limit", "all"])).toThrow("invalid_limit:all");
  });

  it("uses Supabase read-only idempotency in dry-run when Supabase env is configured", () => {
    const created = [];
    const supabase = { findExistingBundle: async () => null };
    const adapter = createIdempotencyAdapterForArgs({
      dryRun: true,
      env: {
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_value",
      },
      createSupabaseClientImpl: (...args) => {
        created.push(args);
        return { client: true };
      },
      createSupabaseAdapterImpl: ({ client }) => {
        expect(client).toEqual({ client: true });
        return supabase;
      },
    });

    expect(adapter).toBe(supabase);
    expect(created).toHaveLength(1);
    expect(created[0][0]).toMatchObject({ fetchImpl: undefined });
  });

  it("passes proxy fetch to Supabase dry-run idempotency when requested", () => {
    const created = [];
    const adapter = createIdempotencyAdapterForArgs({
      dryRun: true,
      proxyUrl: "http://127.0.0.1:7897",
      env: {
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_value",
      },
      createSupabaseClientImpl: (...args) => {
        created.push(args);
        return { client: true };
      },
      createSupabaseAdapterImpl: ({ client }) => ({
        client,
        findExistingBundle: async () => null,
      }),
    });

    expect(adapter.client).toEqual({ client: true });
    expect(typeof created[0][0].fetchImpl).toBe("function");
  });

  it("creates one proxy fetch and wires it through the worker runtime", () => {
    const fetchImpl = async () => new Response("{}");
    const createdProxyUrls = [];
    const clientCalls = [];
    const adapterCalls = [];
    const runtime = createCaptureWorkerRuntime({
      args: {
        dryRun: false,
        proxyUrl: "http://127.0.0.1:7897",
      },
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_value",
        COLLECTOR_EDGE_TOKEN: "collector-edge-secret",
        COLLECTOR_ID: "collector-local",
        ANALYZE_FUNCTION_URL: "http://127.0.0.1:8000/",
      },
      createProxyFetchImpl: (proxyUrl) => {
        createdProxyUrls.push(proxyUrl);
        return fetchImpl;
      },
      createSupabaseClientImpl: (options) => {
        clientCalls.push(options);
        return { client: true };
      },
      createSupabaseAdapterImpl: (options) => {
        adapterCalls.push(options);
        return { adapter: true };
      },
    });

    expect(createdProxyUrls).toEqual(["http://127.0.0.1:7897"]);
    expect(runtime.fetchImpl).toBe(fetchImpl);
    expect(runtime.supabase).toEqual({ adapter: true });
    expect(runtime.idempotency).toEqual({ adapter: true });
    expect(clientCalls[0]).toMatchObject({ fetchImpl });
    expect(adapterCalls[0]).toMatchObject({
      client: { client: true },
      analyzeFunctionUrl: "http://127.0.0.1:8000/",
      collectorEdgeToken: "collector-edge-secret",
      collectorId: "collector-local",
    });
    expect(adapterCalls[0].fetchImpl).toBeUndefined();
  });

  it("uses proxy fetch for remote explicit analyze function URLs", () => {
    const fetchImpl = async () => new Response("{}");
    const adapterCalls = [];
    createCaptureWorkerRuntime({
      args: {
        dryRun: false,
        proxyUrl: "http://127.0.0.1:7897",
      },
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_value",
        COLLECTOR_EDGE_TOKEN: "collector-edge-secret",
        ANALYZE_FUNCTION_URL:
          "https://project.supabase.co/functions/v1/analyze-article-bundle",
      },
      createProxyFetchImpl: () => fetchImpl,
      createSupabaseClientImpl: () => ({ client: true }),
      createSupabaseAdapterImpl: (options) => {
        adapterCalls.push(options);
        return { adapter: true };
      },
    });

    expect(adapterCalls[0].fetchImpl).toBe(fetchImpl);
  });

  it("falls back to offline dry-run idempotency when Supabase env is absent", async () => {
    const adapter = createIdempotencyAdapterForArgs({
      dryRun: true,
      env: {},
      createSupabaseClientImpl: () => {
        throw new Error("supabase_should_not_be_created");
      },
    });

    await expect(adapter.findExistingBundle()).resolves.toBeNull();
  });
});
