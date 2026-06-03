import { handleAdminPromoteExcludedArticle } from "../../../../../../src/server/admin-route-handlers";
import { getSupabaseAdminStore } from "../../../../../../src/server/supabase-admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ excludedArticleId: string }> },
) {
  const { excludedArticleId } = await context.params;
  return handleAdminPromoteExcludedArticle(
    request,
    excludedArticleId,
    getSupabaseAdminStore(),
    process.env,
  );
}
