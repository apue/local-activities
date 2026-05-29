import { describe, expect, it } from "vitest";

import type { CollectorJobRecord } from "./collector-job-service";
import { createVercelSandboxJobStarter } from "./vercel-sandbox-live-runner";
import type { VercelSandboxClient } from "./vercel-sandbox-runner";

const job: CollectorJobRecord = {
  id: 1,
  jobId: "job-1",
  seedUrl: "https://mp.weixin.qq.com/s/example",
  state: "queued",
  requestedAt: "2026-05-28T08:00:00.000Z",
  attemptNumber: 0,
  preferredRunner: "vercel_sandbox",
  runnerState: "sandbox_pending",
  fallbackEligible: false,
};

describe("vercel sandbox live runner", () => {
  it("starts Sandbox jobs with scoped ingest credentials and current git ref", async () => {
    const calls: unknown[] = [];
    const sandboxClient: VercelSandboxClient = {
      async create(input) {
        calls.push({ kind: "create", input });
        return {
          sandboxId: "sb_123",
          async runCommand(params) {
            calls.push({ kind: "runCommand", params });
            return { cmdId: "cmd_123" };
          },
        };
      },
    };
    const collectorJobStore = {
      async updateSandboxStarted(input: {
        jobId: string;
        sandboxRunId: string;
        startedAt: string;
        collectorId: string;
        localRunId: string;
        leaseExpiresAt: string;
      }) {
        calls.push({ kind: "updateSandboxStarted", input });
        return {
          ...job,
          state: "running" as const,
          actualRunner: "vercel_sandbox" as const,
          runnerState: "sandbox_running" as const,
          sandboxRunId: input.sandboxRunId,
        };
      },
    };

    const start = createVercelSandboxJobStarter({
      env: {
        VERCEL_SANDBOX_ENABLED: "true",
        NEXT_PUBLIC_APP_URL: "https://local-activities.example",
        COLLECTOR_SCOPED_TOKEN_SECRET: "scoped-secret",
        AGENT_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-secret",
        OPENAI_MODEL: "gpt-5-mini",
        COLLECTOR_BROWSER_RUNNER: "agent_browser",
        VERCEL_GIT_COMMIT_SHA: "abc123",
        VERCEL_GIT_REPO_OWNER: "apue",
        VERCEL_GIT_REPO_SLUG: "local-activities",
        COLLECTOR_API_KEY: "long-lived-collector-secret",
      },
      collectorJobStore,
      sandboxClient,
      now: new Date("2026-05-28T08:00:00.000Z"),
    });

    await expect(start(job)).resolves.toEqual({
      status: "started",
      sandboxId: "sb_123",
    });

    const run = calls.find((call) =>
      JSON.stringify(call).includes("runCommand"),
    );
    expect(JSON.stringify(run)).toContain("https://github.com/apue/local-activities.git");
    expect(JSON.stringify(run)).toContain("abc123");
    expect(JSON.stringify(run)).toContain("COLLECTOR_BROWSER_RUNNER");
    expect(JSON.stringify(run)).toContain("agent_browser");
    expect(JSON.stringify(run)).not.toContain("long-lived-collector-secret");
    expect(JSON.stringify(run)).not.toContain("admin-secret");
    expect(JSON.stringify(run)).not.toContain("AGENT_API_BASE_URL");
  });

  it("returns a structured failure when required Sandbox config is missing", async () => {
    const start = createVercelSandboxJobStarter({
      env: {
        VERCEL_SANDBOX_ENABLED: "true",
        NEXT_PUBLIC_APP_URL: "https://local-activities.example",
      },
      collectorJobStore: {
        async updateSandboxStarted() {
          throw new Error("should_not_start");
        },
      },
      sandboxClient: {
        async create() {
          throw new Error("should_not_create_sandbox");
        },
      },
      now: new Date("2026-05-28T08:00:00.000Z"),
    });

    await expect(start(job)).resolves.toEqual({
      status: "failed",
      reason: "sandbox_config_missing",
      message:
        "Missing required Sandbox runner environment variables: COLLECTOR_SCOPED_TOKEN_SECRET, AGENT_PROVIDER, OPENAI_API_KEY, OPENAI_MODEL",
    });
  });
});
