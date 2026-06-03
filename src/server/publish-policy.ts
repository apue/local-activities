import type { AdminEventDraftRecord, AdminPublishBlocker } from "./admin-service";

export type PublishDecision = {
  canPublish: boolean;
  hardBlockers: AdminPublishBlocker[];
  softBlockers: AdminPublishBlocker[];
  disabledReason?: string;
};

export function computePublishDecision(
  draft: AdminEventDraftRecord,
  options: { operatorOverrideReason?: string } = {},
): PublishDecision {
  const hardBlockers = [
    ...backendHardBlockers(draft),
    ...(draft.hardBlockers ?? []),
  ];
  const softBlockers = [
    ...backendSoftBlockers(draft),
    ...(draft.softBlockers ?? []),
  ];
  const canPublish =
    hardBlockers.length === 0 &&
    (softBlockers.length === 0 || Boolean(options.operatorOverrideReason?.trim()));

  return {
    canPublish,
    hardBlockers,
    softBlockers,
    disabledReason: canPublish
      ? undefined
      : (hardBlockers[0] ?? softBlockers[0])?.message,
  };
}

function backendHardBlockers(draft: AdminEventDraftRecord) {
  const blockers: AdminPublishBlocker[] = [];
  if (!draft.title || !draft.startsAt || !(draft.venueName || draft.venueAddress)) {
    blockers.push({
      code: "missing_required_public_field",
      message: "Missing required public event fields",
    });
  }
  if (draft.publicEligibility === "not_public") {
    blockers.push({
      code: "not_public_activity",
      message: "Not public activity",
    });
  }
  if (
    draft.triageDecision &&
    [
      "official_visit",
      "non_public_news",
      "internal_or_private",
      "not_event",
      "unsupported",
    ].includes(draft.triageDecision)
  ) {
    blockers.push({
      code: "excluded_triage_decision",
      message: "Excluded by editorial triage",
    });
  }
  if (draft.scheduleKind === "unsupported") {
    blockers.push({
      code: "non_renderable_schedule",
      message: "Schedule is not renderable",
    });
  }
  if (
    draft.resolutionDecision &&
    draft.resolutionDecision !== "new_event"
  ) {
    blockers.push({
      code: "unresolved_resolution",
      message: "Duplicate, update, cancellation, or insufficient-info state is unresolved",
    });
  }
  if (
    draft.reservationStatus === "required" &&
    !draft.registrationUrl &&
    !draft.registrationQrAssetId
  ) {
    blockers.push({
      code: "missing_required_qr_evidence",
      message: "Required registration evidence is missing",
    });
  }
  return blockers;
}

function backendSoftBlockers(draft: AdminEventDraftRecord) {
  const blockers: AdminPublishBlocker[] = [];
  if (draft.confidence < 0.75) {
    blockers.push({
      code: "low_confidence",
      message: "Low extraction confidence",
    });
  }
  if (!draft.endsAt) {
    blockers.push({
      code: "missing_end_time",
      message: "Missing end time",
    });
  }
  if (!draft.summary) {
    blockers.push({
      code: "missing_description",
      message: "Missing optional description",
    });
  }
  return blockers;
}
