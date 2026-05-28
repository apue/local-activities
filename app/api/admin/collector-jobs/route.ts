import {
  handleAdminCreateCollectorJob,
  handleAdminListCollectorJobs,
} from "../../../../src/server/admin-route-handlers";
import { getSupabaseAdminStore } from "../../../../src/server/supabase-admin-store";
import { getSupabaseCollectorJobStore } from "../../../../src/server/supabase-collector-job-store";
import { createVercelSandboxJobStarter } from "../../../../src/server/vercel-sandbox-live-runner";

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
    new Date(),
    createVercelSandboxJobStarter({
      env: process.env,
      collectorJobStore: getSupabaseCollectorJobStore(),
    }),
  );
}
