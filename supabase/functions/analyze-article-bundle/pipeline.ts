import { readArticleBundle } from "./bundle.ts";
import {
  buildProviderInput,
  parseProviderOutput,
  promptVersion,
  schemaVersion,
} from "./provider.ts";
import type {
  AnalysisOutput,
  AnalysisProvider,
  AnalyzeRequest,
  ArticleBundle,
  BundleImage,
  DatabaseWriter,
  EvidenceSelection,
  ExtractedEvent,
  StorageReader,
  UsageMetrics,
} from "./types.ts";

const evidenceBucket = "event-evidence-assets";
const articleBundleBucket = "article-bundles";
type WrittenEvidenceAsset = {
  assetId: string;
  role: string;
  publicUrl?: string;
};

export async function runAnalysisPipeline({
  request,
  storage,
  db,
  provider,
  env,
}: {
  request: AnalyzeRequest;
  storage: StorageReader;
  db: DatabaseWriter;
  provider: AnalysisProvider;
  env?: { provider?: string; model?: string };
}): Promise<{ status: string; ledgerState: string }> {
  const providerName = env?.provider ?? provider.name;
  const model = env?.model ?? provider.model;
  const existingBundle = await db.findArticleBundle?.(
    request.bundleId,
    request.dataClass,
  );
  if (existingBundle?.status === "processed") {
    return { status: "processed", ledgerState: "processed" };
  }
  const startResult = await writeArticleBundle(
    db,
    request,
    "analysis_started",
    undefined,
  );
  if (startResult !== "written") {
    const status = startResult === "skipped_processed"
      ? "processed"
      : "in_progress";
    return { status, ledgerState: status };
  }
  const attemptId = crypto.randomUUID();
  const usageId = id(`usage-${attemptId}`, request.bundleId);
  const ledgerId = id(`ledger-${attemptId}`, request.bundleId);

  let bundle: ArticleBundle | undefined;
  let lastUsage: UsageMetrics = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  try {
    bundle = await readArticleBundle(storage, {
      storagePrefix: request.storagePrefix,
    });
    const input = buildProviderInput({ request, bundle });
    const providerResponse = await provider.analyze(input);
    lastUsage = usageMetrics(providerResponse.usage);
    const output = parseProviderOutput(providerResponse);
    lastUsage = output.usage;
    await writeUsage(db, {
      usageId,
      request,
      providerName,
      model,
      status: "succeeded",
      usage: output.usage,
    });
    const writeResult = await writeAnalysisOutput({
      db,
      storage,
      request,
      bundle,
      output,
      usageId,
      ledgerId,
      providerName,
      model,
    });
    await markArticleBundleProcessed({ db, request, bundle });
    return { status: writeResult.state, ledgerState: writeResult.state };
  } catch (error) {
    await writeUsage(db, {
      usageId,
      request,
      providerName,
      model,
      status: "failed",
      usage: lastUsage,
      errorCode: errorCode(error),
      metadata: { error: errorDetails(error) },
    });
    await writeUnique(db, "processing_ledger", {
      ledger_id: ledgerId,
      article_bundle_id: request.bundleId,
      source_url: request.sourceUrl,
      content_hash: request.contentHash,
      state: "failed",
      decision: "failed",
      reason: errorMessage(error),
      confidence: 0,
      provider: providerName,
      model,
      prompt_version: promptVersion,
      schema_version: schemaVersion,
      usage_id: usageId,
      data_class: request.dataClass,
      eval_run_id: request.evalRunId,
      error_details: errorDetails(error),
      metadata: { storagePrefix: request.storagePrefix },
    }, "ledger_id");
    await writeArticleBundle(db, request, "failed", bundle);
    return { status: "failed", ledgerState: "failed" };
  }
}

async function markArticleBundleProcessed({
  db,
  request,
  bundle,
}: {
  db: DatabaseWriter;
  request: AnalyzeRequest;
  bundle?: ArticleBundle;
}) {
  try {
    await writeArticleBundle(db, request, "processed", bundle);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "article_bundle_status_update_failed",
      bundleId: request.bundleId,
      error: errorDetails(error),
    }));
  }
}

async function writeAnalysisOutput({
  db,
  storage,
  request,
  bundle,
  output,
  usageId,
  ledgerId,
  providerName,
  model,
}: {
  db: DatabaseWriter;
  storage: StorageReader;
  request: AnalyzeRequest;
  bundle: ArticleBundle;
  output: AnalysisOutput;
  usageId: string;
  ledgerId: string;
  providerName: string;
  model: string;
}): Promise<{ state: string }> {
  if (output.decision === "excluded" || output.events.length === 0) {
    const excludedId = id("excluded", request.bundleId);
    await writeUnique(db, "excluded_articles", {
      excluded_article_id: excludedId,
      data_class: request.dataClass,
      eval_run_id: request.evalRunId,
      article_url: request.sourceUrl,
      bundle_id: request.bundleId,
      triage_decision: output.excludedArticle?.triageDecision ?? "not_event",
      triage_action: "exclude",
      confidence: output.confidence,
      public_signals: output.excludedArticle?.publicSignals ?? [],
      exclusion_signals: output.excludedArticle?.exclusionSignals ?? [],
      exclusion_reason: output.excludedArticle?.exclusionReason ??
        output.reason,
      evidence_asset_ids: [],
      prompt_version: promptVersion,
      schema_version: schemaVersion,
      provider: providerName,
      model,
    }, "excluded_article_id");
    await writeLedger(db, {
      request,
      output,
      usageId,
      ledgerId,
      providerName,
      model,
      state: "excluded",
      excludedArticleId: excludedId,
    });
    return { state: "excluded" };
  }

  const draftIds: string[] = [];
  let firstCanonicalEventId: string | undefined;
  for (let index = 0; index < output.events.length; index += 1) {
    const event = output.events[index];
    const evidenceAssetIds = await writeEvidenceAssets({
      db,
      storage,
      request,
      bundle,
      event,
      providerName,
      model,
      eventIndex: index,
    });
    const draftId = id(`draft-${index + 1}`, request.bundleId);
    draftIds.push(draftId);
    const poster = evidenceAssetIds.find((asset) => asset.role === "poster");
    const qr = evidenceAssetIds.find((asset) =>
      asset.role === "qr" || asset.role === "registration"
    );
    const candidates = await db.findCanonicalCandidates?.(event, request) ?? [];
    const dedupeDecision = candidates.length > 0
      ? "same_event"
      : output.dedupe.decision;
    let eventCanonicalEventId: string | undefined;
    const shouldCreateCanonicalEvent =
      dedupeDecision === "new_event" && canCreateCanonicalEvent(event);
    await writeUnique(
      db,
      "event_drafts",
      draftPayload({
        draftId,
        request,
        event,
        evidenceAssetIds: evidenceAssetIds.map((asset) => asset.assetId),
        poster,
        qr,
        providerName,
        model,
        dedupeDecision,
        shouldCreateCanonicalEvent,
      }),
      "draft_id",
    );
    if (shouldCreateCanonicalEvent) {
      eventCanonicalEventId = id(`event-${index + 1}`, request.bundleId);
      firstCanonicalEventId ??= eventCanonicalEventId;
      await writeUnique(
        db,
        "canonical_events",
        canonicalPayload({
          eventId: eventCanonicalEventId,
          request,
          event,
          poster,
          qr,
        }),
        "event_id",
      );
    }
    await writeUnique(db, "dedupe_decisions", {
      dedupe_id: id(`dedupe-${index + 1}`, request.bundleId),
      data_class: request.dataClass,
      eval_run_id: request.evalRunId,
      article_bundle_id: request.bundleId,
      draft_id: draftId,
      canonical_event_id: eventCanonicalEventId,
      decision: dedupeDecision,
      confidence: output.dedupe.confidence ?? event.confidence ??
        output.confidence,
      candidate_count: candidates.length,
      candidates,
      reasoning: output.dedupe.reasoning,
      provider: providerName,
      model,
      prompt_version: promptVersion,
      schema_version: schemaVersion,
    }, "dedupe_id");
  }

  const ledgerState = firstCanonicalEventId
    ? "published"
    : output.decision === "published"
    ? "needs_review"
    : output.decision;
  await writeLedger(db, {
    request,
    output,
    usageId,
    ledgerId,
    providerName,
    model,
    state: ledgerState,
    draftId: draftIds[0],
    canonicalEventId: firstCanonicalEventId,
  });
  return { state: ledgerState };
}

function canCreateCanonicalEvent(event: ExtractedEvent): boolean {
  if (!hasRequiredPublicFields(event)) return false;
  if (event.publicEligibility === "not_public") return false;
  if (!isPublicActivity(event)) return false;
  if (hasExcludedEventKind(event)) return false;
  if (event.scheduleKind === "unsupported") return false;
  if (missingRequiredRegistrationEvidence(event)) return false;

  if (event.publish?.createCanonicalEvent && event.publicEligibility === "public") {
    return true;
  }

  return isHighConfidencePublicActivity(event);
}

function hasRequiredPublicFields(event: ExtractedEvent): boolean {
  return Boolean(
    event.title &&
      event.startsAt &&
      event.organizer &&
      (event.venueName || event.venueAddress) &&
      isBeijingEvent(event),
  );
}

function isPublicActivity(event: ExtractedEvent): boolean {
  return event.triageDecision === "public_activity" &&
    event.triageAction === "extract";
}

function hasExcludedEventKind(event: ExtractedEvent): boolean {
  return ["news", "visit", "cancellation", "unsupported"].includes(
    event.eventKind ?? "",
  );
}

function missingRequiredRegistrationEvidence(event: ExtractedEvent): boolean {
  if (event.reservationStatus !== "required") return false;
  return !event.registrationAction &&
    !event.registrationUrl &&
    !(event.evidence ?? []).some((selection) =>
      selection.role === "qr" || selection.role === "registration"
    );
}

function isHighConfidencePublicActivity(event: ExtractedEvent): boolean {
  return (event.confidence ?? 0) >= 0.95 &&
    ["public", "unclear", undefined].includes(event.publicEligibility);
}

function isBeijingEvent(event: ExtractedEvent): boolean {
  const city = String(event.city ?? "").trim().toLowerCase();
  return city === "beijing" || city === "北京" || city === "北京市";
}

async function writeArticleBundle(
  db: DatabaseWriter,
  request: AnalyzeRequest,
  status: "analysis_started" | "processed" | "failed",
  bundle?: ArticleBundle,
): Promise<"written" | "skipped_existing" | "skipped_processed"> {
  const manifest = bundle?.manifest ?? {};
  const payload = {
    bundle_id: request.bundleId,
    bundle_version: stringValue(manifest.bundleVersion) ?? "article-bundle-v1",
    source_provider: request.sourceProvider,
    source_id: request.sourceId,
    source_name: request.sourceName,
    source_url: request.sourceUrl,
    canonical_url: stringValue(manifest.canonicalUrl) ?? request.sourceUrl,
    published_at: request.publishedAt,
    captured_at: stringValue(manifest.capturedAt) ?? undefined,
    content_hash: request.contentHash,
    storage_bucket: "article-bundles",
    storage_prefix: request.storagePrefix,
    image_count: bundle?.images.length ?? 0,
    link_count: bundle?.links.length ?? 0,
    diagnostics: bundle?.diagnostics ?? [],
    data_class: request.dataClass,
    eval_run_id: request.evalRunId,
    status,
  };
  if (db.writeArticleBundle) {
    return await db.writeArticleBundle(payload, status);
  }
  if (db.upsert) {
    await db.upsert("article_bundles", payload, { onConflict: "bundle_id" });
  } else await db.insert("article_bundles", payload);
  return "written";
}

async function writeUnique(
  db: DatabaseWriter,
  table: string,
  payload: Record<string, unknown>,
  onConflict: string,
) {
  if (db.upsert) await db.upsert(table, payload, { onConflict });
  else await db.insert(table, payload);
}

async function writeUsage(
  db: DatabaseWriter,
  {
    usageId,
    request,
    providerName,
    model,
    status,
    usage,
    errorCode,
    metadata = {},
  }: {
    usageId: string;
    request: AnalyzeRequest;
    providerName: string;
    model: string;
    status: "succeeded" | "failed";
    usage: UsageMetrics;
    errorCode?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await writeUnique(db, "llm_usage_ledger", {
    usage_id: usageId,
    operation: "analyze_article_bundle",
    provider: providerName,
    model,
    status,
    source_id: request.sourceId,
    source_url: request.sourceUrl,
    prompt_version: promptVersion,
    schema_version: schemaVersion,
    params: { responseFormat: "json_object" },
    error_code: errorCode,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    cached_input_tokens: usage.cachedInputTokens ?? 0,
    reasoning_output_tokens: usage.reasoningOutputTokens ?? 0,
    latency_ms: usage.latencyMs,
    article_bundle_id: request.bundleId,
    data_class: request.dataClass,
    eval_run_id: request.evalRunId,
    metadata,
  }, "usage_id");
}

async function writeEvidenceAssets({
  db,
  storage,
  request,
  bundle,
  event,
  providerName,
  model,
  eventIndex,
}: {
  db: DatabaseWriter;
  storage: StorageReader;
  request: AnalyzeRequest;
  bundle: ArticleBundle;
  event: ExtractedEvent;
  providerName: string;
  model: string;
  eventIndex: number;
}) {
  const assets: WrittenEvidenceAsset[] = [];
  for (const selection of evidenceSelectionsForEvent({ event, bundle })) {
    const image = bundle.images.find((candidate) =>
      candidate.imageId === selection.imageId
    );
    if (!image) continue;
    const assetId = id(
      `evidence-${eventIndex + 1}-${selection.role}-${image.imageId}`,
      request.bundleId,
    );
    const stableLocation = await stableEvidenceLocation({
      storage,
      request,
      image,
      assetId,
    });
    await writeUnique(db, "evidence_assets", {
      asset_id: assetId,
      data_class: request.dataClass,
      eval_run_id: request.evalRunId,
      article_url: request.sourceUrl,
      bundle_id: request.bundleId,
      role: selection.role,
      media_type: "image",
      source_url: image.sourceUrl,
      storage_bucket: evidenceBucket,
      storage_path: stableLocation?.storagePath,
      public_url: stableLocation?.publicUrl,
      width: image.width,
      height: image.height,
      content_hash: image.contentHash ?? request.contentHash,
      extracted_by: "vision",
      confidence: selection.confidence,
      metadata: {
        imageId: image.imageId,
        contentType: image.contentType,
        altText: image.altText,
        nearbyText: image.nearbyText,
        roleHint: image.roleHint,
        hasBytes: image.hasBytes,
        bundleStoragePath: image.storagePath,
        stableAssetAvailable: Boolean(stableLocation?.publicUrl),
        provider: providerName,
        model,
      },
    }, "asset_id");
    assets.push({
      assetId,
      role: selection.role,
      publicUrl: stableLocation?.publicUrl,
    });
  }
  return assets;
}

function evidenceSelectionsForEvent({
  event,
  bundle,
}: {
  event: ExtractedEvent;
  bundle: ArticleBundle;
}): EvidenceSelection[] {
  const imageIds = new Set(bundle.images.map((image) => image.imageId));
  const selections: EvidenceSelection[] = [];
  const seenRoles = new Set<string>();
  for (const selection of event.evidence ?? []) {
    if (!imageIds.has(selection.imageId)) continue;
    selections.push(selection);
    seenRoles.add(selection.role);
  }
  const registrationImage = imageForUrl(bundle, event.registrationUrl);
  if (registrationImage && !seenRoles.has("qr")) {
    selections.push({
      imageId: registrationImage.imageId,
      role: "qr",
      confidence: 0.7,
    });
    seenRoles.add("qr");
  }
  for (const image of bundle.images) {
    const role = fallbackEvidenceRole(image.roleHint);
    if (!role || seenRoles.has(role)) continue;
    seenRoles.add(role);
    selections.push({
      imageId: image.imageId,
      role,
      confidence: 0.55,
    });
  }
  return selections;
}

function imageForUrl(
  bundle: ArticleBundle,
  url: string | undefined,
): BundleImage | undefined {
  const target = normalizeEvidenceUrl(url);
  if (!target) return undefined;
  return bundle.images.find((image) =>
    normalizeEvidenceUrl(image.sourceUrl) === target
  );
}

function normalizeEvidenceUrl(url: string | undefined): string | undefined {
  const text = stringValue(url);
  if (!text) return undefined;
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return text;
  }
}

function fallbackEvidenceRole(
  roleHint: string | undefined,
): EvidenceSelection["role"] | undefined {
  if (roleHint === "poster" || roleHint === "cover") return "poster";
  if (roleHint === "qr" || roleHint === "registration") return roleHint;
  return undefined;
}

function draftPayload({
  draftId,
  request,
  event,
  evidenceAssetIds,
  poster,
  qr,
  providerName,
  model,
  dedupeDecision,
  shouldCreateCanonicalEvent,
}: {
  draftId: string;
  request: AnalyzeRequest;
  event: ExtractedEvent;
  evidenceAssetIds: string[];
  poster?: WrittenEvidenceAsset;
  qr?: WrittenEvidenceAsset;
  providerName: string;
  model: string;
  dedupeDecision: string;
  shouldCreateCanonicalEvent: boolean;
}) {
  return {
    draft_id: draftId,
    data_class: request.dataClass,
    eval_run_id: request.evalRunId,
    article_url: request.sourceUrl,
    bundle_id: request.bundleId,
    title: event.title,
    original_title: event.originalTitle,
    organizer: event.organizer,
    starts_at: event.startsAt,
    ends_at: event.endsAt,
    timezone: event.timezone ?? "Asia/Shanghai",
    city: event.city ?? "Beijing",
    venue_name: event.venueName,
    venue_address: event.venueAddress,
    reservation_status: event.reservationStatus ?? "unknown",
    registration_action: event.registrationAction,
    registration_url: event.registrationUrl,
    schedule_text: event.scheduleText,
    poster_image_url: poster?.publicUrl,
    registration_qr_image_url: qr?.publicUrl,
    summary: event.summary,
    entry_notes: event.entryNotes,
    triage_decision: event.triageDecision,
    triage_action: event.triageAction,
    triage_confidence: event.confidence,
    public_signals: event.publicSignals ?? [],
    exclusion_signals: event.exclusionSignals ?? [],
    public_eligibility: event.publicEligibility,
    event_kind: event.eventKind,
    schedule_kind: event.scheduleKind,
    recurrence_rule: event.recurrenceRule,
    occurrence_starts_at: event.occurrenceStartsAt ?? [],
    poster_asset_id: poster?.assetId,
    qr_asset_id: qr?.assetId,
    registration_qr_asset_id: qr?.assetId,
    resolution_decision: dedupeDecision,
    confidence: event.confidence ?? 0,
    review_state: shouldCreateCanonicalEvent
      ? "approved"
      : dedupeDecision === "same_event"
      ? "possible_duplicate"
      : "needs_review",
    evidence_asset_ids: evidenceAssetIds,
    field_evidence: event.fieldEvidence ?? {},
    prompt_version: promptVersion,
    schema_version: schemaVersion,
    provider: providerName,
    model,
  };
}

function canonicalPayload({
  eventId,
  request,
  event,
  poster,
  qr,
}: {
  eventId: string;
  request: AnalyzeRequest;
  event: ExtractedEvent;
  poster?: WrittenEvidenceAsset;
  qr?: WrittenEvidenceAsset;
}) {
  return {
    event_id: eventId,
    data_class: request.dataClass,
    eval_run_id: request.evalRunId,
    title: event.title,
    organizer: event.organizer,
    starts_at: event.startsAt,
    ends_at: event.endsAt,
    timezone: event.timezone ?? "Asia/Shanghai",
    city: event.city ?? "Beijing",
    venue_name: event.venueName,
    venue_address: event.venueAddress,
    reservation_status: event.reservationStatus ?? "unknown",
    registration_action: event.registrationAction,
    registration_url: event.registrationUrl,
    source_url: request.sourceUrl,
    schedule_text: event.scheduleText,
    triage_decision: event.triageDecision,
    public_eligibility: event.publicEligibility,
    event_kind: event.eventKind,
    schedule_kind: event.scheduleKind,
    recurrence_rule: event.recurrenceRule,
    occurrence_starts_at: event.occurrenceStartsAt ?? [],
    poster_asset_id: poster?.assetId,
    qr_asset_id: qr?.assetId,
    registration_qr_asset_id: qr?.assetId,
    resolution_decision: "new_event",
    poster_image_url: poster?.publicUrl,
    registration_qr_image_url: qr?.publicUrl,
    summary: event.summary,
    entry_notes: event.entryNotes,
    status: "published",
    review_state: "approved",
    published_at: new Date().toISOString(),
  };
}

async function writeLedger(
  db: DatabaseWriter,
  {
    request,
    output,
    usageId,
    ledgerId,
    providerName,
    model,
    state,
    draftId,
    canonicalEventId,
    excludedArticleId,
  }: {
    request: AnalyzeRequest;
    output: AnalysisOutput;
    usageId: string;
    ledgerId: string;
    providerName: string;
    model: string;
    state: string;
    draftId?: string;
    canonicalEventId?: string;
    excludedArticleId?: string;
  },
) {
  await writeUnique(db, "processing_ledger", {
    ledger_id: ledgerId,
    article_bundle_id: request.bundleId,
    source_url: request.sourceUrl,
    content_hash: request.contentHash,
    state,
    decision: output.decision,
    reason: output.reason,
    confidence: output.confidence,
    provider: providerName,
    model,
    prompt_version: promptVersion,
    schema_version: schemaVersion,
    usage_id: usageId,
    draft_id: draftId,
    canonical_event_id: canonicalEventId,
    excluded_article_id: excludedArticleId,
    data_class: request.dataClass,
    eval_run_id: request.evalRunId,
    metadata: {
      storagePrefix: request.storagePrefix,
      dedupe: output.dedupe,
    },
  }, "ledger_id");
}

async function stableEvidenceLocation({
  storage,
  request,
  image,
  assetId,
}: {
  storage: StorageReader;
  request: AnalyzeRequest;
  image: BundleImage;
  assetId: string;
}): Promise<{ storagePath?: string; publicUrl: string } | undefined> {
  const publicUrl = stringValue(image.publicUrl);
  const marker = `/storage/v1/object/public/${evidenceBucket}/`;
  const markerIndex = publicUrl?.indexOf(marker) ?? -1;
  if (publicUrl && markerIndex >= 0) {
    const pathFromUrl =
      publicUrl.slice(markerIndex + marker.length).split(/[?#]/)[0];
    return {
      storagePath: stringValue(image.storagePath) ?? pathFromUrl,
      publicUrl,
    };
  }
  if (!image.hasBytes) return undefined;
  if (
    !storage.downloadBytes || !storage.uploadBytes || !storage.createPublicUrl
  ) {
    throw new Error("evidence_storage_bytes_unsupported");
  }
  const sourcePath = image.bundleStoragePath ?? image.storagePath;
  const bytes = await storage.downloadBytes(articleBundleBucket, sourcePath);
  if (!bytes) throw new Error(`evidence_image_bytes_missing:${sourcePath}`);
  const targetPath = evidenceStoragePath({
    dataClass: request.dataClass,
    bundleId: request.bundleId,
    assetId,
    contentType: image.contentType,
  });
  await storage.uploadBytes(evidenceBucket, targetPath, bytes, {
    contentType: image.contentType ?? "application/octet-stream",
    upsert: true,
  });
  return {
    storagePath: targetPath,
    publicUrl: await storage.createPublicUrl(evidenceBucket, targetPath),
  };
}

function evidenceStoragePath({
  dataClass,
  bundleId,
  assetId,
  contentType,
}: {
  dataClass: string;
  bundleId: string;
  assetId: string;
  contentType?: string;
}): string {
  const extension = extensionFromContentType(contentType);
  return `${safePathSegment(dataClass)}/articles/${safePathSegment(bundleId)}/${assetId}${
    extension ? `.${extension}` : ""
  }`;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120);
}

function extensionFromContentType(contentType?: string): string | undefined {
  const value = stringValue(contentType)?.toLowerCase();
  if (value === "image/jpeg" || value === "image/jpg") return "jpg";
  if (value === "image/png") return "png";
  if (value === "image/webp") return "webp";
  if (value === "image/gif") return "gif";
  return undefined;
}

function id(prefix: string, bundleId: string): string {
  return `${prefix}-${bundleId}`.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120);
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }
  if (isRecord(error)) {
    return {
      message: stringValue(error.message) ?? stringifyErrorObject(error),
      name: stringValue(error.name),
      code: stringValue(error.code),
    };
  }
  return {
    message: errorMessage(error),
  };
}

function errorCode(error: unknown): string {
  if (isRecord(error)) {
    return stringValue(error.code) ?? stringValue(error.message) ?? "analysis_error";
  }
  return errorMessage(error) || "analysis_error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error)) return stringifyErrorObject(error);
  return String(error);
}

function stringifyErrorObject(error: Record<string, unknown>): string {
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function usageMetrics(value: Partial<UsageMetrics> | undefined): UsageMetrics {
  return {
    inputTokens: numberValue(value?.inputTokens) ?? 0,
    outputTokens: numberValue(value?.outputTokens) ?? 0,
    totalTokens: numberValue(value?.totalTokens) ?? 0,
    cachedInputTokens: numberValue(value?.cachedInputTokens),
    reasoningOutputTokens: numberValue(value?.reasoningOutputTokens),
    latencyMs: numberValue(value?.latencyMs),
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
