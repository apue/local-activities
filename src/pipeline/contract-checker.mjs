const allowedModes = new Set(["production", "eval", "test", "mock", "smoke"]);

export class PipelineContractError extends Error {
  constructor({ nodeName, violations }) {
    super(`pipeline_contract_violation:${nodeName}:${violations.map((item) => item.reason).join(",")}`);
    this.name = "PipelineContractError";
    this.nodeName = nodeName;
    this.violations = violations;
  }
}

export function checkPipelineContract({ nodeName, payload, context } = {}) {
  const violations = collectPipelineContractViolations({ nodeName, payload, context });
  if (violations.length > 0) {
    throw new PipelineContractError({ nodeName, violations });
  }
  return true;
}

export function collectPipelineContractViolations({ nodeName, payload, context } = {}) {
  const violations = [];
  if (!clean(nodeName)) {
    violations.push({ reason: "contract_node_name_required" });
  }
  violations.push(...contextViolations(context));
  if (nodeName === "analysis_input") {
    violations.push(...analysisInputViolations(payload));
  }
  return violations;
}

export function isPipelineContractError(error) {
  return error instanceof PipelineContractError || error?.name === "PipelineContractError";
}

function contextViolations(context) {
  const violations = [];
  if (!context || typeof context !== "object") {
    return [{ reason: "contract_context_required" }];
  }
  if (!allowedModes.has(context.mode)) {
    violations.push({ reason: "contract_context_mode_invalid", value: context.mode });
  }
  if (!clean(context.runId)) {
    violations.push({ reason: "contract_context_run_id_required" });
  }
  return violations;
}

function analysisInputViolations(payload) {
  const violations = [];
  if (!payload || typeof payload !== "object") {
    return [{ reason: "analysis_input_required" }];
  }
  if (!Array.isArray(payload.images)) {
    violations.push({ reason: "analysis_input_images_required" });
    return violations;
  }
  for (const image of payload.images) {
    const sourceUrl = clean(image.metadata?.sourceUrl);
    const assetUrl = clean(image.asset?.url);
    if (assetUrl && sourceUrl && assetUrl === sourceUrl) {
      violations.push({
        reason: "analysis_input_image_asset_uses_capture_reference",
        imageId: image.imageId,
      });
    }
  }
  if (payload.requiredCapabilities?.vision) {
    if (payload.eligibility?.liveVisionEligible === false) {
      violations.push({
        reason: "analysis_input_live_vision_not_eligible",
        details: payload.eligibility?.reason,
      });
    }
    const hasConsumableAsset = payload.images.some((image) => clean(image.asset?.url));
    if (!hasConsumableAsset) {
      violations.push({ reason: "analysis_input_vision_asset_required" });
    }
  }
  return violations;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
