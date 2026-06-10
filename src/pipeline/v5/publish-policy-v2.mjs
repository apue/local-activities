export const publishPolicyV2Version = "v5-publish-policy.v2";

export function decideV5PublishState({ extraction, validation, editor } = {}) {
  const extractionDecision = clean(extraction?.decision);
  const validationStatus = clean(validation?.status);
  const editorDecision = clean(editor?.editorDecision);
  const reasons = [];
  let state;

  if (extractionDecision === "failed") {
    state = "failed";
    reasons.push("extraction_failed");
  } else if (extractionDecision === "non_event") {
    state = "excluded";
    reasons.push("extraction_non_event");
  } else if (hasHardValidationFailure(validation)) {
    state = "excluded";
    if (validationStatus === "invalid") reasons.push("validation_invalid");
    reasons.push(...issueCodes(validation));
  } else if (editorDecision === "failed") {
    state = "failed";
    reasons.push("editor_failed");
  } else if (hasSoftOrRepairableIssue(validation)) {
    state = "needs_info";
    if (validationStatus === "needs_info") reasons.push("validation_needs_info");
    reasons.push(...issueCodes(validation));
  } else if (editorDecision === "exclude") {
    state = "excluded";
    reasons.push("editor_exclude");
  } else if (editorDecision === "needs_info") {
    state = "needs_info";
    reasons.push("editor_needs_info");
  } else if (extractionDecision === "needs_review") {
    state = "needs_review";
    reasons.push("extraction_needs_review");
  } else if (isLowConfidence(extraction)) {
    state = "needs_review";
    reasons.push("extraction_confidence_low");
  } else if (editorDecision === "review") {
    state = "needs_review";
    reasons.push("editor_review");
  } else if (editorDecision === "publish" && validationStatus === "valid" && extractionDecision === "event") {
    state = "published";
    reasons.push("editor_publish_valid");
  } else {
    state = "needs_review";
    reasons.push("publish_policy_default_review");
  }

  return {
    version: publishPolicyV2Version,
    state,
    reasons: unique(reasons.filter(Boolean)),
    validationStatus,
    editorDecision,
    extractionDecision,
  };
}

function hasHardValidationFailure(validation) {
  if (clean(validation?.status) === "invalid") return true;
  if (Array.isArray(validation?.hardIssues) && validation.hardIssues.length > 0) return true;
  return Array.isArray(validation?.issues)
    && validation.issues.some((issue) => issue?.severity === "hard");
}

function hasSoftOrRepairableIssue(validation) {
  if (clean(validation?.status) === "needs_info") return true;
  if (Array.isArray(validation?.softIssues) && validation.softIssues.length > 0) return true;
  if (Array.isArray(validation?.repairableIssues) && validation.repairableIssues.length > 0) return true;
  return Array.isArray(validation?.issues)
    && validation.issues.some((issue) => issue?.severity === "soft" || issue?.repairable === true);
}

function issueCodes(validation) {
  const issues = [
    ...(Array.isArray(validation?.hardIssues) ? validation.hardIssues : []),
    ...(Array.isArray(validation?.softIssues) ? validation.softIssues : []),
    ...(Array.isArray(validation?.repairableIssues) ? validation.repairableIssues : []),
    ...(Array.isArray(validation?.issues) ? validation.issues : []),
  ];
  return unique(issues.map((issue) => clean(issue?.code)).filter(Boolean));
}

function isLowConfidence(extraction) {
  const confidence = Number(extraction?.confidence);
  return Number.isFinite(confidence) && confidence < 0.5;
}

function unique(values) {
  return [...new Set(values)];
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
