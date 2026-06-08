import { handleAdminListCollectorJobs } from "../../../../src/server/admin-route-handlers";
import { getSupabaseAdminStore } from "../../../../src/server/supabase-admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAdminListCollectorJobs(
    request,
    getSupabaseAdminStore(),
    process.env,
  );
}
