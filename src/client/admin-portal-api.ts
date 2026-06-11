export type AdminPortalApiOptions = {
  fetchImpl?: typeof fetch;
};

export async function loginAdmin({
  token,
  fetchImpl = fetch,
}: AdminPortalApiOptions & { token: string }) {
  return adminApiRequest<{ ok: true }>("/api/admin/login", {
    fetchImpl,
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function loadAdminState({
  reviewFilter,
  usageRange = "today",
  fetchImpl = fetch,
}: AdminPortalApiOptions & { reviewFilter?: string; usageRange?: string }) {
  const query = reviewFilter ? `?reviewState=${reviewFilter}` : "";
  const usageQuery = usageRange ? `?range=${encodeURIComponent(usageRange)}` : "";
  const [
    jobsResponse,
    draftsResponse,
    usageResponse,
    excludedArticlesResponse,
    ledgerResponse,
    evaluationRunsResponse,
    feedbackResponse,
    pipelineRunsResponse,
  ] = await Promise.all([
    adminApiRequest<{ jobs: unknown[] }>("/api/admin/collector-jobs", {
      fetchImpl,
    }),
    adminApiRequest<{ drafts: unknown[] }>(`/api/admin/event-drafts${query}`, {
      fetchImpl,
    }),
    adminApiRequest<{ usage: unknown }>(`/api/admin/llm-usage${usageQuery}`, {
      fetchImpl,
    }),
    adminApiRequest<{ excludedArticles: unknown[] }>(
      "/api/admin/excluded-articles",
      {
        fetchImpl,
      },
    ),
    adminApiRequest<{ ledger: unknown[] }>(
      "/api/admin/processing-ledger?dataClass=production",
      {
        fetchImpl,
      },
    ),
    adminApiRequest<{ evaluationRuns: unknown[] }>(
      "/api/admin/evaluation-runs?validity=valid",
      {
        fetchImpl,
      },
    ),
    adminApiRequest<{ feedback: unknown[] }>(
      "/api/admin/feedback?data_class=production",
      {
        fetchImpl,
      },
    ),
    adminApiRequest<{ pipelineRuns: unknown[] }>(
      "/api/admin/pipeline-runs?dataClass=production",
      {
        fetchImpl,
      },
    ),
  ]);

  return {
    jobs: jobsResponse.jobs,
    drafts: draftsResponse.drafts,
    usage: usageResponse.usage,
    excludedArticles: excludedArticlesResponse.excludedArticles,
    ledger: ledgerResponse.ledger,
    evaluationRuns: evaluationRunsResponse.evaluationRuns,
    feedback: feedbackResponse.feedback,
    pipelineRuns: pipelineRunsResponse.pipelineRuns,
  };
}

export async function patchAdminDraft({
  draftId,
  patch,
  fetchImpl = fetch,
}: AdminPortalApiOptions & {
  draftId: string;
  patch: Record<string, unknown>;
}) {
  return adminApiRequest<{ draft: unknown }>(`/api/admin/event-drafts/${draftId}`, {
    fetchImpl,
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function listAdminFeedback({
  dataClass = "production",
  pipelineRunId,
  articleBundleId,
  draftId,
  eventId,
  status,
  fetchImpl = fetch,
}: AdminPortalApiOptions & {
  dataClass?: string;
  pipelineRunId?: string;
  articleBundleId?: string;
  draftId?: string;
  eventId?: string;
  status?: string;
}) {
  const params = new URLSearchParams();
  params.set("data_class", dataClass);
  if (pipelineRunId) params.set("pipeline_run_id", pipelineRunId);
  if (articleBundleId) params.set("article_bundle_id", articleBundleId);
  if (draftId) params.set("draft_id", draftId);
  if (eventId) params.set("event_id", eventId);
  if (status) params.set("status", status);

  return adminApiRequest<{ feedback: unknown[] }>(
    `/api/admin/feedback?${params.toString()}`,
    {
      fetchImpl,
    },
  );
}

export async function createAdminFeedback({
  feedback,
  fetchImpl = fetch,
}: AdminPortalApiOptions & {
  feedback: Record<string, unknown>;
}) {
  return adminApiRequest<{ feedback: unknown }>("/api/admin/feedback", {
    fetchImpl,
    method: "POST",
    body: JSON.stringify(feedback),
  });
}

export async function adminApiRequest<T>(
  path: string,
  {
    fetchImpl = fetch,
    headers,
    ...init
  }: RequestInit & AdminPortalApiOptions = {},
) {
  const response = await fetchImpl(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
  const bodyText = await response.text();
  let body = { error: `request_failed_${response.status}` } as T & {
    error?: string;
    message?: string;
  };
  try {
    if (bodyText) {
      body = JSON.parse(bodyText) as T & {
        error?: string;
        message?: string;
      };
    }
  } catch {
    // Keep the HTTP status visible when an upstream error is not JSON.
  }
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? "request_failed");
  }
  return body;
}
