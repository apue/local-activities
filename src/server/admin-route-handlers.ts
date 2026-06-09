import { z } from "zod";

import { adminSessionCookie } from "./admin-auth";
import { authenticateAdminRequest } from "./admin-auth";
import {
  AdminDraftPublishBlockedError,
  getAdminEventDraftDetail,
  listAdminCollectorJobs,
  listAdminEvaluationRuns,
  listAdminExcludedArticles,
  listAdminEventDrafts,
  listAdminLlmUsageSummary,
  listAdminProcessingLedger,
  markAdminEventDraftNeedsInfo,
  patchAdminEventDraft,
  promoteAdminExcludedArticle,
  publishAdminEventDraft,
  rejectAdminEventDraft,
  type AdminStore,
} from "./admin-service";

type AdminEnv = {
  [key: string]: string | undefined;
  ADMIN_ACCESS_TOKEN?: string;
};

const draftPublishActionSchema = z
  .object({
    operatorOverrideReason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

const draftRejectActionSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
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

const llmUsageRangeSchema = z
  .enum(["today", "7d", "all"])
  .optional()
  .default("today");

const processingLedgerStateSchema = z
  .enum([
    "captured",
    "analysis_started",
    "published",
    "needs_review",
    "needs_info",
    "excluded",
    "duplicate",
    "failed",
  ])
  .optional();

const dataClassSchema = z
  .enum(["production", "eval", "test", "smoke"])
  .optional()
  .default("production");

const excludedArticleProcessingStateSchema = z
  .enum(["excluded", "promoted_to_extraction"])
  .optional();

const evaluationRunStatusSchema = z
  .enum(["running", "completed", "failed"])
  .optional();

const evaluationRunValiditySchema = z
  .enum(["valid", "invalidated"])
  .default("valid");

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
  const parsedProcessingState = excludedArticleProcessingStateSchema.safeParse(
    url.searchParams.get("processingState") ?? undefined,
  );
  if (!parsedProcessingState.success) {
    return invalidRequestResponse(parsedProcessingState.error);
  }
  try {
    const excludedArticles = await listAdminExcludedArticles(
      { processingState: parsedProcessingState.data },
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

export async function handleAdminListProcessingLedger(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const url = new URL(request.url);
  const parsedState = processingLedgerStateSchema.safeParse(
    url.searchParams.get("state") ?? undefined,
  );
  if (!parsedState.success) return invalidRequestResponse(parsedState.error);
  const parsedDataClass = dataClassSchema.safeParse(
    url.searchParams.get("dataClass") ?? undefined,
  );
  if (!parsedDataClass.success) return invalidRequestResponse(parsedDataClass.error);

  try {
    const ledger = await listAdminProcessingLedger(
      { state: parsedState.data, dataClass: parsedDataClass.data },
      store,
    );
    return Response.json(
      {
        ok: true,
        ledger,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleAdminListEvaluationRuns(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const url = new URL(request.url);
  const parsedStatus = evaluationRunStatusSchema.safeParse(
    url.searchParams.get("status") ?? undefined,
  );
  if (!parsedStatus.success) return invalidRequestResponse(parsedStatus.error);
  const parsedValidity = evaluationRunValiditySchema.safeParse(
    url.searchParams.get("validity") ?? undefined,
  );
  if (!parsedValidity.success) {
    return invalidRequestResponse(parsedValidity.error);
  }

  try {
    const evaluationRuns = await listAdminEvaluationRuns(
      { status: parsedStatus.data, validity: parsedValidity.data },
      store,
    );
    return Response.json(
      {
        ok: true,
        evaluationRuns,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleAdminListLlmUsage(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
  now = new Date(),
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const url = new URL(request.url);
  const parsedRange = llmUsageRangeSchema.safeParse(
    url.searchParams.get("range") ?? undefined,
  );
  if (!parsedRange.success) return invalidRequestResponse(parsedRange.error);

  try {
    const usage = await listAdminLlmUsageSummary(
      { range: parsedRange.data },
      store,
      now,
    );
    return Response.json(
      {
        ok: true,
        usage,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
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
      const parsed = draftRejectActionSchema.safeParse(
        (await parseJson(request)) ?? {},
      );
      if (!parsed.success) return invalidRequestResponse(parsed.error);
      const draft = await rejectAdminEventDraft(draftId, store, parsed.data);
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
  const publishDecision =
    error instanceof AdminDraftPublishBlockedError
      ? error.publishDecision
      : undefined;

  return Response.json(
    publishDecision
      ? {
          ok: false,
          error: message,
          message: publishDecision.disabledReason ?? "Draft is not publishable",
          publishDecision,
        }
      : {
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
  return 500;
}
