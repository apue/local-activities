export type AdminPortalDraftLike = {
  title?: string;
  organizer?: string;
  startsAt?: string;
  venueName?: string;
  reservationStatus?: string;
  reviewState?: string;
};

export type DraftBlockingReason =
  | "missing_title"
  | "missing_organizer"
  | "missing_start_time"
  | "missing_venue"
  | "missing_reservation_status";

export function getDraftBlockingReasons(
  draft: AdminPortalDraftLike,
): DraftBlockingReason[] {
  const reasons: DraftBlockingReason[] = [];

  if (!draft.title) reasons.push("missing_title");
  if (!draft.organizer) reasons.push("missing_organizer");
  if (!draft.startsAt) reasons.push("missing_start_time");
  if (!draft.venueName) reasons.push("missing_venue");
  if (!draft.reservationStatus) reasons.push("missing_reservation_status");

  return reasons;
}

export function isDraftPublishableForDisplay(draft: AdminPortalDraftLike) {
  return getDraftBlockingReasons(draft).length === 0;
}

export function getReviewStateLabel(reviewState: string | undefined) {
  switch (reviewState) {
    case "ready_for_review":
      return "Ready";
    case "needs_review":
      return "Review";
    case "needs_info":
      return "Needs info";
    case "possible_duplicate":
      return "Duplicate?";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return "Unknown";
  }
}

export function formatDateTime(value: string | undefined) {
  if (!value) return "Missing";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
