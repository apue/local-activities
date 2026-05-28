import { authenticateCollectorRequest } from "../../../../src/server/collector-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = authenticateCollectorRequest(request, process.env);

  if (!auth.ok) {
    return Response.json(
      {
        ok: false,
        error: auth.error,
      },
      { status: auth.status },
    );
  }

  return Response.json({
    ok: true,
    collectorId: auth.collectorId,
    serverTime: new Date().toISOString(),
  });
}
