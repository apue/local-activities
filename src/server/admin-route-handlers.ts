import { z } from "zod";

import { authenticateAdminRequest } from "./admin-auth";
import {
  createAdminCollectorJob,
  getAdminEventDraftDetail,
  listAdminCollectorJobs,
  listAdminEventDrafts,
  markAdminEventDraftNeedsInfo,
  publishAdminEventDraft,
  rejectAdminEventDraft,
  type AdminStore,
} from "./admin-service";

type AdminEnv = {
  [key: string]: string | undefined;
  ADMIN_ACCESS_TOKEN?: string;
};

const createCollectorJobSchema = z
  .object({
    seedUrl: z.string().url(),
  })
  .strict();

export async function handleAdminCreateCollectorJob(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
  now = new Date(),
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const parsed = createCollectorJobSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRequestResponse(parsed.error);

  try {
    const job = await createAdminCollectorJob(parsed.data, store, now);
    return Response.json({
      ok: true,
      job,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleAdminListCollectorJobs(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const jobs = await listAdminCollectorJobs(store);
  return Response.json({
    ok: true,
    jobs,
  });
}

export async function handleAdminListEventDrafts(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const url = new URL(request.url);
  const reviewState = url.searchParams.get("reviewState") ?? undefined;
  const drafts = await listAdminEventDrafts({ reviewState }, store);

  return Response.json({
    ok: true,
    drafts,
  });
}

export async function handleAdminGetEventDraft(
  request: Request,
  draftId: string,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  try {
    const draft = await getAdminEventDraftDetail(draftId, store);
    return Response.json({
      ok: true,
      draft,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleAdminDraftAction(
  request: Request,
  draftId: string,
  action: "needs-info" | "reject" | "publish",
  store: AdminStore,
  env: AdminEnv,
  now = new Date(),
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  try {
    if (action === "needs-info") {
      const draft = await markAdminEventDraftNeedsInfo(draftId, store);
      return Response.json({ ok: true, draft });
    }
    if (action === "reject") {
      const draft = await rejectAdminEventDraft(draftId, store);
      return Response.json({ ok: true, draft });
    }

    const event = await publishAdminEventDraft(draftId, store, now);
    return Response.json({
      ok: true,
      event,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function authErrorResponse(
  auth: Exclude<ReturnType<typeof authenticateAdminRequest>, { ok: true }>,
) {
  return Response.json(
    {
      ok: false,
      error: auth.error,
    },
    { status: auth.status },
  );
}

function invalidRequestResponse(error: z.ZodError) {
  return Response.json(
    {
      ok: false,
      error: "invalid_request",
      issues: error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

function serviceErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "admin_error";
  const status =
    message === "draft_not_found"
      ? 404
      : message === "draft_not_publishable" || message === "invalid_seed_url"
        ? 400
        : 500;

  return Response.json(
    {
      ok: false,
      error: message,
    },
    { status },
  );
}
