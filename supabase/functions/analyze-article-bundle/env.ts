/// <reference lib="deno.ns" />

type EnvReader = (name: string) => string | undefined;

export function readRequiredEnv(
  name: string,
  read: EnvReader = (key) => Deno.env.get(key),
): string {
  const value = clean(read(name));
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

export function readServiceRoleKey(
  read: EnvReader = (key) => Deno.env.get(key),
): string {
  const value = firstEnv([
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPA_SERVICE_KEY",
  ], read);
  if (!value) {
    throw new Error(
      "missing_env:SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPA_SERVICE_KEY",
    );
  }
  return value;
}

export function readAnalysisTimeoutMs(
  read: EnvReader = (key) => Deno.env.get(key),
): number {
  const timeoutMs = readNumberEnv("ANALYSIS_LLM_TIMEOUT_MS", read);
  if (timeoutMs !== undefined) return timeoutMs;
  const timeoutSeconds = readNumberEnv("ANALYSIS_LLM_TIMEOUT_SECONDS", read);
  if (timeoutSeconds !== undefined) return timeoutSeconds * 1000;
  return 30_000;
}

export function readNumberEnv(
  name: string,
  read: EnvReader = (key) => Deno.env.get(key),
): number | undefined {
  const value = clean(read(name));
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstEnv(names: string[], read: EnvReader): string | undefined {
  for (const name of names) {
    const value = clean(read(name));
    if (value) return value;
  }
  return undefined;
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}
