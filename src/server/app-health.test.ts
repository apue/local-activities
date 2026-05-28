import { describe, expect, it } from "vitest";

import { checkAppHealth } from "./app-health";

describe("checkAppHealth", () => {
  it("reports build metadata and required environment status without secret values", () => {
    const result = checkAppHealth({
      NEXT_PUBLIC_APP_URL: "https://local-activities.example",
      ADMIN_ACCESS_TOKEN: "admin-secret",
      COLLECTOR_API_KEY: "collector-secret",
      COLLECTOR_SCOPED_TOKEN_SECRET: "scoped-secret",
      INTERNAL_API_SECRET: "internal-secret",
      AGENT_API_BASE_URL: "https://agent.example/v1",
      AGENT_API_KEY: "agent-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_value",
      SUPABASE_SECRET_KEY: "sb_secret_value",
      DATABASE_URL: "postgresql://postgres:real@db.project.supabase.co/postgres",
      CRON_SECRET: "cron-secret",
      OBSERVABILITY_PROVIDER: "vercel",
      VERCEL_WEB_ANALYTICS_ENABLED: "true",
      VERCEL_SPEED_INSIGHTS_ENABLED: "true",
      VERCEL_SANDBOX_ENABLED: "true",
      VERCEL_SANDBOX_API_KEY: "sandbox-secret",
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
          "AGENT_API_KEY",
          "VERCEL_SANDBOX_API_KEY",
        ]),
        missing: [],
        placeholders: [],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("admin-secret");
    expect(serialized).not.toContain("collector-secret");
    expect(serialized).not.toContain("agent-secret");
    expect(serialized).not.toContain("sandbox-secret");
    expect(serialized).not.toContain("sb_secret_value");
  });

  it("returns a 500 status with variable names for missing and placeholder deploy config", () => {
    const result = checkAppHealth({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ADMIN_ACCESS_TOKEN: "admin-secret",
      COLLECTOR_API_KEY: "collector-secret",
      COLLECTOR_SCOPED_TOKEN_SECRET: "scoped-secret",
      INTERNAL_API_SECRET: "internal-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_value",
      SUPABASE_SECRET_KEY: "sb_secret_value",
      DATABASE_URL: "postgresql://postgres:real@db.project.supabase.co/postgres",
      CRON_SECRET: "cron-secret",
      OBSERVABILITY_PROVIDER: "vercel",
      VERCEL_WEB_ANALYTICS_ENABLED: "true",
      VERCEL_SPEED_INSIGHTS_ENABLED: "true",
      VERCEL_SANDBOX_ENABLED: "true",
      VERCEL_SANDBOX_API_KEY: "replace-with-vercel-sandbox-api-key",
    });

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      env: {
        missing: ["AGENT_API_BASE_URL", "AGENT_API_KEY"],
        placeholders: [
          "NEXT_PUBLIC_APP_URL",
          "VERCEL_SANDBOX_API_KEY",
        ],
      },
    });
  });
});
