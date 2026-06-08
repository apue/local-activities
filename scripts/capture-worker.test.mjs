import { describe, expect, it } from "vitest";

import {
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
      ]),
    ).toEqual({
      dryRun: true,
      mode: "eval",
      envFiles: [".env.collector"],
      help: false,
    });
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
