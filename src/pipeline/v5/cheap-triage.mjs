import { createAttemptTrace, createUsagePlaceholder } from "./contracts.mjs";

export const cheapTriageVersion = "v5-cheap-triage.v1";
export const cheapTriageSchemaVersion = "v5-cheap-triage-result.v1";

export function createMockCheapTriageProvider({ behavior = "heuristic" } = {}) {
  return {
    id: "mock-cheap-triage",
    provider: "mock",
    model: "mock-cheap-triage",
    promptVersion: "v5-cheap-triage.mock-prompt.v1",
    schemaVersion: cheapTriageSchemaVersion,
    live: false,
    behavior,
    async triage({ packet } = {}) {
      return mockDecisionForPacket({ packet, behavior });
    },
  };
}

export function resolveCheapTriageProvider({
  live = false,
  allowLive = false,
  maxCostMicroCny,
  providerName,
  model,
  liveCall,
} = {}) {
  if (!live) return createMockCheapTriageProvider();
  return createLiveCheapTriageProvider({
    allowLive,
    maxCostMicroCny,
    providerName,
    model,
    call: liveCall,
  });
}

export function createLiveCheapTriageProvider({
  allowLive = false,
  maxCostMicroCny,
  providerName = "openai-compatible",
  model,
  promptVersion = "cheap-triage-live.v1",
  schemaVersion = cheapTriageSchemaVersion,
  call,
} = {}) {
  if (allowLive !== true) throw new Error("cheap_triage_live_requires_allow_live");
  if (!positiveInteger(maxCostMicroCny)) throw new Error("cheap_triage_live_budget_required");
  if (typeof call !== "function") throw new Error("cheap_triage_live_call_required");
  const guard = createCheapTriageBudgetGuard({ maxCostMicroCny });
  return {
    id: `live-${safeId(model ?? providerName)}`,
    provider: clean(providerName) ?? "openai-compatible",
    model: clean(model) ?? "configured-live-model",
    promptVersion,
    schemaVersion,
    live: true,
    async triage({ packet, context } = {}) {
      guard.assertCanSpend();
      const output = await call({ packet, context });
      const usage = createUsagePlaceholder(output?.usage);
      guard.recordCost(usage.costMicroCny);
      return {
        ...output,
        usage,
      };
    },
  };
}

export function createCheapTriageBudgetGuard({ maxCostMicroCny } = {}) {
  if (!positiveInteger(maxCostMicroCny)) throw new Error("cheap_triage_budget_required");
  let spentMicroCny = 0;
  return {
    recordCost(costMicroCny = 0) {
      const cost = nonNegativeInteger(
        typeof costMicroCny === "object" ? costMicroCny?.costMicroCny : costMicroCny,
      );
      if (spentMicroCny + cost > maxCostMicroCny) {
        throw new Error("cheap_triage_budget_exceeded");
      }
      spentMicroCny += cost;
      return {
        maxCostMicroCny,
        spentCostMicroCny: spentMicroCny,
        remainingCostMicroCny: Math.max(maxCostMicroCny - spentMicroCny, 0),
      };
    },
    assertCanSpend() {
      if (spentMicroCny >= maxCostMicroCny) throw new Error("cheap_triage_budget_exceeded");
      return true;
    },
    snapshot() {
      return {
        maxCostMicroCny,
        spentCostMicroCny: spentMicroCny,
        remainingCostMicroCny: Math.max(maxCostMicroCny - spentMicroCny, 0),
      };
    },
    getSpentCostMicroCny() {
      return spentMicroCny;
    },
  };
}

export async function runCheapTriage({
  packet,
  provider = createMockCheapTriageProvider(),
  context,
  now = new Date(),
} = {}) {
  if (!packet || typeof packet !== "object") throw new Error("cheap_triage_packet_required");
  if (!provider || typeof provider.triage !== "function") {
    throw new Error("cheap_triage_provider_required");
  }

  const startedAt = isoTimestamp(now);
  const output = await provider.triage({ packet, context });
  const usage = createUsagePlaceholder(output?.usage, {
    latencyMs: output?.usage?.latencyMs ?? 0,
  });
  const finishedAt = new Date(Date.parse(startedAt) + usage.latencyMs).toISOString();
  const decision = normalizeDecision(output?.decision);
  const needsVision = Boolean(output?.needsVision ?? decision === "needs_vision");
  const reason = clean(output?.reason) ?? "cheap triage completed";
  const attempt = createAttemptTrace({
    attempt: 1,
    provider: provider.provider,
    model: provider.model,
    promptVersion: provider.promptVersion,
    schemaVersion: provider.schemaVersion,
    usage,
    startedAt,
    finishedAt,
    reason,
    validatorIssues: [],
  });

  return {
    version: cheapTriageVersion,
    decision,
    confidence: boundedConfidence(output?.confidence),
    needsVision,
    reason,
    riskFlags: Array.isArray(output?.riskFlags) ? output.riskFlags.map(String) : [],
    provider: provider.provider,
    model: provider.model,
    promptVersion: provider.promptVersion,
    schemaVersion: provider.schemaVersion,
    usage,
    attempts: [attempt],
    createdAt: finishedAt,
  };
}

function mockDecisionForPacket({ packet, behavior }) {
  if (behavior === "always_uncertain") {
    return mockOutput({ decision: "uncertain", confidence: 0.5, reason: "forced uncertain mock" });
  }

  const text = String(packet?.packetText ?? "").toLowerCase();
  const estimatedTokens = nonNegativeInteger(packet?.estimatedTokens);
  const usage = createUsagePlaceholder({
    inputTokens: estimatedTokens,
    outputTokens: 12,
    totalTokens: estimatedTokens + 12,
    costMicroCny: 0,
    latencyMs: 0,
  });

  if (
    text.includes("needs_vision") ||
    text.includes("image_heavy_article") ||
    text.includes("registration_qr_not_resolved") ||
    text.includes("海报长图") ||
    (text.includes("## images") && (text.includes("qr") || text.includes("二维码"))) ||
    (text.includes("poster") && (text.includes("qr") || text.includes("二维码")))
  ) {
    return mockOutput({
      decision: "needs_vision",
      confidence: 0.78,
      reason: "mock detected vision-dependent registration or image-heavy content",
      needsVision: true,
      riskFlags: ["image_heavy", "qr_unresolved"],
      usage,
    });
  }

  if (
    text.includes("likely_non_event") ||
    text.includes("official_visit_or_meeting") ||
    text.includes("news_or_statement") ||
    text.includes("negative product judgment") ||
    text.includes("会见") ||
    text.includes("会谈")
  ) {
    return mockOutput({
      decision: "non_event",
      confidence: 0.82,
      reason: "mock detected negative/non-event signals",
      riskFlags: ["official_news"],
      usage,
    });
  }

  if (
    text.includes("likely_event") ||
    text.includes("报名") ||
    text.includes("预约") ||
    text.includes("registration") ||
    text.includes("mini_program") ||
    text.includes("讲座") ||
    text.includes("活动")
  ) {
    return mockOutput({
      decision: "candidate",
      confidence: 0.86,
      reason: "mock detected public event candidate signals",
      usage,
    });
  }

  return mockOutput({
    decision: "uncertain",
    confidence: 0.55,
    reason: "mock did not find enough event or exclusion signals",
    riskFlags: ["low_signal"],
    usage,
  });
}

function mockOutput({
  decision,
  confidence,
  reason,
  needsVision = false,
  riskFlags = [],
  usage = createUsagePlaceholder(),
}) {
  return { decision, confidence, reason, needsVision, riskFlags, usage };
}

function normalizeDecision(value) {
  const decision = clean(value);
  if (["candidate", "non_event", "uncertain", "needs_vision"].includes(decision)) {
    return decision;
  }
  return "uncertain";
}

function boundedConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(Math.max(number, 0), 1);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function safeId(value) {
  return String(value ?? "provider")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider";
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error("cheap_triage_now_invalid");
  return date.toISOString();
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
