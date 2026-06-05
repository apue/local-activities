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
  fetchImpl = fetch,
}: AdminPortalApiOptions & { reviewFilter?: string }) {
  const query = reviewFilter ? `?reviewState=${reviewFilter}` : "";
  const [jobsResponse, draftsResponse, usageResponse] = await Promise.all([
    adminApiRequest<{ jobs: unknown[] }>("/api/admin/collector-jobs", {
      fetchImpl,
    }),
    adminApiRequest<{ drafts: unknown[] }>(`/api/admin/event-drafts${query}`, {
      fetchImpl,
    }),
    adminApiRequest<{ usage: unknown }>("/api/admin/llm-usage", {
      fetchImpl,
    }),
  ]);

  return {
    jobs: jobsResponse.jobs,
    drafts: draftsResponse.drafts,
    usage: usageResponse.usage,
  };
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
