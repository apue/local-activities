import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseAdminEnv = {
  [key: string]: string | undefined;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

let cachedClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(
  env: SupabaseAdminEnv = process.env,
): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseSecretKey =
    env.SUPABASE_SECRET_KEY?.trim() ?? env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("supabase_admin_not_configured");
  }

  cachedClient = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return cachedClient;
}
