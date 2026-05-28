import { checkAppHealth } from "../../../src/server/app-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = checkAppHealth(process.env);

  return Response.json(result, {
    status: result.status,
  });
}
