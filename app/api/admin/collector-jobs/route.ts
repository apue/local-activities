import {
  handleAdminCreateCollectorJob,
  handleAdminListCollectorJobs,
} from "../../../../src/server/admin-route-handlers";
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

export async function POST(request: Request) {
  return handleAdminCreateCollectorJob(
    request,
    getSupabaseAdminStore(),
    process.env,
  );
}
