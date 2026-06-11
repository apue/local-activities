import { handleAdminActivatePromptModelConfig } from "../../../../../../src/server/admin-route-handlers";
import { getSupabaseAdminStore } from "../../../../../../src/server/supabase-admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    configId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const params = await context.params;
  return handleAdminActivatePromptModelConfig(
    request,
    params.configId,
    getSupabaseAdminStore(),
    process.env,
  );
}
