import { z } from "zod";

import { collectorJobFallbackReasonSchema } from "../contracts/collector-job";
import { authenticateInternalRequest } from "./internal-auth";
import {
  routeSandboxCollectorJobFailure,
  type CollectorJobStore,
} from "./collector-job-service";

type InternalEnv = {
  [key: string]: string | undefined;
  INTERNAL_API_SECRET?: string;
};

const sandboxFailureSchema = z
  .object({
    reason: collectorJobFallbackReasonSchema,
    message: z.string().min(1).max(2_000),
    sandboxRunId: z.string().min(1).optional(),
  })
  .strict();

export async function handleSandboxFailureReport(
  request: Request,
  jobId: string,
  store: CollectorJobStore,
  env: InternalEnv,
  now = new Date(),
) {
  const auth = authenticateInternalRequest(request, env);
  if (!auth.ok) {
    return Response.json(
      {
        ok: false,
        error: auth.error,
      },
      { status: auth.status },
    );
  }

  const parsed = sandboxFailureSchema.safeParse(await parseJson(request));
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: "invalid_request",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const result = await routeSandboxCollectorJobFailure(
    jobId,
    parsed.data,
    store,
    now,
  );
  if (result.kind !== "updated") {
    return Response.json(
      {
        ok: false,
        error: result.error,
      },
      { status: result.kind === "not_found" ? 404 : 409 },
    );
  }

  return Response.json({
    ok: true,
    job: result.job,
  });
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
