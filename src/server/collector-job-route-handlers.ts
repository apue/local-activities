import { z } from "zod";

import {
  claimJobRequestSchema,
  heartbeatRequestSchema,
  jobReportRequestSchema,
} from "../contracts/collector-job";
import { authenticateCollectorRequest } from "./collector-auth";
import {
  claimCollectorJob,
  heartbeatCollectorJob,
  reportCollectorJob,
  type CollectorJobRecord,
  type CollectorJobStore,
} from "./collector-job-service";

type CollectorEnv = {
  [key: string]: string | undefined;
  COLLECTOR_API_KEY?: string;
};

export async function handleClaimCollectorJob(
  request: Request,
  store: CollectorJobStore,
  env: CollectorEnv,
  now = new Date(),
) {
  const auth = authenticateCollectorRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const body = await parseJson(request);
  const parsed = claimJobRequestSchema.safeParse(body);
  if (!parsed.success) return invalidRequestResponse(parsed.error);
  if (parsed.data.collectorId !== auth.collectorId) {
    return collectorIdMismatchResponse();
  }

  const result = await claimCollectorJob(
    {
      collectorId: auth.collectorId,
    },
    store,
    now,
  );

  if (result.kind === "none") {
    return Response.json({
      job: null,
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }

  return Response.json({
    job: toClaimResponseJob(result.job),
  });
}

export async function handleHeartbeatCollectorJob(
  request: Request,
  jobId: string,
  store: CollectorJobStore,
  env: CollectorEnv,
  now = new Date(),
) {
  const auth = authenticateCollectorRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const body = await parseJson(request);
  const parsed = heartbeatRequestSchema.safeParse(body);
  if (!parsed.success) return invalidRequestResponse(parsed.error);
  if (parsed.data.collectorId !== auth.collectorId) {
    return collectorIdMismatchResponse();
  }

  const result = await heartbeatCollectorJob(jobId, parsed.data, store, now);
  if (result.kind !== "updated") return mutationErrorResponse(result);

  return Response.json({
    ok: true,
    jobId: result.job.jobId,
    leaseExpiresAt: result.job.leaseExpiresAt,
  });
}

export async function handleReportCollectorJob(
  request: Request,
  jobId: string,
  store: CollectorJobStore,
  env: CollectorEnv,
  now = new Date(),
) {
  const auth = authenticateCollectorRequest(request, env);
  if (!auth.ok) return authErrorResponse(auth);

  const body = await parseJson(request);
  const parsed = jobReportRequestSchema.safeParse(body);
  if (!parsed.success) return invalidRequestResponse(parsed.error);
  if (parsed.data.collectorId !== auth.collectorId) {
    return collectorIdMismatchResponse();
  }

  const result = await reportCollectorJob(jobId, parsed.data, store, now);
  if (result.kind !== "updated") return mutationErrorResponse(result);

  return Response.json({
    ok: true,
    jobId: result.job.jobId,
    status: result.job.state,
  });
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function authErrorResponse(
  auth: Exclude<ReturnType<typeof authenticateCollectorRequest>, { ok: true }>,
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

function collectorIdMismatchResponse() {
  return Response.json(
    {
      ok: false,
      error: "collector_id_mismatch",
    },
    { status: 403 },
  );
}

function mutationErrorResponse(
  result: Exclude<
    Awaited<ReturnType<typeof heartbeatCollectorJob>>,
    { kind: "updated" }
  >,
) {
  const status =
    result.kind === "not_found" ? 404 : result.kind === "expired" ? 409 : 409;

  return Response.json(
    {
      ok: false,
      error: result.error,
    },
    { status },
  );
}

function toClaimResponseJob(job: CollectorJobRecord) {
  return {
    jobId: job.jobId,
    seedUrl: job.seedUrl,
    sourceId: job.sourceId,
    requestedAt: job.requestedAt,
    leaseExpiresAt: job.leaseExpiresAt,
    attemptNumber: job.attemptNumber,
    requestedMode: job.requestedMode,
    preferredRunner: job.preferredRunner,
    actualRunner: job.actualRunner,
    runnerState: job.runnerState,
    fallbackEligible: job.fallbackEligible,
    fallbackReason: job.fallbackReason,
  };
}
