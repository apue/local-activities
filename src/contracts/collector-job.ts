import { z } from "zod";

export const collectorCapabilitySchema = z.enum([
  "wechat_browser",
  "dom_text",
  "image_capture",
  "ocr",
  "vision_extraction",
]);

export const collectorJobStateSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "expired",
]);

export const claimJobRequestSchema = z
  .object({
    collectorId: z.string().min(1),
    capabilities: z.array(collectorCapabilitySchema).min(1),
    maxJobs: z.literal(1).optional(),
  })
  .strict();

export const claimJobResponseSchema = z
  .object({
    job: z
      .object({
        jobId: z.string().min(1),
        seedUrl: z.string().url(),
        sourceId: z.string().min(1).optional(),
        requestedAt: z.string().datetime({ offset: true }),
        leaseExpiresAt: z.string().datetime({ offset: true }),
        attemptNumber: z.number().int().positive(),
        requestedMode: z
          .enum(["auto", "text_only", "image_heavy_debug"])
          .optional(),
      })
      .strict()
      .nullable(),
    retryAfterSeconds: z.number().int().positive().optional(),
  })
  .strict();

export const heartbeatRequestSchema = z
  .object({
    collectorId: z.string().min(1),
    localRunId: z.string().min(1),
    stage: z.enum(["capturing", "extracting", "uploading"]),
    message: z.string().min(1).max(2_000).optional(),
    extendLeaseSeconds: z.number().int().positive().max(600).optional(),
  })
  .strict();

export const suggestedDispositionSchema = z.enum([
  "ready_for_review",
  "needs_review",
  "needs_info",
  "failed",
  "not_activity",
]);

export const jobReportRequestSchema = z
  .object({
    collectorId: z.string().min(1),
    localRunId: z.string().min(1),
    status: z.enum(["completed", "partial", "failed"]),
    sourceRunId: z.string().min(1).optional(),
    articleSnapshotIds: z.array(z.string().min(1)).optional(),
    eventDraftIds: z.array(z.string().min(1)).optional(),
    evidenceAssetIds: z.array(z.string().min(1)).optional(),
    failureIds: z.array(z.string().min(1)).optional(),
    suggestedDisposition: suggestedDispositionSchema.optional(),
    message: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export type CollectorCapability = z.infer<typeof collectorCapabilitySchema>;
export type CollectorJobState = z.infer<typeof collectorJobStateSchema>;
export type ClaimJobRequest = z.infer<typeof claimJobRequestSchema>;
export type ClaimJobResponse = z.infer<typeof claimJobResponseSchema>;
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type JobReportRequest = z.infer<typeof jobReportRequestSchema>;
export type SuggestedDisposition = z.infer<typeof suggestedDispositionSchema>;
