import { handleReportCollectorJob } from "../../../../../../src/server/collector-job-route-handlers";
import { getSupabaseCollectorJobStore } from "../../../../../../src/server/supabase-collector-job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;

  return handleReportCollectorJob(
    request,
    jobId,
    getSupabaseCollectorJobStore(),
    process.env,
  );
}
