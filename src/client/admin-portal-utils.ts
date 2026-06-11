import { extractFirstHttpUrl } from "../shared/seed-url";

export type AdminPortalDraftLike = {
  articleUrl?: string;
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

export type AdminPortalFeedbackType =
  | "not_event"
  | "not_public"
  | "should_publish"
  | "missing_event"
  | "wrong_time"
  | "wrong_location"
  | "missing_registration"
  | "missing_qr"
  | "duplicate_event"
  | "bad_summary"
  | "bad_category_or_tags"
  | "other";

export type AdminPortalLedgerLike = {
  id?: string;
  articleBundleId?: string;
  state?: string;
  createdAt?: string;
};

export type AdminPortalFeedbackLike = {
  id?: string;
  status?: string;
  createdAt?: string;
};

export type AdminPortalUsageLike = {
  totals?: {
    costMicroCny?: number;
  };
};

export type AdminPortalEvaluationRunLike = {
  runId?: string;
  status?: string;
  passCount?: number;
  caseCount?: number;
  startedAt?: string;
  createdAt?: string;
};

export type AdminPortalQualitySummary = {
  todayArticleCount: number;
  publishedCount: number;
  needsReviewCount: number;
  excludedCount: number;
  failedCount: number;
  feedbackCount: number;
  openFeedbackCount: number;
  tokenCostMicroCny: number;
  auditStatusLabel: string;
  auditStatusTone: "ready" | "warning" | "blocked" | "muted";
};

export const adminQuickFeedbackOptions: Array<{
  feedbackType: AdminPortalFeedbackType;
  label: string;
}> = [
  { feedbackType: "not_event", label: "Not event" },
  { feedbackType: "not_public", label: "Not public" },
  { feedbackType: "missing_qr", label: "Missing QR" },
  { feedbackType: "duplicate_event", label: "Duplicate" },
  { feedbackType: "bad_summary", label: "Bad summary" },
];

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

export function getDraftSourceUrl(draft: AdminPortalDraftLike) {
  if (!draft.articleUrl) return "";
  return extractFirstHttpUrl(draft.articleUrl) ?? draft.articleUrl;
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

export function computeAdminQualitySummary({
  now = new Date(),
  ledger = [],
  feedback = [],
  usage,
  evaluationRuns = [],
}: {
  now?: Date;
  ledger?: AdminPortalLedgerLike[];
  feedback?: AdminPortalFeedbackLike[];
  usage?: AdminPortalUsageLike;
  evaluationRuns?: AdminPortalEvaluationRunLike[];
}): AdminPortalQualitySummary {
  const todayKey = beijingDateKey(now.toISOString());
  const todayLedger = ledger.filter(
    (row) => row.createdAt && beijingDateKey(row.createdAt) === todayKey,
  );
  const todayArticleIds = new Set(
    todayLedger.map((row) => row.articleBundleId ?? row.id).filter(Boolean),
  );
  const latestEvaluation = [...evaluationRuns].sort(
    (left, right) =>
      Date.parse(right.startedAt ?? right.createdAt ?? "") -
      Date.parse(left.startedAt ?? left.createdAt ?? ""),
  )[0];
  const auditStatus = formatAuditStatus(latestEvaluation);

  return {
    todayArticleCount: todayArticleIds.size,
    publishedCount: countLedgerState(todayLedger, "published"),
    needsReviewCount:
      countLedgerState(todayLedger, "needs_review") +
      countLedgerState(todayLedger, "needs_info") +
      countLedgerState(todayLedger, "duplicate"),
    excludedCount: countLedgerState(todayLedger, "excluded"),
    failedCount: countLedgerState(todayLedger, "failed"),
    feedbackCount: feedback.length,
    openFeedbackCount: feedback.filter((row) => row.status === "open").length,
    tokenCostMicroCny: usage?.totals?.costMicroCny ?? 0,
    auditStatusLabel: auditStatus.label,
    auditStatusTone: auditStatus.tone,
  };
}

function countLedgerState(rows: AdminPortalLedgerLike[], state: string) {
  return rows.filter((row) => row.state === state).length;
}

function beijingDateKey(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function formatAuditStatus(run: AdminPortalEvaluationRunLike | undefined): {
  label: string;
  tone: AdminPortalQualitySummary["auditStatusTone"];
} {
  if (!run) return { label: "No audit report", tone: "muted" };
  const runLabel = run.runId ?? "latest eval";
  if (run.status === "failed") {
    return { label: `${runLabel} · failed`, tone: "blocked" };
  }
  if (run.status === "running") {
    return { label: `${runLabel} · running`, tone: "warning" };
  }
  const passCount = run.passCount ?? 0;
  const caseCount = run.caseCount ?? 0;
  const label = `${runLabel} · ${passCount}/${caseCount} passed`;
  return {
    label,
    tone: caseCount > 0 && passCount === caseCount ? "ready" : "warning",
  };
}
