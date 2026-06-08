import { z } from "zod";

export const collectorPayloadVersion = "2026-05-collector-v1" as const;

export const failureReasonSchema = z.enum([
  "fetch_blocked",
  "fetch_timeout",
  "region_network_failed",
  "login_required",
  "captcha_required",
  "parser_mismatch",
  "source_identity_missing",
  "activity_fields_missing",
  "image_download_failed",
  "analysis_config_missing",
  "analysis_request_failed",
  "analysis_response_invalid_schema",
  "not_activity",
  "unsupported",
]);

export const diagnosticSummarySchema = z
  .object({
    key: z.string().min(1),
    value: z.string().min(1).max(2_000),
  })
  .strict();

export const collectorEnvelopeSchema = <Payload extends z.ZodType>(
  payload: Payload,
) =>
  z
    .object({
      collectorId: z.string().min(1),
      runId: z.string().min(1),
      observedAt: z.string().datetime({ offset: true }),
      payloadVersion: z.literal(collectorPayloadVersion),
      payload,
    })
    .strict();

export const sourceRunStatusSchema = z.enum(["success", "partial", "failed"]);

export const sourceCandidateSchema = z
  .object({
    sourceKey: z.string().min(1),
    name: z.string().min(1).optional(),
    homepageUrl: z.string().url().optional(),
    seedUrl: z.string().url().optional(),
    platform: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    diagnostics: z.array(diagnosticSummarySchema).optional(),
  })
  .strict();

export const sourceRunReportSchema = z
  .object({
    sourceId: z.string().min(1).optional(),
    seedUrl: z.string().url().optional(),
    status: sourceRunStatusSchema,
    startedAt: z.string().datetime({ offset: true }),
    finishedAt: z.string().datetime({ offset: true }).optional(),
    checkedUrlCount: z.number().int().nonnegative(),
    articleCount: z.number().int().nonnegative(),
    draftCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    failureReason: failureReasonSchema.optional(),
    diagnostics: z.array(diagnosticSummarySchema).optional(),
  })
  .strict();

export const captureModeSchema = z.enum([
  "text_complete",
  "text_with_qr_registration",
  "image_dominant",
  "image_with_qr_registration",
  "not_activity",
  "unsupported",
]);

export const articleSnapshotSchema = z
  .object({
    sourceId: z.string().min(1).optional(),
    sourceName: z.string().min(1).optional(),
    canonicalUrl: z.string().url(),
    finalUrl: z.string().url(),
    title: z.string().min(1).optional(),
    authorName: z.string().min(1).optional(),
    publishedAt: z.string().datetime({ offset: true }).optional(),
    capturedAt: z.string().datetime({ offset: true }),
    languageHints: z.array(z.string().min(1)),
    captureMode: captureModeSchema,
    visibleText: z.string().max(40_000).optional(),
    textHash: z.string().min(1).optional(),
    screenshotAssetId: z.string().min(1).optional(),
    evidenceAssetIds: z.array(z.string().min(1)),
    contentHash: z.string().min(1),
  })
  .strict();

export const evidenceRoleSchema = z.enum([
  "cover",
  "poster",
  "qr",
  "registration",
  "screenshot",
  "article_image",
  "ocr_text",
  "visual_analysis_summary",
]);

export const evidenceAssetSchema = z
  .object({
    assetId: z.string().min(1),
    articleUrl: z.string().url(),
    role: evidenceRoleSchema,
    mediaType: z.enum(["image", "text", "html_summary"]),
    sourceUrl: z.string().url().optional(),
    storagePath: z.string().min(1).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    contentHash: z.string().min(1),
    textContent: z.string().max(20_000).optional(),
    extractedBy: z.enum(["dom", "ocr", "vision", "manual"]).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const collectorFailureSchema = z
  .object({
    sourceId: z.string().min(1).optional(),
    articleUrl: z.string().url().optional(),
    stage: z.enum([
      "source_discovery",
      "page_fetch",
      "dom_parse",
      "image_capture",
      "bundle_validation",
      "analysis",
    ]),
    reason: failureReasonSchema,
    message: z.string().min(1).max(2_000),
    retryable: z.boolean(),
    screenshotAssetId: z.string().min(1).optional(),
    diagnostics: z.array(diagnosticSummarySchema).optional(),
  })
  .strict();

export type CollectorEnvelope<T> = z.infer<
  ReturnType<typeof collectorEnvelopeSchema<z.ZodType<T>>>
>;
export type SourceCandidate = z.infer<typeof sourceCandidateSchema>;
export type SourceRunReport = z.infer<typeof sourceRunReportSchema>;
export type ArticleSnapshot = z.infer<typeof articleSnapshotSchema>;
export type EvidenceAsset = z.infer<typeof evidenceAssetSchema>;
export type CollectorFailure = z.infer<typeof collectorFailureSchema>;
