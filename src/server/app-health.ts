type AppHealthEnv = {
  [key: string]: string | undefined;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
};

const requiredEnvNames = [
  "NEXT_PUBLIC_APP_URL",
  "ADMIN_ACCESS_TOKEN",
  "COLLECTOR_API_KEY",
  "COLLECTOR_SCOPED_TOKEN_SECRET",
  "INTERNAL_API_SECRET",
  "AGENT_API_BASE_URL",
  "AGENT_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  "CRON_SECRET",
  "OBSERVABILITY_PROVIDER",
  "VERCEL_WEB_ANALYTICS_ENABLED",
  "VERCEL_SPEED_INSIGHTS_ENABLED",
  "VERCEL_SANDBOX_ENABLED",
  "VERCEL_SANDBOX_API_KEY",
] as const;

const placeholderPatterns = [
  /^replace-with-/i,
  /^https:\/\/your-/i,
  /^https:\/\/replace-with-/i,
  /^postgresql:\/\/postgres:password@/i,
  /^same-long-random-secret-as-vercel$/i,
];

export type AppHealthResult = {
  ok: boolean;
  status: 200 | 500;
  service: "local-activities";
  checkedAt: string;
  environment: string;
  git: {
    commitSha?: string;
    commitRef?: string;
  };
  env: {
    required: string[];
    configured: string[];
    missing: string[];
    placeholders: string[];
  };
};

export function checkAppHealth(
  env: AppHealthEnv,
  now = new Date(),
): AppHealthResult {
  const missing: string[] = [];
  const placeholders: string[] = [];
  const configured: string[] = [];

  for (const name of requiredEnvNames) {
    const value = env[name]?.trim();
    if (!value) {
      missing.push(name);
    } else if (isPlaceholderValue(name, value)) {
      placeholders.push(name);
    } else {
      configured.push(name);
    }
  }

  const ok = missing.length === 0 && placeholders.length === 0;

  return {
    ok,
    status: ok ? 200 : 500,
    service: "local-activities",
    checkedAt: now.toISOString(),
    environment: env.VERCEL_ENV?.trim() || "local",
    git: {
      commitSha: env.VERCEL_GIT_COMMIT_SHA?.trim() || undefined,
      commitRef: env.VERCEL_GIT_COMMIT_REF?.trim() || undefined,
    },
    env: {
      required: [...requiredEnvNames],
      configured,
      missing,
      placeholders,
    },
  };
}

function isPlaceholderValue(name: string, value: string) {
  if (
    name === "NEXT_PUBLIC_APP_URL" &&
    /^http:\/\/localhost(?::\d+)?$/i.test(value)
  ) {
    return true;
  }

  return placeholderPatterns.some((pattern) => pattern.test(value));
}
