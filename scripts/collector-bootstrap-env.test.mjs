import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateTarget, parseEnvText } from "./env-inventory.mjs";
import {
  buildCollectorBootstrapEnv,
  formatCollectorBootstrapEnv,
  runCollectorBootstrapEnvCli,
} from "./collector-bootstrap-env.mjs";

describe("collector bootstrap env generator", () => {
  it("builds a collector-only environment for the 192.168.0.16 machine", () => {
    const env = buildCollectorBootstrapEnv({
      sourceEnv: {
        NEXT_PUBLIC_APP_URL: "https://local-activities.vercel.app",
        COLLECTOR_API_KEY: "collector-token",
        ADMIN_ACCESS_TOKEN: "admin-secret",
        SUPABASE_SECRET_KEY: "supabase-secret",
        DATABASE_URL: "postgres://secret",
        VERCEL_TOKEN: "vercel-secret",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        OPENAI_MODEL: "gpt-5-mini",
      },
      collectorHost: "192.168.0.16",
    });

    expect(env).toMatchObject({
      APP_BASE_URL: "https://local-activities.vercel.app",
      COLLECTOR_BASE_URL: "https://local-activities.vercel.app",
      COLLECTOR_API_KEY: "collector-token",
      COLLECTOR_ID: "home-192-168-0-16",
      LOCAL_COLLECTOR_PROCESSOR: "agent",
      COLLECTOR_CAPABILITIES: "agent_api",
      AGENT_PROVIDER: "openai",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_API_KEY: "replace-with-openai-api-key",
      OPENAI_MODEL: "gpt-5-mini",
      AGENT_TIMEOUT_SECONDS: "120",
      AGENT_MAX_ATTEMPTS: "3",
    });

    expect(Object.keys(env)).not.toEqual(
      expect.arrayContaining([
        "ADMIN_ACCESS_TOKEN",
        "SUPABASE_SECRET_KEY",
        "DATABASE_URL",
        "VERCEL_TOKEN",
      ]),
    );
  });

  it("formats stable dotenv output that can be checked by env inventory", () => {
    const text = formatCollectorBootstrapEnv(
      buildCollectorBootstrapEnv({
        sourceEnv: {
          APP_BASE_URL: "https://local-activities.vercel.app",
          COLLECTOR_API_KEY: "collector-token",
          OPENAI_BASE_URL: "https://api.openai.com/v1",
          OPENAI_API_KEY: "openai-secret",
          OPENAI_MODEL: "gpt-5-mini",
        },
        collectorHost: "192.168.0.16",
      }),
    );

    expect(text).toContain("# Local Activities collector machine environment");
    expect(text).toContain("COLLECTOR_ID=home-192-168-0-16");
    expect(text).not.toContain("ADMIN_ACCESS_TOKEN");
    expect(text.endsWith("\n")).toBe(true);

    const parsed = parseEnvText(text);
    expect(evaluateTarget("collector", parsed)).toMatchObject({ ok: true });
  });

  it("copies provider runtime settings and defaults missing OpenAI fields", () => {
    const env = buildCollectorBootstrapEnv({
      sourceEnv: {
        NEXT_PUBLIC_APP_URL: "https://local-activities.vercel.app",
        COLLECTOR_API_KEY: "collector-token",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        OPENAI_API_KEY: "openai-secret",
        AGENT_TIMEOUT_SECONDS: "90",
        AGENT_MAX_ATTEMPTS: "4",
      },
      collectorHost: "192.168.0.16",
    });

    expect(env).toMatchObject({
      AGENT_PROVIDER: "openai",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_MODEL: "replace-with-openai-model",
      AGENT_TIMEOUT_SECONDS: "90",
      AGENT_MAX_ATTEMPTS: "4",
    });
    expect(evaluateTarget("collector", env)).toMatchObject({
      ok: false,
      placeholders: ["OPENAI_MODEL"],
    });
  });

  it("falls back to NEXT_PUBLIC_APP_URL when collector base URLs are placeholders", () => {
    const env = buildCollectorBootstrapEnv({
      sourceEnv: {
        APP_BASE_URL: "https://your-vercel-app.example",
        COLLECTOR_BASE_URL: "https://your-vercel-app.example",
        NEXT_PUBLIC_APP_URL: "https://local-activities.vercel.app",
        COLLECTOR_API_KEY: "collector-token",
      },
      collectorHost: "192.168.0.16",
    });

    expect(env.APP_BASE_URL).toBe("https://local-activities.vercel.app");
    expect(env.COLLECTOR_BASE_URL).toBe("https://local-activities.vercel.app");
  });

  it("defaults to agent mode even when the source env was set to fixture", () => {
    const env = buildCollectorBootstrapEnv({
      sourceEnv: {
        NEXT_PUBLIC_APP_URL: "https://local-activities.vercel.app",
        COLLECTOR_API_KEY: "collector-token",
        LOCAL_COLLECTOR_PROCESSOR: "fixture",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        OPENAI_API_KEY: "openai-secret",
      },
      collectorHost: "192.168.0.16",
    });

    expect(env.LOCAL_COLLECTOR_PROCESSOR).toBe("agent");
  });

  it("writes a chmod 600 collector env file through the CLI", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "collector-bootstrap-"));
    const output = path.join(dir, ".env.collector");

    try {
      const code = await runCollectorBootstrapEnvCli(
        [
          "--collector-host",
          "192.168.0.16",
          "--output",
          output,
        ],
        {
          NEXT_PUBLIC_APP_URL: "https://local-activities.vercel.app",
          COLLECTOR_API_KEY: "collector-token",
          OPENAI_BASE_URL: "https://api.openai.com/v1",
          OPENAI_API_KEY: "openai-secret",
          OPENAI_MODEL: "gpt-5-mini",
        },
      );

      expect(code).toBe(0);
      const text = await readFile(output, "utf8");
      expect(parseEnvText(text)).toMatchObject({
        COLLECTOR_ID: "home-192-168-0-16",
        LOCAL_COLLECTOR_PROCESSOR: "agent",
      });
      expect((await stat(output)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lets current environment override placeholder values from the source file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "collector-bootstrap-"));
    const source = path.join(dir, ".env.local");
    const output = path.join(dir, ".env.collector");

    try {
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(
          source,
          [
            "NEXT_PUBLIC_APP_URL=https://local-activities.vercel.app",
            "COLLECTOR_API_KEY=collector-token",
            "OPENAI_API_KEY=replace-with-openai-api-key",
            "",
          ].join("\n"),
        ),
      );

      const code = await runCollectorBootstrapEnvCli(
        ["--env-file", source, "--output", output],
        {
          OPENAI_API_KEY: "openai-secret",
          OPENAI_BASE_URL: "https://api.openai.com/v1",
        },
      );

      expect(code).toBe(0);
      expect(parseEnvText(await readFile(output, "utf8"))).toMatchObject({
        OPENAI_API_KEY: "openai-secret",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
