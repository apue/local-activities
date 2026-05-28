import { handleClaimCollectorJob } from "../../../../../src/server/collector-job-route-handlers";
import { getSupabaseCollectorJobStore } from "../../../../../src/server/supabase-collector-job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleClaimCollectorJob(
    request,
    getSupabaseCollectorJobStore(),
    process.env,
  );
}
