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
    runId: string;
    token: string;
    tokenExpiresAt: string;
  };
  provider: {
    name: "openai";
    agentApiStyle?: "responses" | "chat_completions";
    openaiApiKey: string;
    openaiModel: string;
    openaiBaseUrl?: string;
  };
  browser: {
    runner: "playwright" | "agent_browser";
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
    runtime: "node24";
    resources: {
      vcpus: number;
      memory: number;
    };
    timeout: number;
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
    collectorId: string;
    localRunId: string;
    leaseExpiresAt: string;
  }): Promise<CollectorJobRecord | null>;
};

export function buildSandboxAgentRunnerPayload(input: {
  job: CollectorJobRecord;
  appBaseUrl: string;
  agentProvider: "openai";
  agentApiStyle?: "responses" | "chat_completions";
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl?: string;
  browserRunner?: "playwright" | "agent_browser";
  repositoryUrl?: string;
  gitRef?: string;
  collectorId: string;
  scopedIngestToken: string;
  scopedIngestTokenExpiresAt: string;
  forbiddenSecrets?: Record<string, string | undefined>;
}): SandboxAgentRunnerPayload {
  const attemptNumber = input.job.attemptNumber + 1;
  return {
    job: {
      jobId: input.job.jobId,
      seedUrl: input.job.seedUrl,
      sourceId: input.job.sourceId,
      attemptNumber,
      requestedMode: input.job.requestedMode,
    },
    ingest: {
      baseUrl: normalizeBaseUrl(input.appBaseUrl),
      collectorId: input.collectorId,
      runId: `${input.collectorId}-${attemptNumber}`,
      token: input.scopedIngestToken,
      tokenExpiresAt: input.scopedIngestTokenExpiresAt,
    },
    provider: {
      name: input.agentProvider,
      agentApiStyle: input.agentApiStyle,
      openaiApiKey: input.openaiApiKey,
      openaiModel: input.openaiModel,
      openaiBaseUrl: input.openaiBaseUrl
        ? normalizeBaseUrl(input.openaiBaseUrl)
        : undefined,
    },
    browser: {
      runner: input.browserRunner ?? "agent_browser",
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
    'export SANDBOX_SETUP_STARTED_AT="$(node -e \'console.log(Date.now())\')"',
    'echo "sandbox_setup_start runner=$COLLECTOR_BROWSER_RUNNER"',
    "rm -rf local-activities",
    'git clone --depth 1 "$COLLECTOR_REPOSITORY_URL" local-activities',
    "cd local-activities",
    'if [ -n "${COLLECTOR_GIT_REF:-}" ]; then git fetch --depth 1 origin "$COLLECTOR_GIT_REF" && git checkout FETCH_HEAD; fi',
    "corepack enable",
    "pnpm install --frozen-lockfile",
    'if [ "$COLLECTOR_BROWSER_RUNNER" = "agent_browser" ]; then npm install -g agent-browser@0.27.0 && agent-browser install --with-deps; fi',
    'if [ "$COLLECTOR_BROWSER_RUNNER" = "playwright" ]; then pnpm exec playwright install --with-deps chromium; fi',
    'echo "sandbox_browser_preflight runner=$COLLECTOR_BROWSER_RUNNER"',
    'if [ "$COLLECTOR_BROWSER_RUNNER" = "playwright" ]; then node --input-type=module -e "const { chromium } = await import(\'playwright\'); const browser = await chromium.launch({ headless: true }); await browser.close(); console.log(\'playwright_preflight_ok\');"; fi',
    'if [ "$COLLECTOR_BROWSER_RUNNER" = "agent_browser" ]; then agent-browser --version && agent-browser --session sandbox-preflight batch --bail "open about:blank" "get title" --json; fi',
    'export SANDBOX_BROWSER_READY_AT="$(node -e \'console.log(Date.now())\')"',
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
      COLLECTOR_RUN_ID: payload.ingest.runId,
      COLLECTOR_BROWSER_RUNNER: payload.browser.runner,
      AGENT_PROVIDER: payload.provider.name,
      ...(payload.provider.agentApiStyle
        ? { AGENT_API_STYLE: payload.provider.agentApiStyle }
        : {}),
      OPENAI_API_KEY: payload.provider.openaiApiKey,
      OPENAI_MODEL: payload.provider.openaiModel,
      ...(payload.provider.openaiBaseUrl
        ? { OPENAI_BASE_URL: payload.provider.openaiBaseUrl }
        : {}),
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
    runtime: "node24",
    resources: {
      vcpus: 2,
      memory: 4096,
    },
    timeout: 1_200_000,
  });

  await input.sandboxJobStore.updateSandboxStarted({
    jobId: input.job.jobId,
    sandboxRunId: sandbox.sandboxId,
    startedAt: (input.now ?? new Date()).toISOString(),
    collectorId: input.payload.ingest.collectorId,
    localRunId: input.payload.ingest.runId,
    leaseExpiresAt: input.payload.ingest.tokenExpiresAt,
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
