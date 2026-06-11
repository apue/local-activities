import {
  handleAdminCreateFeedback,
  handleAdminListFeedback,
} from "../../../../src/server/admin-route-handlers";
import { getSupabaseAdminStore } from "../../../../src/server/supabase-admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAdminListFeedback(
    request,
    getSupabaseAdminStore(),
    process.env,
  );
}

export async function POST(request: Request) {
  return handleAdminCreateFeedback(
    request,
    getSupabaseAdminStore(),
    process.env,
  );
}
