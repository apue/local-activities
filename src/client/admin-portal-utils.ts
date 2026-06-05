export type AdminPortalDraftLike = {
  title?: string;
  startsAt?: string;
  venueName?: string;
  venueAddress?: string;
  reviewState?: string;
  publishDecision?: AdminPortalPublishDecision;
};

export type AdminPortalPublishBlocker = {
  code: string;
  message: string;
};

export type AdminPortalPublishDecision = {
  canPublish: boolean;
  canPublishWithOverride: boolean;
  requiresOperatorOverride: boolean;
  hardBlockers: AdminPortalPublishBlocker[];
  softBlockers: AdminPortalPublishBlocker[];
  disabledReason?: string;
};

export type DraftBlockingReason = string;

export function getDraftBlockingReasons(
  draft: AdminPortalDraftLike,
): DraftBlockingReason[] {
  const decision = draft.publishDecision;
  if (!decision) return ["publish_decision_missing"];
  return [...decision.hardBlockers, ...decision.softBlockers].map(
    (blocker) => blocker.code,
  );
}

export function isDraftPublishableForDisplay(
  draft: AdminPortalDraftLike,
  operatorOverrideReason = "",
) {
  const decision = draft.publishDecision;
  if (!decision) return false;
  if (decision.canPublish) return true;
  return (
    decision.canPublishWithOverride &&
    Boolean(operatorOverrideReason.trim())
  );
}

export function canRunDraftReviewAction(draft: AdminPortalDraftLike) {
  return !["approved", "rejected"].includes(draft.reviewState ?? "");
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

export function getUsageRangeLabel(range: string | undefined) {
  switch (range) {
    case "7d":
      return "Last 7 days";
    case "all":
      return "All";
    case "today":
    default:
      return "Today";
  }
}

export function formatUsageTimestamp(value: string | undefined) {
  return value ? formatDateTime(value) : "No records";
}
