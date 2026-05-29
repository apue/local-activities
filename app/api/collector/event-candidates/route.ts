import { handleCollectorEventCandidates } from "../../../../src/server/collector-event-candidates-route-handlers";
import { getSupabaseCollectorEventCandidateStore } from "../../../../src/server/supabase-collector-event-candidate-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleCollectorEventCandidates(
    request,
    getSupabaseCollectorEventCandidateStore(),
    process.env,
  );
}
