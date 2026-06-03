import {
  handleAdminGetEventDraft,
  handleAdminPatchEventDraft,
} from "../../../../../src/server/admin-route-handlers";
import { getSupabaseAdminStore } from "../../../../../src/server/supabase-admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await context.params;

  return handleAdminGetEventDraft(
    request,
    draftId,
    getSupabaseAdminStore(),
    process.env,
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await context.params;

  return handleAdminPatchEventDraft(
    request,
    draftId,
    getSupabaseAdminStore(),
    process.env,
  );
}
