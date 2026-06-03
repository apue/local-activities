import { z } from "zod";

import { adminSessionCookie } from "./admin-auth";
import { authenticateAdminRequest } from "./admin-auth";
import {
  createAdminCollectorJob,
  getAdminEventDraftDetail,
  listAdminCollectorJobs,
  listAdminExcludedArticles,
  listAdminEventDrafts,
  markAdminEventDraftNeedsInfo,
  patchAdminEventDraft,
  promoteAdminExcludedArticle,
  publishAdminEventDraft,
  rejectAdminEventDraft,
  type AdminStore,
} from "./admin-service";
import type { CollectorJobRecord } from "./collector-job-service";

type AdminEnv = {
  [key: string]: string | undefined;
  ADMIN_ACCESS_TOKEN?: string;
};

export type SandboxStartResult =
  | {
      status: "started";
      sandboxId: string;
    }
  | {
      status: "skipped";
      reason: "local_collector_preferred" | "sandbox_starter_not_configured";
    }
  | {
      status: "failed";
      reason: string;
      message: string;
    };

export type SandboxJobStarter = (
  job: CollectorJobRecord,
) => Promise<SandboxStartResult>;

const createCollectorJobSchema = z
  .object({
    seedUrl: z.string().min(1),
    preferredRunner: z
      .enum(["vercel_sandbox", "local_collector"])
      .optional(),
  })
  .strict();

const draftPublishActionSchema = z
  .object({
    operatorOverrideReason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

const draftPatchSchema = z
  .object({
    title: z.string().min(1).optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    venueName: z.string().min(1).optional(),
    venueAddress: z.string().min(1).optional(),
    scheduleText: z.string().min(1).optional(),
    scheduleKind: z
      .enum(["single", "multi_day", "long_running", "recurring", "unsupported"])
      .optional(),
    recurrenceRule: z.string().min(1).optional(),
    occurrenceStartsAt: z.array(z.string().datetime({ offset: true })).optional(),
    registrationUrl: z.string().url().optional(),
    registrationQrAssetId: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    entryNotes: z.string().min(1).optional(),
  })
  .strict();

const adminLoginSchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();

export async function handleAdminLogin(request: Request, env: AdminEnv) {
  const parsed = adminLoginSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRequestResponse(parsed.error);

  const auth = authenticateAdminRequest(
    new Request(request.url, {
      headers: { authorization: `Bearer ${parsed.data.token}` },
    }),
    env,
  );
  if (!auth.ok) return authErrorResponse(auth);

  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": adminSessionCookie(parsed.data.token),
      },
    },
  );
}

export async function handleAdminCreateCollectorJob(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
  now = new Date(),
  startSandboxJob?: SandboxJobStarter,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const parsed = createCollectorJobSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRequestResponse(parsed.error);

  try {
    const job = await createAdminCollectorJob(parsed.data, store, now);
    const sandboxStart = await maybeStartSandboxJob(job, startSandboxJob);
    return Response.json({
      ok: true,
      job,
      sandboxStart,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

async function maybeStartSandboxJob(
  job: CollectorJobRecord,
  startSandboxJob?: SandboxJobStarter,
): Promise<SandboxStartResult> {
  if (job.preferredRunner === "local_collector") {
    return {
      status: "skipped",
      reason: "local_collector_preferred",
    };
  }

  if (!startSandboxJob) {
    return {
      status: "skipped",
      reason: "sandbox_starter_not_configured",
    };
  }

  try {
    return await startSandboxJob(job);
  } catch (error) {
    return {
      status: "failed",
      reason: "sandbox_start_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function handleAdminListCollectorJobs(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  try {
    const jobs = await listAdminCollectorJobs(store);
    return Response.json({
      ok: true,
      jobs,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
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
  try {
    const drafts = await listAdminEventDrafts({ reviewState }, store);
    return Response.json({
      ok: true,
      drafts,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleAdminListExcludedArticles(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const url = new URL(request.url);
  const processingState =
    url.searchParams.get("processingState") ?? undefined;
  try {
    const excludedArticles = await listAdminExcludedArticles(
      { processingState: processingState as never },
      store,
    );
    return Response.json({
      ok: true,
      excludedArticles,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleAdminPromoteExcludedArticle(
  request: Request,
  excludedArticleId: string,
  store: AdminStore,
  env: AdminEnv,
  now = new Date(),
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  try {
    const excludedArticle = await promoteAdminExcludedArticle(
      excludedArticleId,
      store,
      now,
    );
    return Response.json({
      ok: true,
      excludedArticle,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
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

export async function handleAdminPatchEventDraft(
  request: Request,
  draftId: string,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const parsed = draftPatchSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRequestResponse(parsed.error);

  try {
    const draft = await patchAdminEventDraft(draftId, parsed.data, store);
    return Response.json({ ok: true, draft });
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

    const parsed = draftPublishActionSchema.safeParse(
      (await parseJson(request)) ?? {},
    );
    if (!parsed.success) return invalidRequestResponse(parsed.error);
    const event = await publishAdminEventDraft(
      draftId,
      store,
      now,
      parsed.data,
    );
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
  const status = adminErrorStatus(message);

  return Response.json(
    {
      ok: false,
      error: message,
    },
    { status },
  );
}

function adminErrorStatus(message: string) {
  if (message === "draft_not_found") return 404;
  if (message === "excluded_article_not_found") return 404;
  if (message === "draft_not_publishable") return 400;
  if (message === "invalid_seed_url") return 400;
  return 500;
}
