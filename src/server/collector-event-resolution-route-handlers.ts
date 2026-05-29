import { z } from "zod";

import { authenticateCollectorRequest } from "./collector-auth";

type CollectorEventResolutionEnv = {
  [key: string]: string | undefined;
  COLLECTOR_API_KEY?: string;
};

export type EventResolutionMentionInput = {
  collectorId: string;
  eventDraftId: string;
  canonicalEventId: string;
  matchScore: number;
  matchReason: {
    decision: "same_event";
    rationale: string;
    sourceEvidence?: Record<string, unknown>;
  };
};

export type EventResolutionRevisionInput = {
  collectorId: string;
  eventDraftId: string;
  canonicalEventId: string;
  revisionType: "update" | "cancellation" | "withdrawal";
  proposedChanges: Record<string, unknown>;
  reviewState: "approved";
  sourceEvidence: {
    decision: "update_existing" | "cancel_existing" | "withdraw_existing";
    confidence: number;
    rationale: string;
    sourceEvidence?: Record<string, unknown>;
  };
};

export type CollectorEventResolutionStore = {
  recordEventMention(input: EventResolutionMentionInput): Promise<{ id: string }>;
  recordEventRevision(
    input: EventResolutionRevisionInput,
  ): Promise<{ id: string }>;
};

const proposedChangesSchema = z
  .object({
    title: z.string().min(1).optional(),
    organizer: z.string().min(1).optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    venueName: z.string().min(1).nullable().optional(),
    venueAddress: z.string().min(1).nullable().optional(),
    reservationStatus: z.enum(["required", "not_required", "unknown"]).optional(),
    registrationAction: z.string().min(1).nullable().optional(),
    registrationUrl: z.string().url().nullable().optional(),
    scheduleText: z.string().min(1).max(1_000).nullable().optional(),
    summary: z.string().min(1).max(4_000).nullable().optional(),
    entryNotes: z.string().min(1).max(4_000).nullable().optional(),
  })
  .strict();

const baseResolutionSchema = z.object({
  eventDraftId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(2_000),
  sourceEvidence: z.record(z.string().min(1), z.unknown()).optional(),
});

const sameEventResolutionSchema = baseResolutionSchema.extend({
  decision: z.literal("same_event"),
  canonicalEventId: z.string().min(1),
});

const updateResolutionSchema = baseResolutionSchema.extend({
  decision: z.literal("update_existing"),
  canonicalEventId: z.string().min(1),
  proposedChanges: proposedChangesSchema.refine(
    (input) => Object.keys(input).length > 0,
    { message: "proposedChanges must not be empty" },
  ),
});

const cancellationResolutionSchema = baseResolutionSchema.extend({
  decision: z.literal("cancel_existing"),
  canonicalEventId: z.string().min(1),
  proposedChanges: proposedChangesSchema.optional().default({}),
});

const withdrawalResolutionSchema = baseResolutionSchema.extend({
  decision: z.literal("withdraw_existing"),
  canonicalEventId: z.string().min(1),
  proposedChanges: proposedChangesSchema.optional().default({}),
});

const newEventResolutionSchema = baseResolutionSchema.extend({
  decision: z.literal("new_event"),
});

const eventResolutionSchema = z.discriminatedUnion("decision", [
  sameEventResolutionSchema,
  updateResolutionSchema,
  cancellationResolutionSchema,
  withdrawalResolutionSchema,
  newEventResolutionSchema,
]);

export async function handleCollectorEventResolution(
  request: Request,
  store: CollectorEventResolutionStore,
  env: CollectorEventResolutionEnv,
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

  const parsed = eventResolutionSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRequestResponse(parsed.error);

  if (parsed.data.decision === "new_event") {
    return Response.json({
      ok: true,
      resolution: {
        id: parsed.data.eventDraftId,
        kind: "new_event",
      },
    });
  }

  if (parsed.data.decision === "same_event") {
    const mention = await store.recordEventMention({
      collectorId: auth.collectorId,
      eventDraftId: parsed.data.eventDraftId,
      canonicalEventId: parsed.data.canonicalEventId,
      matchScore: parsed.data.confidence,
      matchReason: {
        decision: "same_event",
        rationale: parsed.data.rationale,
        sourceEvidence: parsed.data.sourceEvidence,
      },
    });
    return Response.json({
      ok: true,
      resolution: {
        id: mention.id,
        kind: "mention",
      },
    });
  }

  const revisionType = revisionTypeForDecision(parsed.data.decision);
  const revision = await store.recordEventRevision({
    collectorId: auth.collectorId,
    eventDraftId: parsed.data.eventDraftId,
    canonicalEventId: parsed.data.canonicalEventId,
    revisionType,
    proposedChanges: parsed.data.proposedChanges,
    reviewState: "approved",
    sourceEvidence: {
      decision: parsed.data.decision,
      confidence: parsed.data.confidence,
      rationale: parsed.data.rationale,
      sourceEvidence: parsed.data.sourceEvidence,
    },
  });
  return Response.json({
    ok: true,
    resolution: {
      id: revision.id,
      kind: "revision",
      revisionType,
    },
  });
}

function revisionTypeForDecision(
  decision: "update_existing" | "cancel_existing" | "withdraw_existing",
) {
  if (decision === "cancel_existing") return "cancellation" as const;
  if (decision === "withdraw_existing") return "withdrawal" as const;
  return "update" as const;
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
