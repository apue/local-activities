import { handleCollectorFailureIngest } from "../../../../src/server/collector-ingest-route-handlers";
import { getSupabaseCollectorIngestStore } from "../../../../src/server/supabase-collector-ingest-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleCollectorFailureIngest(
    request,
    getSupabaseCollectorIngestStore(),
    process.env,
  );
}
