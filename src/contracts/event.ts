import { z } from "zod";

export const publicEventStatusSchema = z.enum([
  "draft",
  "published",
  "cancelled",
  "withdrawn",
]);

export const canonicalEventReviewStateSchema = z.enum([
  "needs_review",
  "needs_info",
  "possible_duplicate",
  "approved",
  "rejected",
]);

export const canonicalPublicEligibilitySchema = z.enum([
  "public",
  "not_public",
  "unclear",
]);

export const canonicalEventKindSchema = z.enum([
  "single",
  "multi_day",
  "long_running",
  "recurring",
  "news",
  "visit",
  "cancellation",
  "unsupported",
]);

export const canonicalScheduleKindSchema = z.enum([
  "single",
  "multi_day",
  "long_running",
  "recurring",
  "unsupported",
]);

export const canonicalResolutionDecisionSchema = z.enum([
  "new_event",
  "same_event",
  "update_existing",
  "cancel_existing",
  "withdraw_existing",
  "not_public_activity",
  "insufficient_info",
]);

export const canonicalPublishBlockerSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    evidenceAssetIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const canonicalEventSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    organizer: z.string().min(1).optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).optional(),
    timezone: z.literal("Asia/Shanghai"),
    city: z.literal("Beijing"),
    venueName: z.string().min(1).optional(),
    venueAddress: z.string().min(1).optional(),
    reservationStatus: z.enum(["required", "not_required", "unknown"]),
    registrationAction: z.string().min(1).optional(),
    registrationUrl: z.string().url().optional(),
    sourceUrl: z.string().url(),
    scheduleText: z.string().min(1).max(1_000).optional(),
    publicEligibility: canonicalPublicEligibilitySchema.optional(),
    eventKind: canonicalEventKindSchema.optional(),
    scheduleKind: canonicalScheduleKindSchema.optional(),
    recurrenceRule: z.string().min(1).max(1_000).optional(),
    occurrenceStartsAt: z.array(z.string().datetime({ offset: true })).optional(),
    posterAssetId: z.string().min(1).optional(),
    qrAssetId: z.string().min(1).optional(),
    registrationQrAssetId: z.string().min(1).optional(),
    hardBlockers: z.array(canonicalPublishBlockerSchema).optional(),
    softBlockers: z.array(canonicalPublishBlockerSchema).optional(),
    operatorOverrideReason: z.string().min(1).max(2_000).optional(),
    resolutionDecision: canonicalResolutionDecisionSchema.optional(),
    posterImageUrl: z.string().url().optional(),
    posterImageAlt: z.string().min(1).max(500).optional(),
    posterImageSourceUrl: z.string().url().optional(),
    registrationQrImageUrl: z.string().url().optional(),
    registrationQrImageAlt: z.string().min(1).max(500).optional(),
    summary: z.string().min(1).max(4_000).optional(),
    entryNotes: z.string().min(1).max(4_000).optional(),
    status: publicEventStatusSchema,
    reviewState: canonicalEventReviewStateSchema,
  })
  .strict();

export type PublicEventStatus = z.infer<typeof publicEventStatusSchema>;
export type CanonicalEventReviewState = z.infer<
  typeof canonicalEventReviewStateSchema
>;
export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
