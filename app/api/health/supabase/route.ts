import { checkSupabaseHealth } from "../../../../src/server/supabase-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkSupabaseHealth(process.env, fetch);

  return Response.json(result, {
    status: result.status,
  });
}
