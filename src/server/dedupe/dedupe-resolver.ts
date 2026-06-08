import type { EventDraftUpload } from "../../contracts/collector";
import type { AdminPublishBlocker, AdminReviewState } from "../admin-service";
import type { CollectorEventCandidate } from "../collector-event-candidates-route-handlers";

export type DedupeDecisionKind =
  | "new_event"
  | "same_event"
  | "update_existing"
  | "cancel_existing"
  | "withdraw_existing"
  | "possible_duplicate"
  | "reject"
  | "review";

export type DedupeDecision = {
  decision: DedupeDecisionKind;
  canonicalEventId?: string;
  reviewState: AdminReviewState;
  proposedChanges?: Record<string, unknown>;
  publishBlockers: AdminPublishBlocker[];
  productVisibleReasons: string[];
  match?: {
    eventId: string;
    score: number;
    reasons: string[];
  };
};

type CandidateMatch = {
  candidate: CollectorEventCandidate;
  score: number;
  reasons: string[];
};

const exactMatchThreshold = 0.85;
const possibleDuplicateThreshold = 0.55;

export function resolveEventDedupe(
  draft: EventDraftUpload,
  candidates: CollectorEventCandidate[],
): DedupeDecision {
  const rejection = rejectUnsupportedDraft(draft);
  if (rejection) return rejection;

  if (!hasRequiredPublicFields(draft)) {
    return {
      decision: "review",
      reviewState: "needs_info",
      publishBlockers: [
        {
          code: "missing_required_public_field",
          message: "Missing required public event fields",
        },
      ],
      productVisibleReasons: [
        hasHumanReadableEventInformation(draft)
          ? "Missing required public fields, but the draft still has human-readable event information."
          : "Missing required public event fields.",
      ],
    };
  }

  const bestMatch = findBestCandidateMatch(draft, candidates);
  if (!bestMatch || bestMatch.score < possibleDuplicateThreshold) {
    return {
      decision: "new_event",
      reviewState: "ready_for_review",
      publishBlockers: [],
      productVisibleReasons: ["No local candidate matched this event."],
    };
  }

  if (isCancellationDraft(draft)) {
    return existingEventDecision("cancel_existing", bestMatch, {
      status: "cancelled",
    });
  }

  if (isWithdrawalDraft(draft)) {
    return existingEventDecision("withdraw_existing", bestMatch, {
      status: "withdrawn",
    });
  }

  if (bestMatch.score >= exactMatchThreshold) {
    const proposedChanges = buildProposedChanges(draft, bestMatch.candidate);
    if (Object.keys(proposedChanges).length > 0) {
      return existingEventDecision(
        "update_existing",
        bestMatch,
        proposedChanges,
      );
    }

    return {
      decision: "same_event",
      canonicalEventId: bestMatch.candidate.eventId,
      reviewState: "possible_duplicate",
      publishBlockers: [
        {
          code: "duplicate_event",
          message: "Matches an existing event and requires duplicate resolution before publishing.",
        },
      ],
      productVisibleReasons: [
        "Same organizer, start time, and venue as an existing event.",
      ],
      match: mapMatch(bestMatch),
    };
  }

  return {
    decision: "possible_duplicate",
    canonicalEventId: bestMatch.candidate.eventId,
    reviewState: "possible_duplicate",
    publishBlockers: [
      {
        code: "possible_duplicate",
        message: "Possible duplicate requires operator review before publishing.",
      },
    ],
    productVisibleReasons: [
      "Similar local candidate found; operator review is required before publishing.",
    ],
    match: mapMatch(bestMatch),
  };
}

function rejectUnsupportedDraft(draft: EventDraftUpload): DedupeDecision | undefined {
  if (draft.publicEligibility === "not_public") {
    return rejectDecision("not_public_activity", "Not public activity");
  }
  if (draft.eventKind === "news") {
    return rejectDecision("news_not_event", "News item is not a public event");
  }
  if (draft.eventKind === "visit") {
    return rejectDecision("visit_not_event", "Official visit is not a public event");
  }
  if (draft.eventKind === "unsupported" || draft.scheduleKind === "unsupported") {
    return rejectDecision("unsupported_event", "Unsupported event format");
  }
  if (draft.city !== "Beijing") {
    return rejectDecision("not_beijing_event", "Event is not in Beijing");
  }
  return undefined;
}

function rejectDecision(code: string, message: string): DedupeDecision {
  return {
    decision: "reject",
    reviewState: "needs_review",
    publishBlockers: [{ code, message }],
    productVisibleReasons: [message],
  };
}

function hasRequiredPublicFields(draft: EventDraftUpload) {
  return Boolean(
    draft.title &&
      draft.startsAt &&
      (draft.venueName || draft.venueAddress) &&
      draft.articleUrl,
  );
}

function hasHumanReadableEventInformation(draft: EventDraftUpload) {
  return Boolean(draft.scheduleText || draft.summary || draft.title);
}

function findBestCandidateMatch(
  draft: EventDraftUpload,
  candidates: CollectorEventCandidate[],
): CandidateMatch | undefined {
  return candidates
    .map((candidate) => scoreCandidate(draft, candidate))
    .sort((left, right) => right.score - left.score)[0];
}

function scoreCandidate(
  draft: EventDraftUpload,
  candidate: CollectorEventCandidate,
): CandidateMatch {
  let score = 0;
  const reasons: string[] = [];

  const titleScore = textSimilarity(draft.title, candidate.title);
  if (titleScore >= 0.7) reasons.push("similar_title");
  score += titleScore * 0.35;

  if (sameInstant(draft.startsAt, candidate.startsAt)) {
    score += 0.25;
    reasons.push("same_start_time");
  } else if (sameLocalDate(draft.startsAt, candidate.startsAt)) {
    score += 0.12;
    reasons.push("same_local_date");
  }

  if (sameText(draft.organizer, candidate.organizer ?? undefined)) {
    score += 0.15;
    reasons.push("same_organizer");
  }

  if (
    sameText(draft.venueName, candidate.venueName ?? undefined) ||
    sameText(draft.venueAddress, candidate.venueAddress ?? undefined)
  ) {
    score += 0.2;
    reasons.push("same_venue");
  }

  if (draft.articleUrl === candidate.sourceUrl) {
    score += 0.1;
    reasons.push("same_source_url");
  }

  if (
    titleScore >= 0.7 &&
    reasons.includes("same_start_time") &&
    reasons.includes("same_organizer") &&
    reasons.includes("same_venue")
  ) {
    score += 0.05;
  }

  return {
    candidate,
    score: roundScore(Math.min(score, 1)),
    reasons,
  };
}

function existingEventDecision(
  decision: "update_existing" | "cancel_existing" | "withdraw_existing",
  match: CandidateMatch,
  proposedChanges: Record<string, unknown>,
): DedupeDecision {
  const codeByDecision = {
    update_existing: "event_update_requires_review",
    cancel_existing: "event_cancellation_requires_review",
    withdraw_existing: "event_withdrawal_requires_review",
  };
  const messageByDecision = {
    update_existing: "Updates to an existing event require operator review before publishing.",
    cancel_existing: "Cancellation of an existing event requires operator review before publishing.",
    withdraw_existing: "Withdrawal of an existing event requires operator review before publishing.",
  };

  return {
    decision,
    canonicalEventId: match.candidate.eventId,
    reviewState: "needs_review",
    proposedChanges,
    publishBlockers: [
      {
        code: codeByDecision[decision],
        message: messageByDecision[decision],
      },
    ],
    productVisibleReasons: [messageByDecision[decision]],
    match: mapMatch(match),
  };
}

function buildProposedChanges(
  draft: EventDraftUpload,
  candidate: CollectorEventCandidate,
) {
  const changes: Record<string, unknown> = {};
  if (
    draft.title &&
    !sameText(draft.title, candidate.title) &&
    textSimilarity(draft.title, candidate.title) < 0.7
  ) {
    changes.title = draft.title;
  }
  if (draft.organizer && !sameText(draft.organizer, candidate.organizer ?? undefined)) {
    changes.organizer = draft.organizer;
  }
  if (draft.startsAt && !sameInstant(draft.startsAt, candidate.startsAt)) {
    changes.startsAt = draft.startsAt;
  }
  if (
    draft.endsAt &&
    (!candidate.endsAt || !sameInstant(draft.endsAt, candidate.endsAt))
  ) {
    changes.endsAt = draft.endsAt;
  }
  if (draft.venueName && !sameText(draft.venueName, candidate.venueName ?? undefined)) {
    changes.venueName = draft.venueName;
  }
  if (
    draft.venueAddress &&
    !sameText(draft.venueAddress, candidate.venueAddress ?? undefined)
  ) {
    changes.venueAddress = draft.venueAddress;
  }
  if (draft.registrationUrl) changes.registrationUrl = draft.registrationUrl;
  if (draft.registrationAction) changes.registrationAction = draft.registrationAction;
  if (draft.scheduleText && draft.scheduleText !== candidate.scheduleText) {
    changes.scheduleText = draft.scheduleText;
  }
  if (draft.summary) changes.summary = draft.summary;
  if (draft.entryNotes) changes.entryNotes = draft.entryNotes;
  return changes;
}

function isCancellationDraft(draft: EventDraftUpload) {
  const text = `${draft.title ?? ""} ${draft.summary ?? ""} ${draft.scheduleText ?? ""}`;
  return draft.eventKind === "cancellation" || /cancelled|canceled|取消|延期/.test(text);
}

function isWithdrawalDraft(draft: EventDraftUpload) {
  const text = `${draft.title ?? ""} ${draft.summary ?? ""} ${draft.scheduleText ?? ""}`;
  return /withdrawn|closed|下架|撤回/.test(text);
}

function mapMatch(match: CandidateMatch) {
  return {
    eventId: match.candidate.eventId,
    score: match.score,
    reasons: match.reasons,
  };
}

function textSimilarity(left?: string, right?: string | null) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right ?? undefined);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

function tokenize(value?: string) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function sameText(left?: string, right?: string | null) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right ?? undefined);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function normalizeText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function sameInstant(left?: string, right?: string | null) {
  if (!left || !right) return false;
  return new Date(left).getTime() === new Date(right).getTime();
}

function sameLocalDate(left?: string, right?: string | null) {
  if (!left || !right) return false;
  return left.slice(0, 10) === right.slice(0, 10);
}

function roundScore(score: number) {
  return Math.round(score * 100) / 100;
}
