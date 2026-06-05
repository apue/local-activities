export type AdminPortalDraftLike = {
  title?: string;
  startsAt?: string;
  venueName?: string;
  venueAddress?: string;
  reviewState?: string;
  publishDecision?: AdminPortalPublishDecision;
  posterAssetId?: string;
  qrAssetId?: string;
  registrationQrAssetId?: string;
  posterImageUrl?: string;
  posterImageAlt?: string;
  posterImageSourceUrl?: string;
  registrationQrImageUrl?: string;
  registrationQrImageAlt?: string;
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

export type DraftEvidenceItem = {
  kind: "poster" | "registration_qr";
  label: string;
  imageUrl?: string;
  imageAlt?: string;
  assetId?: string;
  sourceUrl?: string;
};

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

export function getDraftEvidenceItems(
  draft: AdminPortalDraftLike,
): DraftEvidenceItem[] {
  const items: DraftEvidenceItem[] = [];
  if (draft.posterImageUrl || draft.posterAssetId || draft.posterImageSourceUrl) {
    items.push({
      kind: "poster",
      label: "Poster",
      imageUrl: draft.posterImageUrl,
      imageAlt: draft.posterImageAlt ?? `${draft.title ?? "Event"} poster`,
      assetId: draft.posterAssetId,
      sourceUrl: draft.posterImageSourceUrl,
    });
  }
  const qrAssetId = draft.registrationQrAssetId ?? draft.qrAssetId;
  if (draft.registrationQrImageUrl || qrAssetId) {
    items.push({
      kind: "registration_qr",
      label: "Registration QR",
      imageUrl: draft.registrationQrImageUrl,
      imageAlt:
        draft.registrationQrImageAlt ??
        `${draft.title ?? "Event"} registration QR`,
      assetId: qrAssetId,
    });
  }
  return items;
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
