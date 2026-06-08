import { describe, expect, it } from "vitest";

import {
  evaluateTarget,
  formatReport,
  parseEnvText,
  runCli,
  redactValue,
  targetNames,
} from "./env-inventory.mjs";

describe("env inventory", () => {
  it("parses dotenv-style values without exposing comments", () => {
    expect(
      parseEnvText(`
        # comment
        NEXT_PUBLIC_APP_URL=http://localhost:3000
        ADMIN_ACCESS_TOKEN="admin-secret"
        EMPTY_VALUE=
      `),
    ).toEqual({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ADMIN_ACCESS_TOKEN: "admin-secret",
      EMPTY_VALUE: "",
    });
  });

  it("reports missing and placeholder variables by target", () => {
    const result = evaluateTarget("collector", {
      APP_BASE_URL: "https://activities.example",
      COLLECTOR_EDGE_TOKEN: "replace-with-random-collector-edge-token",
      COLLECTOR_ID: "home-192-168-0-16",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_value",
      COLLECTOR_INTERVAL_HOURS: "4",
      WECHAT2RSS_BASE_URL: "http://127.0.0.1:4000",
      WECHAT2RSS_TOKEN: "wechat2rss-token",
    });

    expect(result.present).toContain("WECHAT2RSS_TOKEN");
    expect(result.placeholders).toContain("COLLECTOR_EDGE_TOKEN");
    expect(result.missing).not.toContain("COLLECTOR_EDGE_TOKEN");
    expect(result.ok).toBe(false);
  });

  it("does not require bucket env vars when the capture worker uses defaults", () => {
    const result = evaluateTarget("collector", {
      COLLECTOR_ID: "home-192-168-0-16",
      COLLECTOR_EDGE_TOKEN: "collector-edge-token",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_value",
      COLLECTOR_INTERVAL_HOURS: "4",
      WECHAT2RSS_BASE_URL: "http://127.0.0.1:4000",
      WECHAT2RSS_TOKEN: "wechat2rss-token",
    });

    expect(result.missing).not.toContain("ARTICLE_BUNDLES_BUCKET");
    expect(result.optional).toContain("ARTICLE_BUNDLES_BUCKET");
    expect(result.ok).toBe(true);
  });

  it("merges multiple dotenv files in CLI order", () => {
    const output = [];
    const exitCode = runCli(
      [
        "--env-file",
        ".env.base",
        "--env-file",
        ".env.collector",
        "--target",
        "collector",
      ],
      {},
      {
        loadEnvFileImpl: (path) =>
          path === ".env.base"
            ? {
                SUPABASE_URL: "https://project.supabase.co",
                SUPABASE_SECRET_KEY: "sb_secret_value",
                COLLECTOR_EDGE_TOKEN: "collector-edge-token",
              }
            : {
                COLLECTOR_ID: "collector-local",
                COLLECTOR_INTERVAL_HOURS: "4",
                WECHAT2RSS_BASE_URL: "http://127.0.0.1:4000",
                WECHAT2RSS_TOKEN: "wechat2rss-token",
              },
        log: (value) => output.push(value),
      },
    );

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("OK collector");
  });

  it("treats localhost public URLs as placeholders for deployable targets", () => {
    const vercelResult = evaluateTarget("vercel", {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ADMIN_ACCESS_TOKEN: "admin-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_value",
      SUPABASE_SECRET_KEY: "sb_secret_value",
    });
    const localResult = evaluateTarget("local-app", {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ADMIN_ACCESS_TOKEN: "admin-secret",
      COLLECTOR_EDGE_TOKEN: "collector-edge-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_value",
      SUPABASE_SECRET_KEY: "sb_secret_value",
    });

    expect(vercelResult.placeholders).toContain("NEXT_PUBLIC_APP_URL");
    expect(localResult.present).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("does not require map provider keys before map features are implemented", () => {
    const result = evaluateTarget("vercel", {
      NEXT_PUBLIC_APP_URL: "https://local-activities.vercel.app",
      ADMIN_ACCESS_TOKEN: "admin-secret",
      INTERNAL_API_SECRET: "internal-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_value",
      SUPABASE_SECRET_KEY: "sb_secret_value",
      DATABASE_URL: "postgresql://postgres:real@db.project.supabase.co/postgres",
      CRON_SECRET: "cron-secret",
      OBSERVABILITY_PROVIDER: "vercel",
      VERCEL_WEB_ANALYTICS_ENABLED: "true",
      VERCEL_SPEED_INSIGHTS_ENABLED: "true",
    });

    expect(result.ok).toBe(true);
    expect(result.required).not.toContain("NEXT_PUBLIC_AMAP_JS_API_KEY");
    expect(result.required).not.toContain("AMAP_WEB_SERVICE_API_KEY");
    expect(result.optional).toContain("NEXT_PUBLIC_AMAP_JS_API_KEY");
    expect(result.optional).toContain("AMAP_WEB_SERVICE_API_KEY");
  });

  it("formats reports with variable names but without secret values", () => {
    const result = evaluateTarget("local-app", {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ADMIN_ACCESS_TOKEN: "admin-secret-value",
      COLLECTOR_EDGE_TOKEN: "collector-secret-value",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_value",
      SUPABASE_SECRET_KEY: "sb_secret_value",
    });

    const output = formatReport([result]);

    expect(output).toContain("local-app");
    expect(output).toContain("ADMIN_ACCESS_TOKEN");
    expect(output).not.toContain("admin-secret-value");
    expect(output).not.toContain("collector-secret-value");
    expect(output).not.toContain("sb_secret_value");
  });

  it("redacts all concrete values", () => {
    expect(redactValue("visible")).toBe("[set]");
    expect(redactValue("")).toBe("[missing]");
    expect(redactValue(undefined)).toBe("[missing]");
  });

  it("exposes stable target names for documentation and CLI help", () => {
    expect(targetNames).toEqual([
      "local-app",
      "vercel",
      "collector",
      "supabase-functions",
    ]);
  });
});
