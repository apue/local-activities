import { describe, expect, it } from "vitest";

import type { CollectorJobRecord } from "./collector-job-service";
import {
  buildSandboxAgentCommand,
  buildSandboxAgentRunnerPayload,
  runVercelSandboxAgentJob,
  type VercelSandboxClient,
} from "./vercel-sandbox-runner";

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

describe("vercel sandbox runner", () => {
  it("builds a job-scoped Agent runner payload without broad production secrets", () => {
    const payload = buildSandboxAgentRunnerPayload({
      job,
      appBaseUrl: "https://local-activities.example",
      agentProvider: "openai",
      openaiApiKey: "openai-secret",
      openaiModel: "gpt-5-mini",
      openaiBaseUrl: "https://api.openai.com/v1",
      collectorId: "sandbox-job-1",
      scopedIngestToken: "scoped-ingest-token",
      scopedIngestTokenExpiresAt: "2026-05-28T08:20:00.000Z",
      forbiddenSecrets: {
        COLLECTOR_API_KEY: "long-lived-collector-secret",
        ADMIN_ACCESS_TOKEN: "admin-secret",
        SUPABASE_SECRET_KEY: "supabase-secret",
        VERCEL_API_TOKEN: "vercel-management-token",
      },
    });

    expect(payload).toMatchObject({
      job: {
        jobId: "job-1",
        seedUrl: "https://mp.weixin.qq.com/s/example",
        attemptNumber: 1,
      },
      ingest: {
        baseUrl: "https://local-activities.example",
        collectorId: "sandbox-job-1",
        runId: "sandbox-job-1-1",
        token: "scoped-ingest-token",
        tokenExpiresAt: "2026-05-28T08:20:00.000Z",
      },
      provider: {
        name: "openai",
        openaiBaseUrl: "https://api.openai.com/v1",
        openaiModel: "gpt-5-mini",
      },
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("long-lived-collector-secret");
    expect(serialized).not.toContain("admin-secret");
    expect(serialized).not.toContain("supabase-secret");
    expect(serialized).not.toContain("vercel-management-token");
  });

  it("builds the sandbox command with scoped collector credentials", () => {
    const payload = buildPayload();

    const command = buildSandboxAgentCommand(payload);

    expect(command.env).toMatchObject({
      COLLECTOR_BASE_URL: "https://local-activities.example",
      COLLECTOR_ID: "sandbox-job-1",
      COLLECTOR_API_KEY: "scoped-ingest-token",
      COLLECTOR_JOB_ID: "job-1",
      COLLECTOR_RUN_ID: "sandbox-job-1-1",
      AGENT_PROVIDER: "openai",
      AGENT_API_STYLE: "chat_completions",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_MODEL: "gpt-5-mini",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      COLLECTOR_BROWSER_RUNNER: "agent_browser",
      COLLECTOR_REPOSITORY_URL: "https://github.com/apue/local-activities.git",
      COLLECTOR_GIT_REF: "abc123",
    });
    expect(command.command).toBe("bash");
    const script = command.args.join(" ");
    expect(script).toContain("git clone");
    expect(script).toContain("pnpm install");
    expect(script).toContain("playwright install --with-deps chromium");
    expect(script).toContain("agent-browser install --with-deps");
    expect(script.indexOf("agent-browser install --with-deps")).toBeLessThan(
      script.indexOf("sandbox_browser_preflight"),
    );
    expect(script).toContain("sandbox_browser_preflight");
    expect(script).toContain("SANDBOX_SETUP_STARTED_AT");
    expect(JSON.stringify(command)).not.toContain(
      "long-lived-collector-secret",
    );
  });

  it("creates a sandbox, marks the job running, and executes the shared Agent processor", async () => {
    const calls: unknown[] = [];
    const client: VercelSandboxClient = {
      async create(input) {
        calls.push({ kind: "create", input });
        return {
          sandboxId: "sb_123",
          async runCommand(params) {
            calls.push({ kind: "runCommand", params });
            return { exitCode: 0 };
          },
        };
      },
    };
    const store = {
      async updateSandboxStarted(input: {
        jobId: string;
        sandboxRunId: string;
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
          attemptNumber: 1,
        };
      },
    };

    await runVercelSandboxAgentJob({
      job,
      payload: buildPayload(),
      sandboxClient: client,
      sandboxJobStore: store,
      now: new Date("2026-05-28T08:00:00.000Z"),
    });

    expect(calls).toEqual([
      {
        kind: "create",
        input: {
          name: "collector-job-1",
          tags: { collectorJobId: "job-1", runner: "vercel_sandbox" },
          runtime: "node24",
          resources: { vcpus: 2, memory: 4096 },
          timeout: 1_200_000,
        },
      },
      {
        kind: "updateSandboxStarted",
        input: {
          jobId: "job-1",
          sandboxRunId: "sb_123",
          startedAt: "2026-05-28T08:00:00.000Z",
          collectorId: "sandbox-job-1",
          localRunId: "sandbox-job-1-1",
          leaseExpiresAt: "2026-05-28T08:20:00.000Z",
        },
      },
      expect.objectContaining({
        kind: "runCommand",
        params: expect.objectContaining({
          cmd: "bash",
          detached: true,
        }),
      }),
    ]);
  });
});

function buildPayload() {
  return buildSandboxAgentRunnerPayload({
    job,
    appBaseUrl: "https://local-activities.example",
    agentProvider: "openai",
    agentApiStyle: "chat_completions",
    openaiApiKey: "openai-secret",
    openaiModel: "gpt-5-mini",
    openaiBaseUrl: "https://api.openai.com/v1",
    repositoryUrl: "https://github.com/apue/local-activities.git",
    gitRef: "abc123",
    collectorId: "sandbox-job-1",
    scopedIngestToken: "scoped-ingest-token",
    scopedIngestTokenExpiresAt: "2026-05-28T08:20:00.000Z",
    forbiddenSecrets: {
      COLLECTOR_API_KEY: "long-lived-collector-secret",
    },
  });
}
