import { handleAdminLogin } from "../../../../src/server/admin-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleAdminLogin(request, process.env);
}
