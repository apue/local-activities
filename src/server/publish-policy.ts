import type { AdminEventDraftRecord, AdminPublishBlocker } from "./admin-service";

export type PublishDecision = {
  canPublish: boolean;
  canPublishWithOverride: boolean;
  requiresOperatorOverride: boolean;
  hardBlockers: AdminPublishBlocker[];
  softBlockers: AdminPublishBlocker[];
  disabledReason?: string;
};

export function computePublishDecision(
  draft: AdminEventDraftRecord,
  options: { operatorOverrideReason?: string } = {},
): PublishDecision {
  const hardBlockers = uniqueBlockers([
    ...backendHardBlockers(draft),
    ...(draft.hardBlockers ?? []),
  ]);
  const softBlockers = uniqueBlockers([
    ...backendSoftBlockers(draft),
    ...(draft.softBlockers ?? []),
  ]);
  const hasOverride = Boolean(options.operatorOverrideReason?.trim());
  const canPublishWithOverride =
    hardBlockers.length === 0 && softBlockers.length > 0;
  const requiresOperatorOverride = canPublishWithOverride && !hasOverride;
  const canPublish =
    hardBlockers.length === 0 && (softBlockers.length === 0 || hasOverride);

  return {
    canPublish,
    canPublishWithOverride,
    requiresOperatorOverride,
    hardBlockers,
    softBlockers,
    disabledReason: canPublish
      ? undefined
      : (hardBlockers[0]?.message ??
        (requiresOperatorOverride
          ? "Operator override reason required"
          : softBlockers[0]?.message)),
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
  if (["approved", "rejected"].includes(draft.reviewState)) {
    blockers.push({
      code: "closed_review_state",
      message: "Draft review state is already closed",
    });
  }
  if (draft.reviewState === "possible_duplicate") {
    blockers.push({
      code: "possible_duplicate_review_state",
      message: "Possible duplicate requires resolution before publishing",
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
    !draft.registrationQrAssetId &&
    !draft.registrationQrImageUrl
  ) {
    blockers.push({
      code: "missing_required_qr_evidence",
      message: "Required registration evidence is missing",
    });
  }
  return blockers;
}

function uniqueBlockers(blockers: AdminPublishBlocker[]) {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    if (seen.has(blocker.code)) return false;
    seen.add(blocker.code);
    return true;
  });
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
