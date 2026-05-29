import type { SandboxStartResult } from "./admin-route-handlers";
import type { CollectorJobRecord } from "./collector-job-service";
import { createCollectorScopedToken } from "./collector-scoped-token";
import {
  buildSandboxAgentRunnerPayload,
  runVercelSandboxAgentJob,
  type SandboxJobStore,
  type VercelSandboxClient,
} from "./vercel-sandbox-runner";

type SandboxRunnerEnv = {
  [key: string]: string | undefined;
  VERCEL_SANDBOX_ENABLED?: string;
  NEXT_PUBLIC_APP_URL?: string;
  COLLECTOR_SCOPED_TOKEN_SECRET?: string;
  AGENT_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  COLLECTOR_BROWSER_RUNNER?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_GIT_REPO_OWNER?: string;
  VERCEL_GIT_REPO_SLUG?: string;
};

export function createVercelSandboxJobStarter(input: {
  env: SandboxRunnerEnv;
  collectorJobStore: SandboxJobStore;
  sandboxClient?: VercelSandboxClient;
  now?: Date;
}) {
  return async (job: CollectorJobRecord): Promise<SandboxStartResult> => {
    if (input.env.VERCEL_SANDBOX_ENABLED !== "true") {
      return {
        status: "skipped",
        reason: "sandbox_starter_not_configured",
      };
    }

    const config = readSandboxRunnerConfig(input.env);
    if (!config.ok) {
      return {
        status: "failed",
        reason: "sandbox_config_missing",
        message: `Missing required Sandbox runner environment variables: ${config.missing.join(", ")}`,
      };
    }

    const now = input.now ?? new Date();
    const tokenExpiresAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
    const collectorId = `sandbox-${job.jobId}`;
    const scopedIngestToken = createCollectorScopedToken({
      collectorId,
      jobId: job.jobId,
      expiresAt: tokenExpiresAt,
      secret: config.value.scopedTokenSecret,
    });
    const sandboxClient = input.sandboxClient ?? (await createSdkSandboxClient());
    const result = await runVercelSandboxAgentJob({
      job,
      payload: buildSandboxAgentRunnerPayload({
        job,
        appBaseUrl: config.value.appBaseUrl,
        agentProvider: config.value.agentProvider,
        openaiApiKey: config.value.openaiApiKey,
        openaiModel: config.value.openaiModel,
        openaiBaseUrl: config.value.openaiBaseUrl,
        browserRunner: config.value.browserRunner,
        repositoryUrl: config.value.repositoryUrl,
        gitRef: config.value.gitRef,
        collectorId,
        scopedIngestToken,
        scopedIngestTokenExpiresAt: tokenExpiresAt,
      }),
      sandboxClient,
      sandboxJobStore: input.collectorJobStore,
      now,
    });

    return {
      status: "started",
      sandboxId: result.sandboxId,
    };
  };
}

async function createSdkSandboxClient(): Promise<VercelSandboxClient> {
  const { Sandbox } = await import("@vercel/sandbox");
  return {
    async create(input) {
      const sandbox = await Sandbox.create(input);
      const sandboxId =
        (sandbox as { sandboxId?: string; id?: string; name?: string }).sandboxId ??
        (sandbox as { sandboxId?: string; id?: string; name?: string }).id ??
        (sandbox as { sandboxId?: string; id?: string; name?: string }).name;
      if (!sandboxId) throw new Error("sandbox_id_missing");

      return {
        sandboxId,
        async runCommand(params) {
          const command = await sandbox.runCommand({
            cmd: params.cmd,
            args: params.args,
            cwd: params.cwd,
            env: params.env,
            detached: params.detached,
          });
          return {
            cmdId: (command as { cmdId?: string; id?: string }).cmdId ??
              (command as { cmdId?: string; id?: string }).id,
          };
        },
      };
    },
  };
}

function readSandboxRunnerConfig(env: SandboxRunnerEnv):
  | {
      ok: true;
      value: {
        appBaseUrl: string;
        scopedTokenSecret: string;
        agentProvider: "openai";
        openaiApiKey: string;
        openaiModel: string;
        openaiBaseUrl?: string;
        browserRunner: "playwright" | "agent_browser";
        repositoryUrl: string;
        gitRef?: string;
      };
    }
  | {
      ok: false;
      missing: string[];
    } {
  const appBaseUrl = readRequiredEnv(env.NEXT_PUBLIC_APP_URL);
  const scopedTokenSecret = readRequiredEnv(env.COLLECTOR_SCOPED_TOKEN_SECRET);
  const agentProvider = readRequiredEnv(env.AGENT_PROVIDER);
  const openaiApiKey = readRequiredEnv(env.OPENAI_API_KEY);
  const openaiModel = readRequiredEnv(env.OPENAI_MODEL);
  const missing = [
    appBaseUrl ? undefined : "NEXT_PUBLIC_APP_URL",
    scopedTokenSecret ? undefined : "COLLECTOR_SCOPED_TOKEN_SECRET",
    agentProvider ? undefined : "AGENT_PROVIDER",
    openaiApiKey ? undefined : "OPENAI_API_KEY",
    openaiModel ? undefined : "OPENAI_MODEL",
  ].filter((key): key is string => Boolean(key));
  if (!appBaseUrl || !scopedTokenSecret || !agentProvider || !openaiApiKey || !openaiModel) {
    return { ok: false, missing };
  }
  if (agentProvider !== "openai") {
    return { ok: false, missing: ["AGENT_PROVIDER"] };
  }

  return {
    ok: true,
    value: {
      appBaseUrl,
      scopedTokenSecret,
      agentProvider,
      openaiApiKey,
      openaiModel,
      openaiBaseUrl: env.OPENAI_BASE_URL?.trim() || undefined,
      browserRunner: readBrowserRunner(env.COLLECTOR_BROWSER_RUNNER),
      repositoryUrl: buildRepositoryUrl(env),
      gitRef: env.VERCEL_GIT_COMMIT_SHA?.trim() || undefined,
    },
  };
}

function readBrowserRunner(value: string | undefined) {
  const runner = value?.trim();
  return runner === "playwright" ? "playwright" : "agent_browser";
}

function buildRepositoryUrl(env: SandboxRunnerEnv) {
  const owner = env.VERCEL_GIT_REPO_OWNER?.trim() || "apue";
  const repo = env.VERCEL_GIT_REPO_SLUG?.trim() || "local-activities";
  return `https://github.com/${owner}/${repo}.git`;
}

function readRequiredEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
