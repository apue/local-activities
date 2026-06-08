import { describe, expect, it } from "vitest";

import { checkAppHealth } from "./app-health";

describe("checkAppHealth", () => {
  it("reports build metadata and required environment status without secret values", () => {
    const result = checkAppHealth({
      NEXT_PUBLIC_APP_URL: "https://local-activities.example",
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
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: "abc123",
      VERCEL_GIT_COMMIT_REF: "main",
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      service: "local-activities",
      environment: "production",
      git: {
        commitSha: "abc123",
        commitRef: "main",
      },
      env: {
        configured: expect.arrayContaining([
          "ADMIN_ACCESS_TOKEN",
          "INTERNAL_API_SECRET",
          "NEXT_PUBLIC_SUPABASE_URL",
        ]),
        missing: [],
        placeholders: [],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("admin-secret");
    expect(serialized).not.toContain("sb_secret_value");
  });

  it("returns a 500 status with variable names for missing and placeholder deploy config", () => {
    const result = checkAppHealth({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
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

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      env: {
        missing: [],
        placeholders: ["NEXT_PUBLIC_APP_URL"],
      },
    });
  });
});
