import { z } from "zod";

import {
  articleSnapshotSchema,
  collectorEnvelopeSchema,
  collectorFailureSchema,
  eventDraftUploadSchema,
  evidenceAssetSchema,
  sourceRunReportSchema,
  type ArticleSnapshot,
  type CollectorEnvelope,
  type CollectorFailure,
  type EventDraftUpload,
  type EvidenceAsset,
  type SourceRunReport,
} from "../contracts/collector";
import { authenticateCollectorRequest } from "./collector-auth";
import {
  ingestArticleSnapshot,
  ingestCollectorFailure,
  ingestEventDraft,
  ingestEvidenceAsset,
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
    ingestEventDraft,
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
    id: result.id,
  });
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
  | SourceRunReport
  | ArticleSnapshot
  | EvidenceAsset
  | EventDraftUpload
  | CollectorFailure;
