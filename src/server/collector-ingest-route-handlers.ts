import { z } from "zod";

import {
  articleSnapshotSchema,
  collectorEnvelopeSchema,
  collectorFailureSchema,
  eventDraftUploadSchema,
  evidenceAssetSchema,
  sourceCandidateSchema,
  sourceRunReportSchema,
  type ArticleSnapshot,
  type CollectorEnvelope,
  type CollectorFailure,
  type EventDraftUpload,
  type EvidenceAsset,
  type SourceCandidate,
  type SourceRunReport,
} from "../contracts/collector";
import { authenticateCollectorRequest } from "./collector-auth";
import {
  ingestArticleSnapshot,
  ingestCollectorFailure,
  ingestEventDraft,
  ingestEvidenceAsset,
  ingestSourceCandidate,
  ingestSourceRun,
  type CollectorIngestStore,
} from "./collector-ingest-service";

type CollectorEnv = {
  [key: string]: string | undefined;
  COLLECTOR_API_KEY?: string;
};

export function handleSourceRunIngest(
  request: Request,
  store: CollectorIngestStore,
  env: CollectorEnv,
) {
  return handleCollectorIngest(
    request,
    store,
    env,
    sourceRunReportSchema,
    ingestSourceRun,
  );
}

export function handleSourceCandidateIngest(
  request: Request,
  store: CollectorIngestStore,
  env: CollectorEnv,
) {
  return handleCollectorIngest(
    request,
    store,
    env,
    sourceCandidateSchema,
    ingestSourceCandidate,
  );
}

export function handleArticleSnapshotIngest(
  request: Request,
  store: CollectorIngestStore,
  env: CollectorEnv,
) {
  return handleCollectorIngest(
    request,
    store,
    env,
    articleSnapshotSchema,
    ingestArticleSnapshot,
  );
}

export function handleEvidenceAssetIngest(
  request: Request,
  store: CollectorIngestStore,
  env: CollectorEnv,
) {
  return handleCollectorIngest(
    request,
    store,
    env,
    evidenceAssetSchema,
    ingestEvidenceAsset,
  );
}

export function handleEventDraftIngest(
  request: Request,
  store: CollectorIngestStore,
  env: CollectorEnv,
) {
  return handleCollectorIngest(
    request,
    store,
    env,
    eventDraftUploadSchema,
    (envelope, ingestStore) =>
      ingestEventDraft(envelope, ingestStore, readDraftBackendPolicy(env)),
  );
}

export function handleCollectorFailureIngest(
  request: Request,
  store: CollectorIngestStore,
  env: CollectorEnv,
) {
  return handleCollectorIngest(
    request,
    store,
    env,
    collectorFailureSchema,
    ingestCollectorFailure,
  );
}

async function handleCollectorIngest<Payload extends IngestPayload>(
  request: Request,
  store: CollectorIngestStore,
  env: CollectorEnv,
  payloadSchema: z.ZodType<Payload>,
  ingest: (
    envelope: CollectorEnvelope<Payload>,
    store: CollectorIngestStore,
  ) => Promise<{ id: string }>,
) {
  const auth = authenticateCollectorRequest(request, env);
  if (!auth.ok) {
    return Response.json(
      {
        ok: false,
        error: auth.error,
      },
      { status: auth.status },
    );
  }

  const parsed = collectorEnvelopeSchema(payloadSchema).safeParse(
    await parseJson(request),
  );
  if (!parsed.success) {
    return invalidRequestResponse(parsed.error);
  }
  if (parsed.data.collectorId !== auth.collectorId) {
    return Response.json(
      {
        ok: false,
        error: "collector_id_mismatch",
      },
      { status: 403 },
    );
  }

  const result = await ingest(parsed.data, store);
  return Response.json({
    ok: true,
    ...result,
  });
}

function readDraftBackendPolicy(env: CollectorEnv) {
  const threshold = Number.parseFloat(
    env.BACKEND_AUTO_PUBLISH_CONFIDENCE_THRESHOLD ?? "",
  );
  return {
    autoPublishEnabled: env.BACKEND_AUTO_PUBLISH_ENABLED === "true",
    autoPublishConfidenceThreshold: Number.isFinite(threshold)
      ? threshold
      : undefined,
  };
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
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

type IngestPayload =
  | SourceCandidate
  | SourceRunReport
  | ArticleSnapshot
  | EvidenceAsset
  | EventDraftUpload
  | CollectorFailure;
