import { runLlmExtractionOnce } from "./llm-extractor.mjs";

export async function runRecordedExtractionReplay({
  env,
  articleSnapshot,
  evidenceAssets = [],
  recordedResponse,
  now,
  runId,
}) {
  return runLlmExtractionOnce({
    env,
    articleSnapshot,
    evidenceAssets,
    providerResponse: recordedExtractionToProviderResponse(recordedResponse),
    now,
    runId,
    upload: false,
  });
}

export async function runRawModelResponseReplay({
  env,
  articleSnapshot,
  evidenceAssets = [],
  rawModelResponseRecord,
  now,
  runId,
}) {
  const result = await runLlmExtractionOnce({
    env,
    articleSnapshot,
    evidenceAssets,
    providerResponse: rawModelResponseRecordToProviderResponse(
      rawModelResponseRecord,
    ),
    now,
    runId,
    upload: false,
  });
  return {
    ...result,
    rawModelResponse: rawModelResponseRecord,
  };
}

export function rawModelResponseRecordToProviderResponse(record) {
  if (record?.contractVersion !== "llm-raw-model-response-v1") {
    throw new Error("raw_model_response_record_version_invalid");
  }
  if (!record.rawResponse || typeof record.rawResponse !== "object") {
    throw new Error("raw_model_response_record_response_invalid");
  }
  return record.rawResponse;
}

export function recordedExtractionToProviderResponse(recordedResponse) {
  const events = Array.isArray(recordedResponse?.events)
    ? recordedResponse.events
    : [];
  if (!events.length) {
    return {
      classification: {
        kind: "not_activity",
        confidence: 0.9,
        signals: [],
        missingFields: [],
      },
      events: [],
    };
  }

  return {
    classification: {
      kind: "activity",
      confidence: Math.max(
        ...events.map((event) =>
          typeof event.confidence === "number" ? event.confidence : 0.5,
        ),
      ),
      signals: uniqueStrings(events.flatMap(eventSignals)),
      missingFields: uniqueStrings(
        events.flatMap((event) =>
          [...(event.hardBlockers ?? []), ...(event.softBlockers ?? [])].map(
            (blocker) => blocker.code,
          ),
        ),
      ),
    },
    events: events.map(recordedEventToProviderEvent),
  };
}

function recordedEventToProviderEvent(event) {
  return removeUndefined({
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    city: event.city,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    reservationStatus: event.reservationStatus,
    registrationRequirement: event.registrationRequirement,
    registrationAction:
      event.registrationRequirement === "required"
        ? "Follow source article registration instructions."
        : undefined,
    scheduleText: event.scheduleText,
    posterAssetId: event.posterAssetId,
    qrAssetId: event.qrAssetId,
    registrationQrAssetId: event.registrationQrAssetId,
    summary: event.summary ?? event.title,
    signals: eventSignals(event),
    confidence: event.confidence,
    publicEligibility: event.publicEligibility,
    eventKind: event.eventKind,
    scheduleKind: event.scheduleKind,
    recurrenceRule: event.recurrenceRule,
    occurrenceStartsAt: event.occurrenceStartsAt,
    hardBlockers: event.hardBlockers,
    softBlockers: event.softBlockers,
    fieldEvidence: {
      title: ["recorded-extraction-response"],
      startsAt: event.startsAt ? ["recorded-extraction-response"] : undefined,
      scheduleText: event.scheduleText ? ["recorded-extraction-response"] : undefined,
      venueName: event.venueName ? ["recorded-extraction-response"] : undefined,
      posterAssetId: event.posterAssetId ? [event.posterAssetId] : undefined,
      registrationQrAssetId: event.registrationQrAssetId
        ? [event.registrationQrAssetId]
        : undefined,
    },
  });
}

function eventSignals(event) {
  const signals = [];
  if (event.registrationQrAssetId) signals.push("qr_registration");
  if (event.posterAssetId) signals.push("image_dominant");
  if (event.hardBlockers?.length || event.softBlockers?.length) {
    signals.push("missing_required_public_field");
  }
  if (!signals.length) signals.push("ready_for_review");
  return signals;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
