export const validatorV2Version = "v5-validator.v2";

const hardClassifications = new Map([
  ["news", "classification_news_not_event"],
  ["official_visit", "classification_official_visit_not_event"],
  ["visit", "classification_official_visit_not_event"],
  ["recap", "classification_recap_not_event"],
  ["internal", "classification_internal_only"],
  ["internal_only", "classification_internal_only"],
]);

const nonPublicValues = new Set([
  "not_public",
  "non_public",
  "private",
  "internal",
  "internal_only",
  "invite_only",
  "invited_only",
  "staff_only",
  "members_only",
  "closed",
]);

const generalPublicValues = new Set([
  "public",
  "open",
  "open_to_public",
  "general_public",
  "公众",
  "公开",
]);

const outsideBeijingValues = new Set([
  "shanghai",
  "上海",
  "tianjin",
  "天津",
  "guangzhou",
  "广州",
  "shenzhen",
  "深圳",
  "chengdu",
  "成都",
  "hangzhou",
  "杭州",
  "nanjing",
  "南京",
  "hong kong",
  "香港",
  "macau",
  "澳门",
]);

const beijingValues = new Set(["beijing", "北京", "北京市", "peking"]);

export function validateV5Extraction({ extraction, normalized, now = new Date() } = {}) {
  if (!extraction || typeof extraction !== "object") {
    throw new Error("v5_validator_extraction_required");
  }
  const checkedAt = isoTimestamp(now);
  const hardIssues = [];
  const softIssues = [];
  const repairableIssues = [];
  const eventResults = [];

  addExtractionDecisionIssues({ extraction, hardIssues });
  addClassificationIssue({ target: extraction, hardIssues });
  addPublicEligibilityIssue({ extraction, hardIssues });
  addLowConfidenceIssue({ extraction, softIssues });

  const events = Array.isArray(extraction.events) ? extraction.events : [];
  if (extraction.decision === "event" && events.length === 0) {
    addIssue(softIssues, {
      code: "event_drafts_missing",
      severity: "soft",
      repairable: true,
      message: "Extraction marked an event but returned no event drafts.",
    });
  }

  events.forEach((event, eventIndex) => {
    const eventIssues = [];
    const pushHard = (issue) => {
      addIssue(hardIssues, issue);
      eventIssues.push(issue);
    };
    const pushSoft = (issue) => {
      addIssue(softIssues, issue);
      eventIssues.push(issue);
    };

    addClassificationIssue({ target: event, eventIndex, hardIssues: { push: pushHard } });
    addEventPublicAudienceIssues({ event, eventIndex, pushHard });
    addCityIssue({ event, eventIndex, pushHard, pushSoft });
    addScheduleIssues({ event, eventIndex, now: checkedAt, extraction, pushHard, pushSoft });
    addAttendancePathIssue({ event, eventIndex, pushSoft });
    addRegistrationIssue({ event, eventIndex, normalized, pushSoft });

    eventResults.push({
      eventIndex,
      title: clean(event?.title),
      status: eventIssues.some((issue) => issue.severity === "hard")
        ? "invalid"
        : eventIssues.length > 0
        ? "needs_info"
        : "valid",
      issues: eventIssues,
    });
  });

  for (const issue of softIssues) {
    if (issue.repairable) addIssue(repairableIssues, issue);
  }

  const issues = [...hardIssues, ...softIssues];
  const status = hardIssues.length > 0 ? "invalid" : softIssues.length > 0 ? "needs_info" : "valid";
  return {
    version: validatorV2Version,
    status,
    hardIssues,
    softIssues,
    repairableIssues,
    issues,
    checkedAt,
    articleTitle: clean(normalized?.title),
    eventResults,
  };
}

function addExtractionDecisionIssues({ extraction, hardIssues }) {
  const decision = normalizedToken(extraction.decision);
  if (decision === "non_event") {
    addIssue(hardIssues, {
      code: "extraction_non_event",
      severity: "hard",
      message: "Extraction decision is non_event.",
    });
  }
  if (decision === "failed") {
    addIssue(hardIssues, {
      code: "extraction_failed",
      severity: "hard",
      message: "Extraction failed before validation.",
    });
  }
}

function addClassificationIssue({ target, eventIndex, hardIssues }) {
  const classification = normalizedToken(
    target?.classification ?? target?.articleType ?? target?.contentType ?? target?.type,
  );
  const code = hardClassifications.get(classification);
  if (!code) return;
  addIssueLike(hardIssues, {
    code,
    severity: "hard",
    eventIndex,
    message: `Classification ${classification} is not a publicly attendable event.`,
  });
}

function addPublicEligibilityIssue({ extraction, hardIssues }) {
  const eligibility = normalizedToken(extraction.publicEligibility);
  if (eligibility && !generalPublicValues.has(eligibility) && nonPublicValues.has(eligibility)) {
    addIssue(hardIssues, {
      code: "public_eligibility_not_public",
      severity: "hard",
      message: "Extraction says the item is not open to the general public.",
    });
  }
}

function addLowConfidenceIssue({ extraction, softIssues }) {
  const confidence = Number(extraction.confidence);
  if (Number.isFinite(confidence) && confidence < 0.5) {
    addIssue(softIssues, {
      code: "extraction_confidence_low",
      severity: "soft",
      repairable: false,
      message: "Extraction confidence is below the publish threshold.",
    });
  }
}

function addEventPublicAudienceIssues({ event, eventIndex, pushHard }) {
  const audience = normalizedToken(event?.audience ?? event?.publicEligibility);
  if (audience && nonPublicValues.has(audience)) {
    pushHard({
      code: "audience_not_general_public",
      severity: "hard",
      eventIndex,
      message: "Event audience is not the general public.",
    });
  }
}

function addCityIssue({ event, eventIndex, pushHard, pushSoft }) {
  const city = normalizedToken(event?.city);
  if (!city) {
    pushSoft({
      code: "event_city_missing",
      severity: "soft",
      repairable: true,
      eventIndex,
      message: "Event city is missing.",
    });
    return;
  }
  if (beijingValues.has(city)) return;
  if (outsideBeijingValues.has(city) || outsideBeijingValues.has(city.replace(/^cn-/, ""))) {
    pushHard({
      code: "city_not_beijing",
      severity: "hard",
      eventIndex,
      message: "Event city is clearly outside Beijing.",
    });
  }
}

function addScheduleIssues({ event, eventIndex, now, extraction, pushHard, pushSoft }) {
  const startsAt = parseTimestamp(event?.startsAt);
  const endsAt = parseTimestamp(event?.endsAt);
  const hasStart = Boolean(clean(event?.startsAt));
  const hasScheduleText = Boolean(clean(event?.scheduleText));
  const hasOccurrenceDetails = Boolean(
    (Array.isArray(event?.occurrences) && event.occurrences.length > 0)
      || (Array.isArray(event?.occurrenceStartsAt) && event.occurrenceStartsAt.length > 0),
  );
  const hasRecurringMarker = Boolean(event?.recurrence || event?.recurring || event?.occurrence);
  const hasRecurringShape = hasRecurringMarker || hasOccurrenceDetails;
  const hasLongRunningShape = hasStart && Boolean(clean(event?.endsAt))
    && (hasScheduleText || Boolean(clean(event?.openingHours)));

  if (!hasStart && !hasRecurringShape && !hasScheduleText) {
    pushSoft({
      code: "event_schedule_missing",
      severity: "soft",
      repairable: true,
      eventIndex,
      message: "Event start, recurrence, or attendance schedule is missing.",
    });
  }
  if (hasRecurringMarker && !hasOccurrenceDetails && !hasScheduleText && !hasStart) {
    pushSoft({
      code: "recurring_schedule_text_missing",
      severity: "soft",
      repairable: true,
      eventIndex,
      message: "Recurring event needs schedule text or occurrence details.",
    });
  }
  if (hasStart && startsAt === undefined) {
    pushSoft({
      code: "event_start_invalid",
      severity: "soft",
      repairable: true,
      eventIndex,
      message: "Event start time could not be parsed.",
    });
  }
  if (clean(event?.endsAt) && endsAt === undefined) {
    pushSoft({
      code: "event_end_invalid",
      severity: "soft",
      repairable: true,
      eventIndex,
      message: "Event end time could not be parsed.",
    });
  }
  if (startsAt !== undefined && endsAt !== undefined && endsAt < startsAt) {
    pushHard({
      code: "event_date_order_invalid",
      severity: "hard",
      eventIndex,
      message: "Event end is before event start.",
    });
  }
  if (startsAt !== undefined && endsAt !== undefined && isLongRunning(startsAt, endsAt) && !hasLongRunningShape) {
    pushSoft({
      code: "long_running_schedule_missing",
      severity: "soft",
      repairable: true,
      eventIndex,
      message: "Long-running event needs date range and opening schedule.",
    });
  }

  const endedAt = endsAt ?? startsAt;
  if (endedAt !== undefined && endedAt < Date.parse(now) && isRecapLike(extraction, event)) {
    pushHard({
      code: "event_past_or_recap_only",
      severity: "hard",
      eventIndex,
      message: "Event appears to be a past-only recap.",
    });
  }
}

function addAttendancePathIssue({ event, eventIndex, pushSoft }) {
  const hasVenue = Boolean(clean(event?.venue) || clean(event?.venueName) || clean(event?.address) || clean(event?.venueAddress));
  const hasOnlinePath = Boolean(clean(event?.onlineUrl) || clean(event?.onlinePath) || clean(event?.onlinePlatform) || clean(event?.attendanceUrl));
  if (!hasVenue && !hasOnlinePath) {
    pushSoft({
      code: "event_attendance_path_missing",
      severity: "soft",
      repairable: true,
      eventIndex,
      message: "Event venue or online attendance path is missing.",
    });
  }
}

function addRegistrationIssue({ event, eventIndex, normalized, pushSoft }) {
  const action = normalizedToken(event?.registrationAction ?? event?.registrationStatus);
  const required = actionRequiresEvidence(action) || event?.registrationRequired === true;
  if (!required) return;
  const sourceUrl = clean(normalized?.sourceUrl);
  if (sourceUrl && registrationPathMatchesSourceArticle({ event, sourceUrl })) {
    pushSoft({
      code: "registration_url_is_source_article",
      severity: "soft",
      repairable: true,
      eventIndex,
      message: "Registration URL points back to the source article instead of an actionable registration path.",
    });
  }
  const hasRegistrationEvidence = hasEvidenceForRegistrationAction({ event, action, sourceUrl });
  if (!hasRegistrationEvidence) {
    pushSoft({
      code: "registration_evidence_missing",
      severity: "soft",
      repairable: true,
      eventIndex,
      message: "Registration is required but no URL, QR, or evidence path is present.",
    });
  }
}

function actionRequiresEvidence(action) {
  return [
    "required",
    "registration_required",
    "qr_code",
    "mini_program",
    "external_url",
  ].includes(action);
}

function hasEvidenceForRegistrationAction({ event, action, sourceUrl }) {
  if (action === "external_url") return hasExternalRegistrationPath(event, { sourceUrl });
  if (action === "qr_code") {
    return hasQrRegistrationPath(event, { sourceUrl });
  }
  if (action === "mini_program") {
    return hasMiniProgramRegistrationPath(event, { sourceUrl });
  }
  return Boolean(
    hasExternalRegistrationPath(event, { sourceUrl })
      || hasQrRegistrationPath(event, { sourceUrl })
      || hasMiniProgramRegistrationPath(event, { sourceUrl }),
  );
}

function hasExternalRegistrationPath(event, { sourceUrl } = {}) {
  return Boolean(
    actionableUrl(event?.registrationUrl, { sourceUrl })
      || evidenceHasRegistrationPath(event?.evidence, { allowImageEvidence: false, sourceUrl }),
  );
}

function hasQrRegistrationPath(event, { sourceUrl } = {}) {
  return Boolean(
    clean(event?.registrationQr)
      || actionableUrl(event?.registrationQrUrl, { sourceUrl })
      || evidenceHasRegistrationPath(event?.evidence, { expectedRoles: ["qr", "registration_qr", "registration"], sourceUrl }),
  );
}

function hasMiniProgramRegistrationPath(event, { sourceUrl } = {}) {
  return Boolean(
    clean(event?.miniProgramPath)
      || clean(event?.miniProgramAppId)
      || clean(event?.registrationMiniProgram)
      || evidenceHasRegistrationPath(event?.evidence, { expectedRoles: ["mini_program", "registration"], sourceUrl }),
  );
}

function evidenceHasRegistrationPath(evidence, {
  allowImageEvidence = true,
  expectedRoles = ["registration"],
  sourceUrl,
} = {}) {
  if (!Array.isArray(evidence)) return false;
  return evidence.some((item) => {
    if (!item || typeof item !== "object") return false;
    if (
      actionableUrl(item.url, { sourceUrl })
        || actionableUrl(item.href, { sourceUrl })
        || actionableUrl(item.qrUrl, { sourceUrl })
        || actionableUrl(item.imageUrl, { sourceUrl })
    ) return true;
    if (!allowImageEvidence) return false;
    const role = normalizedToken(item.role);
    if (role && !expectedRoles.includes(role)) return false;
    return Boolean(clean(item.imageId) || clean(item.assetId) || clean(item.storagePath));
  });
}

function registrationPathMatchesSourceArticle({ event, sourceUrl }) {
  return [
    event?.registrationUrl,
    event?.registrationQrUrl,
  ].some((value) => urlsMatch(value, sourceUrl));
}

function actionableUrl(value, { sourceUrl } = {}) {
  const url = clean(value);
  if (!url) return undefined;
  if (sourceUrl && urlsMatch(url, sourceUrl)) return undefined;
  return url;
}

function urlsMatch(left, right) {
  const leftUrl = canonicalUrl(left);
  const rightUrl = canonicalUrl(right);
  return Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
}

function canonicalUrl(value) {
  const text = clean(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return text;
  }
}

function isRecapLike(extraction, event) {
  const text = [
    extraction?.classification,
    extraction?.reason,
    extraction?.publicEligibilityReason,
    event?.classification,
    event?.title,
    event?.summary,
    event?.scheduleText,
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");
  return /recap|review|past-only|past only|回顾|圆满|举行了|已举办|活动结束|新闻/.test(text);
}

function isLongRunning(startsAt, endsAt) {
  const dayMs = 24 * 60 * 60 * 1000;
  return endsAt - startsAt >= dayMs;
}

function addIssueLike(target, issue) {
  if (typeof target?.push === "function") {
    target.push(compactIssue(issue));
  } else {
    addIssue(target, issue);
  }
}

function addIssue(list, issue) {
  if (!Array.isArray(list)) return;
  list.push(compactIssue(issue));
}

function compactIssue(issue) {
  return Object.fromEntries(
    Object.entries(issue).filter(([, value]) => value !== undefined),
  );
}

function parseTimestamp(value) {
  const text = clean(value);
  if (!text) return undefined;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error("v5_validator_now_invalid");
  return date.toISOString();
}

function normalizedToken(value) {
  const text = clean(value);
  return text ? text.toLowerCase() : undefined;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
