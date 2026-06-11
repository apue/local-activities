import {
  handleAdminCreatePromptModelConfig,
  handleAdminListPromptModelConfigs,
} from "../../../../src/server/admin-route-handlers";
import { getSupabaseAdminStore } from "../../../../src/server/supabase-admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAdminListPromptModelConfigs(
    request,
    getSupabaseAdminStore(),
    process.env,
  );
}

export async function POST(request: Request) {
  return handleAdminCreatePromptModelConfig(
    request,
    getSupabaseAdminStore(),
    process.env,
  );
}
