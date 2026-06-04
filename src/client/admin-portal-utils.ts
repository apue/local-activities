export type AdminPortalDraftLike = {
  title?: string;
  organizer?: string;
  startsAt?: string;
  venueName?: string;
  venueAddress?: string;
  reservationStatus?: string;
  reviewState?: string;
};

export type DraftBlockingReason =
  | "missing_title"
  | "missing_start_time"
  | "missing_venue";

export function getDraftBlockingReasons(
  draft: AdminPortalDraftLike,
): DraftBlockingReason[] {
  const reasons: DraftBlockingReason[] = [];

  if (!draft.title) reasons.push("missing_title");
  if (!draft.startsAt) reasons.push("missing_start_time");
  if (!draft.venueName && !draft.venueAddress) reasons.push("missing_venue");

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

export function formatTokenCount(value: number | undefined) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

export function formatLlmCostCny(value: number | undefined) {
  return `¥${((value ?? 0) / 1_000_000).toFixed(4)}`;
}
