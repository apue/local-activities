import { z } from "zod";

import type { EditorialTriageDecision } from "./editorial-triage-service";
import { routeTriageDecision } from "./editorial-triage-service";

export const extractionPromptVersion = "event-extraction-v2-2026-06-03";
export const extractionSchemaVersionV2 = "event-extraction-v2-schema-v1";

const publishBlockerSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    evidenceAssetIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const extractedEventCandidateSchema = z
  .object({
    eventId: z.string().min(1),
    title: z.string().min(1),
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
    scheduleKind: z.enum([
      "single",
      "multi_day",
      "long_running",
      "recurring",
      "unsupported",
    ]),
    scheduleText: z.string().min(1),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    timezone: z.literal("Asia/Shanghai"),
    city: z.literal("Beijing"),
    venueName: z.string().min(1).optional(),
    venueAddress: z.string().min(1).optional(),
    reservationStatus: z.enum(["required", "not_required", "unknown"]),
    registrationRequirement: z
      .enum(["required", "not_required", "unknown"])
      .optional(),
    registrationAction: z.string().min(1).optional(),
    registrationUrl: z.string().url().optional(),
    posterAssetId: z.string().min(1).optional(),
    qrAssetId: z.string().min(1).optional(),
    registrationQrAssetId: z.string().min(1).optional(),
    recurrenceRule: z.string().min(1).optional(),
    occurrenceStartsAt: z.array(z.string().datetime({ offset: true })).optional(),
    confidence: z.number().min(0).max(1),
    hardBlockers: z.array(publishBlockerSchema).default([]),
    softBlockers: z.array(publishBlockerSchema).default([]),
    fieldEvidence: z.record(z.string(), z.array(z.string().min(1))).optional(),
  })
  .strict();

const extractionResponseSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    schemaVersion: z.string().min(1).optional(),
    events: z.array(extractedEventCandidateSchema),
  })
  .strict();

export type ExtractedEventCandidate = z.infer<
  typeof extractedEventCandidateSchema
>;

export function parseRecordedExtractionResponse(input: unknown) {
  const parsed = extractionResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("extraction_response_invalid");
  }

  return {
    promptVersion: extractionPromptVersion,
    schemaVersion: extractionSchemaVersionV2,
    provider: parsed.data.provider,
    model: parsed.data.model,
    eventCandidates: parsed.data.events,
  };
}

export function runRecordedExtractionFromTriage(input: {
  triage: EditorialTriageDecision;
  extractionResponse: unknown;
}) {
  const route = routeTriageDecision(input.triage);
  if (route.route === "exclude") {
    return {
      route: "excluded" as const,
      eventCandidates: [] as ExtractedEventCandidate[],
    };
  }

  const extraction = parseRecordedExtractionResponse(input.extractionResponse);
  return {
    route: "extracted" as const,
    ...extraction,
  };
}
