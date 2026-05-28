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

export const canonicalEventSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    organizer: z.string().min(1),
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
