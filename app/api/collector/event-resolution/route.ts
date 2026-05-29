import { handleCollectorEventResolution } from "../../../../src/server/collector-event-resolution-route-handlers";
import { getSupabaseCollectorEventResolutionStore } from "../../../../src/server/supabase-collector-event-resolution-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleCollectorEventResolution(
    request,
    getSupabaseCollectorEventResolutionStore(),
    process.env,
  );
}
