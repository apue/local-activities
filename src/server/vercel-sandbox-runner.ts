import type { CollectorJobRecord } from "./collector-job-service";

export type SandboxAgentRunnerPayload = {
  job: {
    jobId: string;
    seedUrl: string;
    sourceId?: string;
    attemptNumber: number;
    requestedMode?: CollectorJobRecord["requestedMode"];
  };
  ingest: {
    baseUrl: string;
    collectorId: string;
    token: string;
    tokenExpiresAt: string;
  };
  agent: {
    baseUrl: string;
    token: string;
    model?: string;
  };
  repository: {
    url: string;
    gitRef?: string;
  };
};

export type SandboxAgentCommand = {
  command: "bash";
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

export type VercelSandboxClient = {
  create(input: {
    name: string;
    tags: Record<string, string>;
  }): Promise<{
    sandboxId: string;
    runCommand(params: {
      cmd: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      detached: boolean;
    }): Promise<{ exitCode?: number | null; cmdId?: string }>;
  }>;
};

export type SandboxJobStore = {
  updateSandboxStarted(input: {
    jobId: string;
    sandboxRunId: string;
    startedAt: string;
  }): Promise<CollectorJobRecord | null>;
};

export function buildSandboxAgentRunnerPayload(input: {
  job: CollectorJobRecord;
  appBaseUrl: string;
  agentBaseUrl: string;
  agentApiKey: string;
  agentModel?: string;
  repositoryUrl?: string;
  gitRef?: string;
  collectorId: string;
  scopedIngestToken: string;
  scopedIngestTokenExpiresAt: string;
  forbiddenSecrets?: Record<string, string | undefined>;
}): SandboxAgentRunnerPayload {
  return {
    job: {
      jobId: input.job.jobId,
      seedUrl: input.job.seedUrl,
      sourceId: input.job.sourceId,
      attemptNumber: input.job.attemptNumber + 1,
      requestedMode: input.job.requestedMode,
    },
    ingest: {
      baseUrl: normalizeBaseUrl(input.appBaseUrl),
      collectorId: input.collectorId,
      token: input.scopedIngestToken,
      tokenExpiresAt: input.scopedIngestTokenExpiresAt,
    },
    agent: {
      baseUrl: normalizeBaseUrl(input.agentBaseUrl),
      token: input.agentApiKey,
      model: input.agentModel,
    },
    repository: {
      url:
        input.repositoryUrl?.trim() ||
        "https://github.com/apue/local-activities.git",
      gitRef: input.gitRef?.trim() || undefined,
    },
  };
}

export function buildSandboxAgentCommand(
  payload: SandboxAgentRunnerPayload,
): SandboxAgentCommand {
  const code = `import { runCollectorAgent } from './scripts/collector-agent-processor.mjs';
await runCollectorAgent({
  seedUrl: process.env.COLLECTOR_SEED_URL,
  runId: process.env.COLLECTOR_RUN_ID,
  vercelJobId: process.env.COLLECTOR_JOB_ID,
});`;
  const script = [
    "set -euo pipefail",
    "rm -rf local-activities",
    'git clone --depth 1 "$COLLECTOR_REPOSITORY_URL" local-activities',
    "cd local-activities",
    'if [ -n "${COLLECTOR_GIT_REF:-}" ]; then git fetch --depth 1 origin "$COLLECTOR_GIT_REF" && git checkout FETCH_HEAD; fi',
    "corepack enable",
    "pnpm install --frozen-lockfile",
    `node --input-type=module -e ${shellQuote(code)}`,
  ].join("\n");

  return {
    command: "bash",
    args: ["-lc", script],
    cwd: "/home/vercel-sandbox",
    env: {
      COLLECTOR_REPOSITORY_URL: payload.repository.url,
      ...(payload.repository.gitRef
        ? { COLLECTOR_GIT_REF: payload.repository.gitRef }
        : {}),
      COLLECTOR_BASE_URL: payload.ingest.baseUrl,
      COLLECTOR_ID: payload.ingest.collectorId,
      COLLECTOR_API_KEY: payload.ingest.token,
      COLLECTOR_JOB_ID: payload.job.jobId,
      COLLECTOR_SEED_URL: payload.job.seedUrl,
      COLLECTOR_RUN_ID: `sandbox-${payload.job.jobId}-${payload.job.attemptNumber}`,
      AGENT_API_BASE_URL: payload.agent.baseUrl,
      AGENT_API_KEY: payload.agent.token,
      ...(payload.agent.model ? { AGENT_MODEL: payload.agent.model } : {}),
    },
  };
}

export async function runVercelSandboxAgentJob(input: {
  job: CollectorJobRecord;
  payload: SandboxAgentRunnerPayload;
  sandboxClient: VercelSandboxClient;
  sandboxJobStore: SandboxJobStore;
  now?: Date;
}) {
  const sandbox = await input.sandboxClient.create({
    name: `collector-${input.job.jobId}`,
    tags: {
      collectorJobId: input.job.jobId,
      runner: "vercel_sandbox",
    },
  });

  await input.sandboxJobStore.updateSandboxStarted({
    jobId: input.job.jobId,
    sandboxRunId: sandbox.sandboxId,
    startedAt: (input.now ?? new Date()).toISOString(),
  });

  const command = buildSandboxAgentCommand(input.payload);
  const result = await sandbox.runCommand({
    cmd: command.command,
    args: command.args,
    cwd: command.cwd,
    env: command.env,
    detached: true,
  });

  return {
    sandboxId: sandbox.sandboxId,
    exitCode: result.exitCode ?? null,
    commandId: result.cmdId,
  };
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
