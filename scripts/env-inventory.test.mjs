import { describe, expect, it } from "vitest";

import {
  evaluateTarget,
  formatReport,
  parseEnvText,
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
      COLLECTOR_BASE_URL: "https://activities.example",
      COLLECTOR_API_KEY: "replace-with-random-collector-api-key",
      COLLECTOR_ID: "home-192-168-0-16",
      COLLECTOR_INTERVAL_HOURS: "4",
      COLLECTOR_BROWSER_PROFILE_DIR: ".collector-profile",
      TEXT_INFERENCE_PROVIDER: "openai-compatible",
      TEXT_INFERENCE_API_BASE_URL: "https://agent.example/v1",
      TEXT_INFERENCE_API_KEY: "sk-real-secret",
      TEXT_INFERENCE_MODEL: "gpt-4.1-mini",
      TEXT_INFERENCE_ENDPOINT_STYLE: "responses",
    });

    expect(result.present).toContain("TEXT_INFERENCE_API_KEY");
    expect(result.placeholders).toContain("COLLECTOR_API_KEY");
    expect(result.missing).not.toContain("COLLECTOR_API_KEY");
    expect(result.ok).toBe(false);
  });

  it("treats localhost public URLs as placeholders for deployable targets", () => {
    const vercelResult = evaluateTarget("vercel", {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ADMIN_ACCESS_TOKEN: "admin-secret",
      COLLECTOR_API_KEY: "collector-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_value",
      SUPABASE_SECRET_KEY: "sb_secret_value",
    });
    const localResult = evaluateTarget("local-app", {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ADMIN_ACCESS_TOKEN: "admin-secret",
      COLLECTOR_API_KEY: "collector-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_value",
      SUPABASE_SECRET_KEY: "sb_secret_value",
    });

    expect(vercelResult.placeholders).toContain("NEXT_PUBLIC_APP_URL");
    expect(localResult.present).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("formats reports with variable names but without secret values", () => {
    const result = evaluateTarget("local-app", {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ADMIN_ACCESS_TOKEN: "admin-secret-value",
      COLLECTOR_API_KEY: "collector-secret-value",
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
    expect(targetNames).toEqual(["local-app", "vercel", "collector"]);
  });
});
