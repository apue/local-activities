import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ArticleSnapshot,
  CollectorEnvelope,
  CollectorFailure,
  EventDraftUpload,
  ExcludedArticleUpload,
  EvidenceAsset,
  SourceCandidate,
  SourceRunReport,
} from "../contracts/collector";
import {
  computeDraftReviewState,
  createStableCollectorObjectId,
  type DraftBackendRouting,
  type CollectorIngestStore,
} from "./collector-ingest-service";
import { getSupabaseAdminClient } from "./supabase-admin";

export function getSupabaseCollectorIngestStore(
  client = getSupabaseAdminClient(),
): CollectorIngestStore {
  return new SupabaseCollectorIngestStore(client);
}

class SupabaseCollectorIngestStore implements CollectorIngestStore {
  constructor(private readonly client: SupabaseClient) {}

  async upsertSourceCandidate(envelope: CollectorEnvelope<SourceCandidate>) {
    const payload = envelope.payload;
    const row = await this.writeOne<{ id: number }>(
      this.client
        .from("sources")
        .upsert(
          {
            source_key: payload.sourceKey,
            name: payload.name ?? null,
            homepage_url: payload.homepageUrl ?? null,
            seed_url: payload.seedUrl ?? null,
            platform: payload.platform,
            health_status: "checking",
          },
          { onConflict: "source_key" },
        )
        .select("id")
        .single(),
    );

    return { id: String(row.id) };
  }

  async upsertSourceRun(envelope: CollectorEnvelope<SourceRunReport>) {
    const payload = envelope.payload;
    const row = await this.writeOne<{ id: number }>(
      this.client
        .from("source_runs")
        .upsert(
          {
            collector_id: envelope.collectorId,
            run_id: envelope.runId,
            source_id: parseOptionalNumericId(payload.sourceId),
            seed_url: payload.seedUrl ?? null,
            status: payload.status,
            started_at: payload.startedAt,
            finished_at: payload.finishedAt ?? null,
            checked_url_count: payload.checkedUrlCount,
            article_count: payload.articleCount,
            draft_count: payload.draftCount,
            failure_count: payload.failureCount,
            failure_reason: payload.failureReason ?? null,
            diagnostics: payload.diagnostics ?? [],
          },
          { onConflict: "collector_id,run_id" },
        )
        .select("id")
        .single(),
    );

    return { id: String(row.id) };
  }

  async upsertArticleSnapshot(envelope: CollectorEnvelope<ArticleSnapshot>) {
    const payload = envelope.payload;
    const sourceRunId = await this.findSourceRunId(envelope);
    const row = await this.writeOne<{ id: number }>(
      this.client
        .from("article_snapshots")
        .upsert(
          {
            source_id: parseOptionalNumericId(payload.sourceId),
            source_run_id: sourceRunId,
            canonical_url: payload.canonicalUrl,
            final_url: payload.finalUrl,
            title: payload.title ?? null,
            author_name: payload.authorName ?? null,
            published_at: payload.publishedAt ?? null,
            captured_at: payload.capturedAt,
            language_hints: payload.languageHints,
            capture_mode: payload.captureMode,
            visible_text: payload.visibleText ?? null,
            text_hash: payload.textHash ?? null,
            screenshot_asset_id: payload.screenshotAssetId ?? null,
            evidence_asset_ids: payload.evidenceAssetIds,
            content_hash: payload.contentHash,
          },
          { onConflict: "canonical_url,content_hash" },
        )
        .select("id")
        .single(),
    );

    return { id: String(row.id) };
  }

  async upsertEvidenceAsset(envelope: CollectorEnvelope<EvidenceAsset>) {
    const payload = envelope.payload;
    const row = await this.writeOne<{ id: number }>(
      this.client
        .from("evidence_assets")
        .upsert(
          {
            asset_id: payload.assetId,
            article_url: payload.articleUrl,
            role: payload.role,
            media_type: payload.mediaType,
            source_url: payload.sourceUrl ?? null,
            storage_path: payload.storagePath ?? null,
            width: payload.width ?? null,
            height: payload.height ?? null,
            content_hash: payload.contentHash,
            text_content: payload.textContent ?? null,
            extracted_by: payload.extractedBy ?? null,
            confidence: payload.confidence ?? null,
          },
          { onConflict: "article_url,role,content_hash" },
        )
        .select("id")
        .single(),
    );

    return { id: String(row.id) };
  }

  async upsertEventDraft(
    envelope: CollectorEnvelope<EventDraftUpload>,
    options?: { reviewState: DraftBackendRouting["reviewState"] },
  ) {
    const payload = envelope.payload;
    const sourceRunId = await this.findSourceRunId(envelope);
    const draftRow = {
      draft_id: createStableCollectorObjectId("draft", [
        payload.articleUrl,
        payload.extractionAttemptId,
      ]),
      source_id: parseOptionalNumericId(payload.sourceId),
      source_run_id: sourceRunId,
      article_url: payload.articleUrl,
      extraction_attempt_id: payload.extractionAttemptId,
      capture_mode: payload.captureMode,
      triage_decision: payload.triageDecision ?? null,
      triage_action: payload.triageAction ?? null,
      triage_confidence: payload.triageConfidence ?? null,
      public_signals: payload.publicSignals ?? [],
      exclusion_signals: payload.exclusionSignals ?? [],
      public_eligibility: payload.publicEligibility ?? null,
      event_kind: payload.eventKind ?? null,
      schedule_kind: payload.scheduleKind ?? null,
      title: payload.title ?? null,
      original_title: payload.originalTitle ?? null,
      organizer: payload.organizer ?? null,
      starts_at: payload.startsAt ?? null,
      ends_at: payload.endsAt ?? null,
      recurrence_rule: payload.recurrenceRule ?? null,
      occurrence_starts_at: payload.occurrenceStartsAt ?? null,
      timezone: payload.timezone,
      venue_name: payload.venueName ?? null,
      venue_address: payload.venueAddress ?? null,
      city: payload.city,
      reservation_status: payload.reservationStatus ?? null,
      registration_action: payload.registrationAction ?? null,
      registration_url: payload.registrationUrl ?? null,
      schedule_text: payload.scheduleText ?? null,
      poster_asset_id: payload.posterAssetId ?? null,
      qr_asset_id: payload.qrAssetId ?? null,
      registration_qr_asset_id: payload.registrationQrAssetId ?? null,
      poster_image_url: payload.posterImageUrl ?? null,
      poster_image_alt: payload.posterImageAlt ?? null,
      poster_image_source_url: payload.posterImageSourceUrl ?? null,
      summary: payload.summary ?? null,
      entry_notes: payload.entryNotes ?? null,
      signals: payload.signals,
      evidence_asset_ids: payload.evidenceAssetIds,
      field_evidence: payload.fieldEvidence,
      confidence: payload.confidence,
      hard_blockers: payload.hardBlockers ?? [],
      soft_blockers: payload.softBlockers ?? [],
      resolution_decision: payload.resolutionDecision ?? null,
      review_state: options?.reviewState ?? computeDraftReviewState(payload),
    };
    const row = await this.writeOneWithOptionalPosterFallback<{ id: number }>(
      draftRow,
      (rowPayload) =>
        this.client
          .from("event_drafts")
          .upsert(rowPayload, { onConflict: "article_url,extraction_attempt_id" })
          .select("id")
          .single(),
    );

    return { id: String(row.id) };
  }

  async publishEventDraft(input: {
    payload: EventDraftUpload;
    publishedAt: string;
  }) {
    const payload = input.payload;
    const eventId = createStableCollectorObjectId("event", [
      payload.articleUrl,
      payload.extractionAttemptId,
    ]);
    const eventRow = {
      event_id: eventId,
      title: payload.title,
      organizer: payload.organizer ?? null,
      starts_at: payload.startsAt,
      ends_at: payload.endsAt ?? null,
      timezone: payload.timezone,
      city: payload.city,
      venue_name: payload.venueName ?? null,
      venue_address: payload.venueAddress ?? null,
      reservation_status: payload.reservationStatus ?? "unknown",
      registration_action: payload.registrationAction ?? null,
      registration_url: payload.registrationUrl ?? null,
      schedule_text: payload.scheduleText ?? null,
      triage_decision: payload.triageDecision ?? null,
      public_eligibility: payload.publicEligibility ?? null,
      event_kind: payload.eventKind ?? null,
      schedule_kind: payload.scheduleKind ?? null,
      recurrence_rule: payload.recurrenceRule ?? null,
      occurrence_starts_at: payload.occurrenceStartsAt ?? null,
      poster_asset_id: payload.posterAssetId ?? null,
      qr_asset_id: payload.qrAssetId ?? null,
      registration_qr_asset_id: payload.registrationQrAssetId ?? null,
      source_url: payload.articleUrl,
      poster_image_url: payload.posterImageUrl ?? null,
      poster_image_alt: payload.posterImageAlt ?? null,
      poster_image_source_url: payload.posterImageSourceUrl ?? null,
      summary: payload.summary ?? null,
      entry_notes: payload.entryNotes ?? null,
      hard_blockers: payload.hardBlockers ?? [],
      soft_blockers: payload.softBlockers ?? [],
      resolution_decision: payload.resolutionDecision ?? null,
      status: "published",
      review_state: "approved",
      published_at: input.publishedAt,
      updated_at: input.publishedAt,
    };
    const row = await this.writeOneWithOptionalPosterFallback<{
      event_id: string;
    }>(eventRow, (rowPayload) =>
      this.client
        .from("canonical_events")
        .upsert(rowPayload, { onConflict: "event_id" })
        .select("event_id")
        .single(),
    );
    return { id: row.event_id };
  }

  async upsertExcludedArticle(
    envelope: CollectorEnvelope<ExcludedArticleUpload>,
  ) {
    const payload = envelope.payload;
    const sourceRunId = await this.findSourceRunId(envelope);
    const row = await this.writeOne<{ id: number }>(
      this.client
        .from("excluded_articles")
        .upsert(
          {
            excluded_article_id: createStableCollectorObjectId("excluded", [
              payload.articleUrl,
              payload.triageAttemptId,
            ]),
            source_id: parseOptionalNumericId(payload.sourceId),
            source_run_id: sourceRunId,
            article_url: payload.articleUrl,
            triage_attempt_id: payload.triageAttemptId,
            triage_decision: payload.triageDecision,
            triage_action: payload.triageAction,
            confidence: payload.confidence,
            public_signals: payload.publicSignals,
            exclusion_signals: payload.exclusionSignals,
            exclusion_reason: payload.exclusionReason,
            evidence_asset_ids: payload.evidenceAssetIds,
            prompt_version: payload.promptVersion,
            schema_version: payload.schemaVersion,
            provider: payload.provider,
            model: payload.model,
            processing_state: "excluded",
          },
          { onConflict: "article_url,triage_attempt_id" },
        )
        .select("id")
        .single(),
    );

    return { id: String(row.id) };
  }

  async upsertCollectorFailure(
    envelope: CollectorEnvelope<CollectorFailure> & { failureId: string },
  ) {
    const payload = envelope.payload;
    const sourceRunId = await this.findSourceRunId(envelope);
    const row = await this.writeOne<{ id: number }>(
      this.client
        .from("collector_failures")
        .upsert(
          {
            failure_id: envelope.failureId,
            source_id: parseOptionalNumericId(payload.sourceId),
            source_run_id: sourceRunId,
            article_url: payload.articleUrl ?? null,
            stage: payload.stage,
            reason: payload.reason,
            message: payload.message,
            retryable: payload.retryable,
            screenshot_asset_id: payload.screenshotAssetId ?? null,
            diagnostics: payload.diagnostics ?? [],
          },
          { onConflict: "failure_id" },
        )
        .select("id")
        .single(),
    );

    return { id: String(row.id) };
  }

  private async findSourceRunId(envelope: {
    collectorId: string;
    runId: string;
  }) {
    const { data, error } = await this.client
      .from("source_runs")
      .select("id")
      .eq("collector_id", envelope.collectorId)
      .eq("run_id", envelope.runId)
      .maybeSingle<{ id: number }>();

    if (error) throw new Error("source_run_lookup_failed");
    return data?.id ?? null;
  }

  private async writeOne<T>(
    request: PromiseLike<{ data: T | null; error: unknown }>,
  ) {
    const { data, error } = await request;
    if (error || !data) throw new Error("collector_ingest_write_failed");
    return data;
  }

  private async writeOneWithOptionalPosterFallback<T>(
    payload: Record<string, unknown>,
    buildRequest: (
      payload: Record<string, unknown>,
    ) => PromiseLike<{ data: T | null; error: unknown }>,
  ) {
    let { data, error } = await buildRequest(payload);
    if (error && isMissingOptionalPosterColumnError(error)) {
      ({ data, error } = await buildRequest(withoutOptionalPosterColumns(payload)));
    }
    if (error || !data) throw new Error("collector_ingest_write_failed");
    return data;
  }
}

function parseOptionalNumericId(id: string | undefined) {
  if (!id) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function withoutOptionalPosterColumns(payload: Record<string, unknown>) {
  const {
    poster_image_url: _posterImageUrl,
    poster_image_alt: _posterImageAlt,
    poster_image_source_url: _posterImageSourceUrl,
    ...rest
  } = payload;
  return rest;
}

function isMissingOptionalPosterColumnError(error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : String(error ?? "");
  return (
    message.includes("poster_image_url") ||
    message.includes("poster_image_alt") ||
    message.includes("poster_image_source_url")
  );
}
