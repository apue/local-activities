import { z } from "zod";

export const resolutionPromptVersion = "event-resolution-v2-2026-06-03";
export const resolutionSchemaVersionV2 = "event-resolution-v2-schema-v1";

const resolutionDecisionSchema = z
  .object({
    eventDraftId: z.string().min(1),
    decision: z.enum([
      "same_event",
      "new_event",
      "update_existing",
      "cancel_existing",
      "withdraw_existing",
      "not_public_activity",
      "insufficient_info",
    ]),
    canonicalEventId: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1),
    sourceEvidence: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      ["same_event", "update_existing", "cancel_existing", "withdraw_existing"].includes(
        value.decision,
      ) &&
      !value.canonicalEventId
    ) {
      context.addIssue({
        code: "custom",
        path: ["canonicalEventId"],
        message: "canonicalEventId is required for existing-event decisions",
      });
    }
  });

const resolutionResponseSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    decisions: z.array(resolutionDecisionSchema),
  })
  .strict();

export type EventResolutionV2Decision = z.infer<
  typeof resolutionDecisionSchema
>;

export function parseRecordedResolutionResponse(input: unknown) {
  const parsed = resolutionResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("resolution_response_invalid");
  }

  return {
    promptVersion: resolutionPromptVersion,
    schemaVersion: resolutionSchemaVersionV2,
    provider: parsed.data.provider,
    model: parsed.data.model,
    decisions: parsed.data.decisions,
  };
}

export function routeResolutionDecision(decision: EventResolutionV2Decision) {
  if (decision.decision === "same_event") {
    return {
      reviewState: "possible_duplicate" as const,
      normalReviewQueue: false,
      resolutionDecision: decision.decision,
      canonicalEventId: decision.canonicalEventId,
    };
  }

  if (
    decision.decision === "update_existing" ||
    decision.decision === "cancel_existing" ||
    decision.decision === "withdraw_existing" ||
    decision.decision === "not_public_activity" ||
    decision.decision === "insufficient_info"
  ) {
    return {
      reviewState: "needs_review" as const,
      normalReviewQueue: false,
      resolutionDecision: decision.decision,
      canonicalEventId: decision.canonicalEventId,
    };
  }

  return {
    reviewState: "ready_for_review" as const,
    normalReviewQueue: true,
    resolutionDecision: "new_event" as const,
  };
}

export function buildCandidateLookupFailureBlocker(input: { reason: string }) {
  return {
    code: "candidate_lookup_failed",
    message:
      "Candidate lookup failed; keep this draft in review and do not auto-publish.",
    sourceEvidence: {
      reason: input.reason,
    },
  };
}
