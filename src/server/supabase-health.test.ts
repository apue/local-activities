import { describe, expect, it, vi } from "vitest";

import { checkSupabaseHealth } from "./supabase-health";

describe("checkSupabaseHealth", () => {
  it("reports missing Supabase environment without calling fetch", async () => {
    const fetcher = vi.fn();

    const result = await checkSupabaseHealth(
      {
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: "missing_supabase_env",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses Supabase publishable credentials for a read-only health request", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const result = await checkSupabaseHealth(
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/settings",
      {
        cache: "no-store",
        headers: {
          apikey: "sb_publishable_example",
          authorization: "Bearer sb_publishable_example",
        },
        signal: expect.any(AbortSignal),
      },
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      supabaseHost: "example.supabase.co",
    });
  });

  it("sanitizes Supabase failures", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const result = await checkSupabaseHealth(
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "bad-publishable-key",
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "supabase_request_failed",
      supabaseStatus: 401,
      supabaseHost: "example.supabase.co",
    });
  });

  it("sanitizes Supabase request errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network timeout"));

    const result = await checkSupabaseHealth(
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "supabase_request_error",
      supabaseHost: "example.supabase.co",
    });
  });
});
