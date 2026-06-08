import type { AdminEventDraftRecord, AdminPublishBlocker } from "./admin-service";

export type PublishDecision = {
  publishState: "public" | "needs_review" | "rejected" | "needs_info" | "blocked";
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
  const publishState = computePublishState({
    canPublish,
    requiresOperatorOverride,
    hardBlockers,
    softBlockers,
  });

  return {
    publishState,
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
  if (
    !draft.title ||
    !draft.startsAt ||
    !(draft.venueName || draft.venueAddress)
  ) {
    blockers.push({
      code: "missing_required_public_field",
      message: "Missing required public event fields",
    });
  }
  if (!draft.organizer) {
    blockers.push({
      code: "missing_organizer",
      message: "Missing public organizer",
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
  if (draft.eventKind === "news") {
    blockers.push({
      code: "news_not_public_event",
      message: "News item is not a public event",
    });
  }
  if (draft.eventKind === "visit") {
    blockers.push({
      code: "visit_not_public_event",
      message: "Official visit is not a public event",
    });
  }
  if (draft.city !== "Beijing") {
    blockers.push({
      code: "not_beijing_event",
      message: "Event is not in Beijing",
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
    blockers.push(resolutionBlocker(draft.resolutionDecision));
  }
  if (
    draft.reservationStatus === "required" &&
    !draft.registrationAction &&
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

function resolutionBlocker(
  resolutionDecision: NonNullable<AdminEventDraftRecord["resolutionDecision"]>,
): AdminPublishBlocker {
  if (resolutionDecision === "same_event") {
    return {
      code: "duplicate_event_unresolved",
      message: "Duplicate event requires resolution before publishing",
    };
  }
  if (resolutionDecision === "update_existing") {
    return {
      code: "event_update_requires_review",
      message: "Updates to an existing event require operator review before publishing",
    };
  }
  if (resolutionDecision === "cancel_existing") {
    return {
      code: "event_cancellation_requires_review",
      message: "Cancellation of an existing event requires operator review before publishing",
    };
  }
  if (resolutionDecision === "withdraw_existing") {
    return {
      code: "event_withdrawal_requires_review",
      message: "Withdrawal of an existing event requires operator review before publishing",
    };
  }
  if (resolutionDecision === "not_public_activity") {
    return {
      code: "not_public_activity",
      message: "Not public activity",
    };
  }
  return {
    code: "insufficient_info_resolution",
    message: "Resolution found insufficient information for publishing",
  };
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

function computePublishState(input: {
  canPublish: boolean;
  requiresOperatorOverride: boolean;
  hardBlockers: AdminPublishBlocker[];
  softBlockers: AdminPublishBlocker[];
}): PublishDecision["publishState"] {
  if (input.canPublish) return "public";
  if (
    input.hardBlockers.some((blocker) =>
      [
        "not_public_activity",
        "excluded_triage_decision",
        "news_not_public_event",
        "visit_not_public_event",
        "not_beijing_event",
        "unsupported_event",
      ].includes(blocker.code),
    )
  ) {
    return "rejected";
  }
  if (
    input.hardBlockers.some(
      (blocker) => blocker.code === "missing_required_public_field",
    )
  ) {
    return "needs_info";
  }
  if (input.hardBlockers.length > 0) return "blocked";
  if (input.softBlockers.length > 0 || input.requiresOperatorOverride) {
    return "needs_review";
  }
  return "blocked";
}
