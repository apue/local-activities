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
  AGENT_API_BASE_URL?: string;
  AGENT_API_KEY?: string;
  AGENT_MODEL?: string;
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
        agentBaseUrl: config.value.agentBaseUrl,
        agentApiKey: config.value.agentApiKey,
        agentModel: config.value.agentModel,
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
        agentBaseUrl: string;
        agentApiKey: string;
        agentModel?: string;
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
  const agentBaseUrl = readRequiredEnv(env.AGENT_API_BASE_URL);
  const agentApiKey = readRequiredEnv(env.AGENT_API_KEY);
  const missing = [
    appBaseUrl ? undefined : "NEXT_PUBLIC_APP_URL",
    scopedTokenSecret ? undefined : "COLLECTOR_SCOPED_TOKEN_SECRET",
    agentBaseUrl ? undefined : "AGENT_API_BASE_URL",
    agentApiKey ? undefined : "AGENT_API_KEY",
  ].filter((key): key is string => Boolean(key));
  if (!appBaseUrl || !scopedTokenSecret || !agentBaseUrl || !agentApiKey) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    value: {
      appBaseUrl,
      scopedTokenSecret,
      agentBaseUrl,
      agentApiKey,
      agentModel: env.AGENT_MODEL?.trim() || undefined,
      repositoryUrl: buildRepositoryUrl(env),
      gitRef: env.VERCEL_GIT_COMMIT_SHA?.trim() || undefined,
    },
  };
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
