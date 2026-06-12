import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { authenticateAdminRequest } from "../../src/server/admin-auth";

export async function requireAdminPreviewAuth() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
  const auth = authenticateAdminRequest(
    new Request("https://local-activities.test/admin/eval-preview", {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    }),
    process.env,
  );

  if (!auth.ok) redirect("/admin");
}
