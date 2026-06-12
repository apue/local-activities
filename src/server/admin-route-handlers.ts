import { z } from "zod";

import { adminSessionCookie } from "./admin-auth";
import { authenticateAdminRequest } from "./admin-auth";
import {
  AdminDraftPublishBlockedError,
  activateAdminPromptModelConfig,
  createAdminFeedback,
  createAdminPromptModelConfig,
  getAdminActivePromptModelConfig,
  getAdminEventDraftDetail,
  listAdminFeedback,
  listAdminCollectorJobs,
  listAdminEvaluationRuns,
  listAdminExcludedArticles,
  listAdminEventDrafts,
  listAdminLlmUsageSummary,
  listAdminPipelineRuns,
  listAdminPromptModelConfigs,
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
const llmUsageStatusSchema = z.enum(["succeeded", "failed"]);
const llmUsageFiltersSchema = z
  .object({
    dataClass: z.enum(["production", "eval", "test", "smoke"]).optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    operation: z.string().min(1).optional(),
    status: llmUsageStatusSchema.optional(),
    sourceId: z.string().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    articleBundleId: z.string().min(1).optional(),
  })
  .strict();

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

const pipelineRunStatusSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_:-]*$/)
  .optional();

const dataClassSchema = z
  .enum(["production", "eval", "test", "smoke"])
  .optional()
  .default("production");

const promptModelOperationSchema = z.enum([
  "cheap_triage",
  "full_extract",
  "editor_pass",
  "judge_eval",
  "eval",
]);

const promptModelConfigStageSchema = z
  .enum(["active", "candidate", "archived"])
  .optional();

const feedbackTypeSchema = z.enum([
  "not_event",
  "not_public",
  "should_publish",
  "missing_event",
  "wrong_time",
  "wrong_location",
  "missing_registration",
  "missing_qr",
  "duplicate_event",
  "bad_summary",
  "bad_category_or_tags",
  "other",
]);

const feedbackStatusSchema = z
  .enum(["open", "triaged", "resolved", "dismissed"])
  .optional();

const jsonObjectSchema = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  { message: "Expected a JSON object." },
);

const configObjectSchema = jsonObjectSchema.refine(
  (value) => !containsSensitiveConfigKey(value),
  { message: "Config objects must not contain secrets." },
);

const promptModelConfigCreateSchema = z
  .object({
    dataClass: z
      .enum(["production", "eval", "test", "smoke"])
      .default("production"),
    operation: promptModelOperationSchema,
    provider: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(300),
    promptVersion: z.string().trim().min(1).max(300),
    promptText: z.string().trim().min(1).max(100_000),
    schemaVersion: z.string().trim().min(1).max(300),
    params: configObjectSchema.default({}),
    budgetPolicy: configObjectSchema.default({}),
    createdReason: z.string().trim().min(1).max(4_000),
    createdBy: z.string().trim().min(1).max(200).default("admin"),
    metadata: configObjectSchema.default({}),
  })
  .strict();

const promptModelConfigActivationSchema = z
  .object({
    dataClass: z
      .enum(["production", "eval", "test", "smoke"])
      .default("production"),
    operation: promptModelOperationSchema,
    evalRunId: z.string().trim().min(1).max(300),
    activationReason: z.string().trim().min(1).max(4_000),
  })
  .strict();

const feedbackCreateSchema = z
  .object({
    dataClass: z
      .enum(["production", "eval", "test", "smoke"])
      .default("production"),
    feedbackType: feedbackTypeSchema,
    evalRunId: z.string().trim().min(1).max(300).optional(),
    caseId: z.string().trim().min(1).max(300).optional(),
    pipelineRunId: z.string().trim().min(1).max(200).optional(),
    articleBundleId: z.string().trim().min(1).max(200).optional(),
    draftId: z.string().trim().min(1).max(200).optional(),
    eventId: z.string().trim().min(1).max(200).optional(),
    fieldName: z.string().trim().min(1).max(200).optional(),
    oldValue: z.unknown().optional(),
    correctedValue: z.unknown().optional(),
    reason: z.string().trim().min(1).max(4_000).optional(),
    createdBy: z.string().trim().min(1).max(200).default("admin"),
    metadata: jsonObjectSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        value.pipelineRunId ||
          value.evalRunId ||
          value.caseId ||
          value.articleBundleId ||
          value.draftId ||
          value.eventId,
      ),
    {
      message:
        "Feedback must be linked to an eval run, case, pipeline run, article bundle, draft, or event.",
    },
  );

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

export async function handleAdminListPipelineRuns(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const url = new URL(request.url);
  const parsedDataClass = dataClassSchema.safeParse(
    url.searchParams.get("dataClass") ?? undefined,
  );
  if (!parsedDataClass.success) return invalidRequestResponse(parsedDataClass.error);
  const parsedStatus = pipelineRunStatusSchema.safeParse(
    url.searchParams.get("status") ?? undefined,
  );
  if (!parsedStatus.success) return invalidRequestResponse(parsedStatus.error);

  try {
    const pipelineRuns = await listAdminPipelineRuns(
      { dataClass: parsedDataClass.data, status: parsedStatus.data },
      store,
    );
    return Response.json(
      {
        ok: true,
        pipelineRuns,
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

export async function handleAdminListPromptModelConfigs(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const url = new URL(request.url);
  const parsedDataClass = dataClassSchema.safeParse(
    optionalSearchParam(url, "data_class") ??
      optionalSearchParam(url, "dataClass") ??
      undefined,
  );
  if (!parsedDataClass.success) {
    return invalidRequestResponse(parsedDataClass.error);
  }
  const parsedOperation = promptModelOperationSchema.optional().safeParse(
    optionalSearchParam(url, "operation"),
  );
  if (!parsedOperation.success) {
    return invalidRequestResponse(parsedOperation.error);
  }
  const parsedStage = promptModelConfigStageSchema.safeParse(
    optionalSearchParam(url, "stage"),
  );
  if (!parsedStage.success) return invalidRequestResponse(parsedStage.error);

  try {
    const configs = await listAdminPromptModelConfigs(
      {
        dataClass: parsedDataClass.data,
        operation: parsedOperation.data,
        stage: parsedStage.data,
      },
      store,
    );
    return Response.json(
      {
        ok: true,
        configs,
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

export async function handleAdminGetActivePromptModelConfig(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const url = new URL(request.url);
  const parsedDataClass = dataClassSchema.safeParse(
    optionalSearchParam(url, "data_class") ??
      optionalSearchParam(url, "dataClass") ??
      undefined,
  );
  if (!parsedDataClass.success) {
    return invalidRequestResponse(parsedDataClass.error);
  }
  const parsedOperation = promptModelOperationSchema.safeParse(
    optionalSearchParam(url, "operation"),
  );
  if (!parsedOperation.success) {
    return invalidRequestResponse(parsedOperation.error);
  }

  try {
    const config = await getAdminActivePromptModelConfig(
      {
        dataClass: parsedDataClass.data,
        operation: parsedOperation.data,
      },
      store,
    );
    return Response.json(
      {
        ok: true,
        config,
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

export async function handleAdminCreatePromptModelConfig(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const parsed = promptModelConfigCreateSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRequestResponse(parsed.error);

  try {
    const config = await createAdminPromptModelConfig(
      {
        ...parsed.data,
        createdBy: "admin",
      },
      store,
    );
    return Response.json({
      ok: true,
      config,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function handleAdminActivatePromptModelConfig(
  request: Request,
  configId: string,
  store: AdminStore,
  env: AdminEnv,
  now = new Date(),
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const parsed = promptModelConfigActivationSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRequestResponse(parsed.error);

  try {
    const config = await activateAdminPromptModelConfig(
      {
        configId,
        ...parsed.data,
      },
      store,
      now,
    );
    return Response.json({
      ok: true,
      config,
    });
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
  const parsedFilters = llmUsageFiltersSchema.safeParse({
    dataClass: optionalSearchParam(url, "data_class"),
    provider: optionalSearchParam(url, "provider"),
    model: optionalSearchParam(url, "model"),
    operation: optionalSearchParam(url, "operation"),
    status: optionalSearchParam(url, "status"),
    sourceId: optionalSearchParam(url, "source_id"),
    sourceUrl: optionalSearchParam(url, "source_url"),
    articleBundleId: optionalSearchParam(url, "article_bundle_id"),
  });
  if (!parsedFilters.success) return invalidRequestResponse(parsedFilters.error);

  try {
    const usage = await listAdminLlmUsageSummary(
      { range: parsedRange.data, filters: parsedFilters.data },
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

export async function handleAdminListFeedback(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const url = new URL(request.url);
  const parsedDataClass = dataClassSchema.safeParse(
    optionalSearchParam(url, "data_class") ??
      optionalSearchParam(url, "dataClass") ??
      undefined,
  );
  if (!parsedDataClass.success) {
    return invalidRequestResponse(parsedDataClass.error);
  }
  const parsedStatus = feedbackStatusSchema.safeParse(
    optionalSearchParam(url, "status"),
  );
  if (!parsedStatus.success) return invalidRequestResponse(parsedStatus.error);

  try {
    const feedback = await listAdminFeedback(
      {
        dataClass: parsedDataClass.data,
        evalRunId:
          optionalSearchParam(url, "eval_run_id") ??
          optionalSearchParam(url, "evalRunId"),
        caseId:
          optionalSearchParam(url, "case_id") ??
          optionalSearchParam(url, "caseId"),
        pipelineRunId: optionalSearchParam(url, "pipeline_run_id"),
        articleBundleId: optionalSearchParam(url, "article_bundle_id"),
        draftId: optionalSearchParam(url, "draft_id"),
        eventId: optionalSearchParam(url, "event_id"),
        status: parsedStatus.data,
      },
      store,
    );
    return Response.json(
      {
        ok: true,
        feedback,
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

export async function handleAdminCreateFeedback(
  request: Request,
  store: AdminStore,
  env: AdminEnv,
) {
  const auth = authenticateAdminRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const parsed = feedbackCreateSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRequestResponse(parsed.error);

  try {
    const feedback = await createAdminFeedback(
      {
        ...parsed.data,
        createdBy: "admin",
      },
      store,
    );
    return Response.json({
      ok: true,
      feedback,
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

function optionalSearchParam(url: URL, name: string) {
  const value = url.searchParams.get(name);
  return value && value.trim() ? value.trim() : undefined;
}

function containsSensitiveConfigKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveConfigKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nestedValue]) => {
    if (isSensitiveConfigKey(key)) return true;
    return containsSensitiveConfigKey(nestedValue);
  });
}

function isSensitiveConfigKey(key: string) {
  const normalized = key.toLowerCase();
  return normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie" ||
    normalized === "apikey" ||
    normalized === "api_key" ||
    normalized === "api-key" ||
    normalized === "x-api-key" ||
    normalized === "secret" ||
    normalized.endsWith("_secret") ||
    normalized.endsWith("-secret") ||
    normalized === "password" ||
    normalized === "token" ||
    normalized === "access_token" ||
    normalized === "refresh_token" ||
    normalized === "id_token";
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
