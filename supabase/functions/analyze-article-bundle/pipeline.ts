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
type PublishBlocker = {
  code: string;
  message: string;
};
type EditorActionabilityStatus =
  | "actionable"
  | "discarded"
  | "merged"
  | "updated"
  | "system_exception"
  | "needs_info"
  | "not_actionable"
  | "possible_duplicate";
type EditorDecision = {
  decision: "publish" | "discard" | "merge" | "update" | "system_exception";
  reason: string;
  actionabilityStatus: EditorActionabilityStatus;
  exceptionReasonCodes: string[];
  blockers: { hard: PublishBlocker[]; soft: PublishBlocker[] };
};
type WrittenEditorDecision = {
  draftId: string;
  title?: string;
  decision: EditorDecision["decision"];
  reason: string;
  actionabilityStatus: EditorActionabilityStatus;
  exceptionReasonCodes: string[];
};

const editorVersion = "ai-editor-policy-v1";
const systemExceptionReasonCodes = new Set([
  "unsupported_schedule",
]);
const terminalDiscardReasonCodes = new Set([
  "not_public_activity",
  "not_public_eligibility",
  "excluded_event_kind",
  "not_beijing_event",
  "missing_title",
  "missing_start_time",
  "missing_organizer",
  "missing_venue",
  "dedupe_insufficient_info",
  "low_editor_confidence",
  "insufficient_editor_confidence",
]);

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
  const editorDecisions: WrittenEditorDecision[] = [];
  let firstCanonicalEventId: string | undefined;
  let hasSystemException = false;
  let hasMergeOrUpdate = false;
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
    const blockers = collectPublishBlockers({ event, request });
    const editorDecision = decideEditorDecision({
      event,
      dedupeDecision,
      blockers,
    });
    const shouldCreateCanonicalEvent = editorDecision.decision === "publish";
    hasSystemException ||= editorDecision.decision === "system_exception";
    hasMergeOrUpdate ||= editorDecision.decision === "merge" ||
      editorDecision.decision === "update";
    editorDecisions.push({
      draftId,
      title: event.title,
      decision: editorDecision.decision,
      reason: editorDecision.reason,
      actionabilityStatus: editorDecision.actionabilityStatus,
      exceptionReasonCodes: editorDecision.exceptionReasonCodes,
    });
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
        editorDecision,
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
          editorDecision,
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
    : hasSystemException
    ? "needs_review"
    : hasMergeOrUpdate
    ? "duplicate"
    : "excluded";
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
    editorDecisions,
  });
  return { state: ledgerState };
}

function decideEditorDecision({
  event,
  dedupeDecision,
  blockers,
}: {
  event: ExtractedEvent;
  dedupeDecision: string;
  blockers: { hard: PublishBlocker[]; soft: PublishBlocker[] };
}): EditorDecision {
  const hard = [...blockers.hard];
  const soft = [...blockers.soft];
  hard.push(...hardEditorBlockers(event));
  soft.push(...softEditorBlockers(event));

  if (dedupeDecision === "same_event") {
    const reasonCodes = ["possible_duplicate"];
    return {
      decision: "merge",
      reason: editorTerminalReason("merge", reasonCodes),
      actionabilityStatus: "merged",
      exceptionReasonCodes: reasonCodes,
      blockers: { hard, soft },
    };
  }

  if (
    dedupeDecision === "update_existing" ||
    dedupeDecision === "cancel_existing" ||
    dedupeDecision === "withdraw_existing"
  ) {
    const reasonCodes = [dedupeDecision];
    return {
      decision: "update",
      reason: editorTerminalReason("update", reasonCodes),
      actionabilityStatus: "updated",
      exceptionReasonCodes: reasonCodes,
      blockers: { hard, soft },
    };
  }

  const systemExceptionCodes = uniqueReasonCodes(
    reasonCodesMatching(hard, systemExceptionReasonCodes),
  );
  if (systemExceptionCodes.length > 0) {
    return {
      decision: "system_exception",
      reason: editorTerminalReason("system_exception", systemExceptionCodes),
      actionabilityStatus: "system_exception",
      exceptionReasonCodes: systemExceptionCodes,
      blockers: { hard, soft },
    };
  }

  const terminalDiscardCodes = uniqueReasonCodes([
    ...reasonCodesMatching(hard, terminalDiscardReasonCodes),
    ...reasonCodesMatching(soft, terminalDiscardReasonCodes),
  ]);
  if (terminalDiscardCodes.length > 0) {
    return {
      decision: "discard",
      reason: editorTerminalReason("discard", terminalDiscardCodes),
      actionabilityStatus: "discarded",
      exceptionReasonCodes: terminalDiscardCodes,
      blockers: { hard, soft },
    };
  }

  const canPublish = dedupeDecision === "new_event" &&
    hasRequiredPublicFields(event) &&
    isPublicCandidate(event) &&
    !hasExcludedEventKind(event) &&
    event.scheduleKind !== "unsupported" &&
    (modelExplicitlyRequestsPublication(event) ||
      isHighConfidencePublicActivity(event));

  if (canPublish) {
    return {
      decision: "publish",
      reason:
        "Actionable public Beijing event with required publication fields.",
      actionabilityStatus: "actionable",
      exceptionReasonCodes: [],
      blockers: { hard, soft },
    };
  }

  const fallbackReasonCodes = uniqueReasonCodes([
    ...missingRequiredPublicFieldCodes(event),
    dedupeDecision === "insufficient_info" ? "dedupe_insufficient_info" : "",
    (event.confidence ?? 0) < 0.9 ? "low_editor_confidence" : "",
    !isPublicCandidate(event) ? "not_public_activity" : "",
  ]);
  const reasonCodes = fallbackReasonCodes.length > 0
    ? fallbackReasonCodes
    : ["insufficient_editor_confidence"];
  return {
    decision: "discard",
    reason: editorTerminalReason("discard", reasonCodes),
    actionabilityStatus: "discarded",
    exceptionReasonCodes: reasonCodes,
    blockers: { hard, soft },
  };
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

function isPublicCandidate(event: ExtractedEvent): boolean {
  return [
    "public_activity",
    "possible_public_activity",
  ].includes(event.triageDecision ?? "") &&
    event.triageAction === "extract";
}

function hasExcludedEventKind(event: ExtractedEvent): boolean {
  return ["news", "visit", "cancellation"].includes(
    event.eventKind ?? "",
  );
}

function collectPublishBlockers({
  event,
  request,
}: {
  event: ExtractedEvent;
  request: AnalyzeRequest;
}): { hard: PublishBlocker[]; soft: PublishBlocker[] } {
  const hard: PublishBlocker[] = [];
  const soft: PublishBlocker[] = [];
  if (
    registrationUrlMatchesSourceArticle(event, request) &&
    !hasRegistrationEvidenceSelection(event)
  ) {
    soft.push({
      code: "registration_url_is_source_article",
      message:
        "Registration URL points back to the source article instead of an actionable registration path.",
    });
  }
  if (missingRequiredRegistrationEvidence(event, request)) {
    soft.push({
      code: "registration_evidence_missing",
      message:
        "Registration is required but no URL, QR, or evidence path is present.",
    });
  }
  return { hard, soft };
}

function hardEditorBlockers(event: ExtractedEvent): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (!isPublicCandidate(event)) {
    blockers.push({
      code: "not_public_activity",
      message:
        "Extractor did not classify this article as a public activity candidate.",
    });
  }
  if (event.publicEligibility === "not_public") {
    blockers.push({
      code: "not_public_eligibility",
      message: "Event eligibility is not public.",
    });
  }
  if (hasExcludedEventKind(event)) {
    blockers.push({
      code: "excluded_event_kind",
      message: `Event kind '${event.eventKind}' is not publishable.`,
    });
  }
  if (event.scheduleKind === "unsupported") {
    blockers.push({
      code: "unsupported_schedule",
      message: "Schedule shape is unsupported for public catalog publishing.",
    });
  }
  if (!isBeijingEvent(event)) {
    blockers.push({
      code: "not_beijing_event",
      message: "Event city is outside the Beijing catalog scope.",
    });
  }
  return blockers;
}

function softEditorBlockers(event: ExtractedEvent): PublishBlocker[] {
  return missingRequiredPublicFieldCodes(event).map((code) => ({
    code,
    message: missingPublicFieldMessage(code),
  }));
}

function missingRequiredPublicFieldCodes(event: ExtractedEvent): string[] {
  const codes: string[] = [];
  if (!event.title) codes.push("missing_title");
  if (!event.startsAt) codes.push("missing_start_time");
  if (!event.organizer) codes.push("missing_organizer");
  if (!event.venueName && !event.venueAddress) codes.push("missing_venue");
  return codes;
}

function missingPublicFieldMessage(code: string): string {
  const messages: Record<string, string> = {
    missing_title: "Event title is missing.",
    missing_start_time: "Event start time is missing.",
    missing_organizer: "Event organizer is missing.",
    missing_venue: "Event venue is missing.",
  };
  return messages[code] ?? code;
}

function modelExplicitlyRequestsPublication(event: ExtractedEvent): boolean {
  return event.publish?.createCanonicalEvent === true &&
    event.publicEligibility === "public";
}

function editorTerminalReason(
  decision: EditorDecision["decision"],
  reasonCodes: string[],
): string {
  return `AI Editor ${decision}: ${reasonCodes.join(", ")}`;
}

function uniqueReasonCodes(reasonCodes: string[]): string[] {
  return [...new Set(reasonCodes.filter(Boolean))];
}

function reasonCodesMatching(
  blockers: PublishBlocker[],
  allowedCodes: Set<string>,
): string[] {
  return blockers
    .filter((blocker) => allowedCodes.has(blocker.code))
    .map((blocker) => blocker.code);
}

function missingRequiredRegistrationEvidence(
  event: ExtractedEvent,
  request: AnalyzeRequest,
): boolean {
  if (!registrationRequiresEvidence(event)) return false;
  return !actionableRegistrationUrl(event, request) &&
    !hasRegistrationEvidenceSelection(event);
}

function hasRegistrationEvidenceSelection(event: ExtractedEvent): boolean {
  return (event.evidence ?? []).some((selection) =>
    selection.role === "qr" || selection.role === "registration"
  );
}

function registrationRequiresEvidence(event: ExtractedEvent): boolean {
  if (event.reservationStatus === "required") return true;
  const action = String(event.registrationAction ?? "").trim().toLowerCase();
  if (!action || action === "none" || action === "not required") return false;
  return /register|registration|rsvp|sign\s*up|reserve|reservation|apply|ticket|scan|qr|报名|预约|登记|扫码|二维码|购票|门票/
    .test(
      action,
    );
}

function actionableRegistrationUrl(
  event: ExtractedEvent,
  request: AnalyzeRequest,
): string | undefined {
  const url = stringValue(event.registrationUrl);
  if (!url) return undefined;
  return urlsMatch(url, request.sourceUrl) ? undefined : url;
}

function registrationUrlMatchesSourceArticle(
  event: ExtractedEvent,
  request: AnalyzeRequest,
): boolean {
  const url = stringValue(event.registrationUrl);
  return Boolean(url && urlsMatch(url, request.sourceUrl));
}

function urlsMatch(
  left: string | undefined,
  right: string | undefined,
): boolean {
  const leftUrl = canonicalUrl(left);
  const rightUrl = canonicalUrl(right);
  return Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
}

function canonicalUrl(value: string | undefined): string | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return text;
  }
}

function isHighConfidencePublicActivity(event: ExtractedEvent): boolean {
  return (event.confidence ?? 0) >= 0.9 &&
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
  editorDecision,
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
  editorDecision: EditorDecision;
}) {
  const registrationUrl = actionableRegistrationUrl(event, request);
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
    registration_url: registrationUrl,
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
    hard_blockers: editorDecision.blockers.hard,
    soft_blockers: editorDecision.blockers.soft,
    editor_decision: editorDecision.decision,
    editor_reason: editorDecision.reason,
    exception_reason_codes: editorDecision.exceptionReasonCodes,
    actionability_status: editorDecision.actionabilityStatus,
    editor_version: editorVersion,
    resolution_decision: dedupeDecision,
    confidence: event.confidence ?? 0,
    review_state: reviewStateForEditorDecision(editorDecision),
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
  editorDecision,
}: {
  eventId: string;
  request: AnalyzeRequest;
  event: ExtractedEvent;
  poster?: WrittenEvidenceAsset;
  qr?: WrittenEvidenceAsset;
  editorDecision: EditorDecision;
}) {
  const registrationUrl = actionableRegistrationUrl(event, request);
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
    registration_url: registrationUrl,
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
    hard_blockers: editorDecision.blockers.hard,
    soft_blockers: editorDecision.blockers.soft,
    editor_decision: editorDecision.decision,
    editor_reason: editorDecision.reason,
    exception_reason_codes: editorDecision.exceptionReasonCodes,
    actionability_status: editorDecision.actionabilityStatus,
    editor_version: editorVersion,
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

function reviewStateForEditorDecision(
  editorDecision: EditorDecision,
): "approved" | "rejected" | "needs_review" | "needs_info" {
  if (editorDecision.decision === "publish") return "approved";
  if (editorDecision.decision === "system_exception") {
    return editorDecision.exceptionReasonCodes.some((code) =>
        code.startsWith("missing_") || code.includes("evidence")
      )
      ? "needs_info"
      : "needs_review";
  }
  return "rejected";
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
    editorDecisions = [],
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
    editorDecisions?: WrittenEditorDecision[];
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
      editorVersion,
      editorDecisions,
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
  return `${safePathSegment(dataClass)}/articles/${
    safePathSegment(bundleId)
  }/${assetId}${extension ? `.${extension}` : ""}`;
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
    return stringValue(error.code) ?? stringValue(error.message) ??
      "analysis_error";
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
