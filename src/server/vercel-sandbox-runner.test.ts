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
      agentBaseUrl: "https://agent.example/v1",
      agentApiKey: "sandbox-agent-key",
      agentModel: "agent-model",
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
        token: "scoped-ingest-token",
        tokenExpiresAt: "2026-05-28T08:20:00.000Z",
      },
      agent: {
        baseUrl: "https://agent.example/v1",
        token: "sandbox-agent-key",
        model: "agent-model",
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
      AGENT_API_BASE_URL: "https://agent.example/v1",
      AGENT_API_KEY: "sandbox-agent-key",
      AGENT_MODEL: "agent-model",
    });
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
          async runCommand(command, args, options) {
            calls.push({ kind: "runCommand", command, args, options });
            return { exitCode: 0 };
          },
        };
      },
    };
    const store = {
      async updateSandboxStarted(input: {
        jobId: string;
        sandboxRunId: string;
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
        },
      },
      {
        kind: "updateSandboxStarted",
        input: {
          jobId: "job-1",
          sandboxRunId: "sb_123",
          startedAt: "2026-05-28T08:00:00.000Z",
        },
      },
      expect.objectContaining({
        kind: "runCommand",
        command: "node",
      }),
    ]);
  });
});

function buildPayload() {
  return buildSandboxAgentRunnerPayload({
    job,
    appBaseUrl: "https://local-activities.example",
    agentBaseUrl: "https://agent.example/v1",
    agentApiKey: "sandbox-agent-key",
    agentModel: "agent-model",
    collectorId: "sandbox-job-1",
    scopedIngestToken: "scoped-ingest-token",
    scopedIngestTokenExpiresAt: "2026-05-28T08:20:00.000Z",
    forbiddenSecrets: {
      COLLECTOR_API_KEY: "long-lived-collector-secret",
    },
  });
}
