import { z } from "zod";

import type { ArticleSnapshot, CollectorEnvelope } from "../contracts/collector";
import { createStableCollectorObjectId } from "./collector-ingest-service";

export const triagePromptVersion = "event-triage-2026-06-03";
export const triageSchemaVersion = "event-triage-schema-v1";

const excludedDecisions = [
  "official_visit",
  "non_public_news",
  "internal_or_private",
  "not_event",
  "unsupported",
] as const;

const triageResponseSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    schemaVersion: z.string().min(1).optional(),
    content: z
      .object({
        triageDecision: z.enum([
          "public_activity",
          "possible_public_activity",
          ...excludedDecisions,
        ]),
        triageAction: z.enum(["extract", "review", "exclude"]),
        confidence: z.number().min(0).max(1),
        publicSignals: z.array(z.string().min(1)).default([]),
        exclusionSignals: z.array(z.string().min(1)).default([]),
        publicEligibility: z.enum(["public", "not_public", "unclear"]),
        eventKind: z.enum([
          "single",
          "multi_day",
          "long_running",
          "recurring",
          "news",
          "visit",
          "cancellation",
          "unsupported",
        ]),
        exclusionReason: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const route = routeTriageDecision(value.content).route;
    if (route === "exclude" && value.content.triageAction !== "exclude") {
      context.addIssue({
        code: "custom",
        path: ["content", "triageAction"],
        message: "excluded decisions must use exclude action",
      });
    }
    if (route !== "exclude" && value.content.triageAction === "exclude") {
      context.addIssue({
        code: "custom",
        path: ["content", "triageAction"],
        message: "public decisions must not use exclude action",
      });
    }
  });

export type EditorialTriageDecision = ReturnType<
  typeof parseRecordedTriageResponse
>;

export function parseRecordedTriageResponse(input: unknown) {
  const parsed = triageResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("triage_response_invalid");
  }

  return {
    promptVersion: triagePromptVersion,
    schemaVersion: triageSchemaVersion,
    provider: parsed.data.provider,
    model: parsed.data.model,
    triageDecision: parsed.data.content.triageDecision,
    triageAction: parsed.data.content.triageAction,
    confidence: parsed.data.content.confidence,
    publicSignals: parsed.data.content.publicSignals,
    exclusionSignals: parsed.data.content.exclusionSignals,
    publicEligibility: parsed.data.content.publicEligibility,
    eventKind: parsed.data.content.eventKind,
    exclusionReason: parsed.data.content.exclusionReason,
  };
}

export function routeTriageDecision(input: {
  triageDecision: EditorialTriageDecision["triageDecision"];
}) {
  if (input.triageDecision === "public_activity") {
    return {
      route: "extract" as const,
      canAutoPublishFromTriage: false,
    };
  }
  if (input.triageDecision === "possible_public_activity") {
    return {
      route: "review_then_extract" as const,
      canAutoPublishFromTriage: false,
    };
  }
  return {
    route: "exclude" as const,
    canAutoPublishFromTriage: false,
  };
}

export function buildExcludedArticleEnvelope(input: {
  collectorId: string;
  runId: string;
  observedAt: string;
  articleSnapshot: ArticleSnapshot;
  triage: EditorialTriageDecision;
}): CollectorEnvelope<{
  articleUrl: string;
  triageAttemptId: string;
  triageDecision:
    | "official_visit"
    | "non_public_news"
    | "internal_or_private"
    | "not_event"
    | "unsupported";
  triageAction: "exclude";
  confidence: number;
  publicSignals: string[];
  exclusionSignals: string[];
  exclusionReason: string;
  evidenceAssetIds: string[];
  promptVersion: string;
  schemaVersion: string;
  provider: string;
  model: string;
}> {
  const route = routeTriageDecision(input.triage);
  if (route.route !== "exclude") {
    throw new Error("triage_decision_not_excluded");
  }

  return {
    collectorId: input.collectorId,
    runId: input.runId,
    observedAt: input.observedAt,
    payloadVersion: "2026-05-collector-v1",
    payload: {
      articleUrl: input.articleSnapshot.canonicalUrl,
      triageAttemptId: createStableCollectorObjectId("triage", [
        input.runId,
        input.articleSnapshot.canonicalUrl,
        input.triage.promptVersion,
      ]),
      triageDecision: input.triage.triageDecision as
        | "official_visit"
        | "non_public_news"
        | "internal_or_private"
        | "not_event"
        | "unsupported",
      triageAction: "exclude",
      confidence: input.triage.confidence,
      publicSignals: input.triage.publicSignals,
      exclusionSignals: input.triage.exclusionSignals,
      exclusionReason:
        input.triage.exclusionReason ??
        `Triage classified article as ${input.triage.triageDecision}.`,
      evidenceAssetIds: input.articleSnapshot.evidenceAssetIds,
      promptVersion: input.triage.promptVersion,
      schemaVersion: input.triage.schemaVersion,
      provider: input.triage.provider,
      model: input.triage.model,
    },
  };
}
