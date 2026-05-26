type SupabaseHealthEnv = {
  [key: string]: string | undefined;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

type SupabaseHealthFetcher = (
  input: string,
  init: {
    cache: "no-store";
    headers: {
      apikey: string;
      authorization: string;
    };
    signal: AbortSignal;
  },
) => Promise<Pick<Response, "ok" | "status">>;

export type SupabaseHealthResult =
  | {
      ok: true;
      status: 200;
      supabaseHost: string;
    }
  | {
      ok: false;
      status: 500;
      error: "missing_supabase_env" | "invalid_supabase_url";
    }
  | {
      ok: false;
      status: 502;
      error: "supabase_request_failed";
      supabaseStatus: number;
      supabaseHost: string;
    }
  | {
      ok: false;
      status: 502;
      error: "supabase_request_error";
      supabaseHost: string;
    };

export async function checkSupabaseHealth(
  env: SupabaseHealthEnv,
  fetcher: SupabaseHealthFetcher,
): Promise<SupabaseHealthResult> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabasePublishableKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!supabaseUrl || !supabasePublishableKey) {
    return {
      ok: false,
      status: 500,
      error: "missing_supabase_env",
    };
  }

  let settingsUrl: URL;
  try {
    settingsUrl = new URL("/auth/v1/settings", supabaseUrl);
  } catch {
    return {
      ok: false,
      status: 500,
      error: "invalid_supabase_url",
    };
  }

  try {
    const response = await fetcher(settingsUrl.toString(), {
      cache: "no-store",
      headers: {
        apikey: supabasePublishableKey,
        authorization: `Bearer ${supabasePublishableKey}`,
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        error: "supabase_request_failed",
        supabaseStatus: response.status,
        supabaseHost: settingsUrl.host,
      };
    }

    return {
      ok: true,
      status: 200,
      supabaseHost: settingsUrl.host,
    };
  } catch {
    return {
      ok: false,
      status: 502,
      error: "supabase_request_error",
      supabaseHost: settingsUrl.host,
    };
  }
}
