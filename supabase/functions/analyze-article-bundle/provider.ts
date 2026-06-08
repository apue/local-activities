import type {
  AnalysisOutput,
  AnalysisProvider,
  AnalyzeRequest,
  ArticleBundle,
  ProviderInput,
  ProviderInputPart,
  ProviderResponse,
  UsageMetrics,
} from "./types.ts";

export const promptVersion = "analyze-article-bundle-v1";
export const schemaVersion = "analysis-output-v1";

export function buildProviderInput({
  request,
  bundle,
}: {
  request: AnalyzeRequest;
  bundle: ArticleBundle;
}): ProviderInput {
  const user: ProviderInputPart[] = [
    {
      type: "text",
      text: JSON.stringify({
        sourceUrl: request.sourceUrl,
        publishedAt: request.publishedAt,
        sourceProvider: request.sourceProvider,
        sourceName: request.sourceName,
        articleText: bundle.text.slice(0, 24000),
        articleHtmlSummary: summarizeHtml(bundle.html),
        links: bundle.links,
        diagnostics: bundle.diagnostics,
      }),
    },
  ];
  for (const image of bundle.images) {
    user.push({ type: "image_metadata", image });
    if (image.publicUrl) {
      user.push({
        type: "image_url",
        imageUrl: image.publicUrl,
        imageId: image.imageId,
      });
    }
  }

  return {
    system:
      "You analyze official Beijing cultural activity articles. Return strict JSON only. Apply public event eligibility rules: public attendance or registration signals are required, internal/private/news-only/official visit articles should be excluded. Support multi-event extraction. Select poster/QR evidence from image metadata and never rely on remote source URLs as stable product assets.",
    user,
    responseFormat: "json",
  };
}

export function createMockProvider(
  { output }: { output: AnalysisOutput },
): AnalysisProvider {
  return {
    name: "mock",
    model: "mock-vision",
    async analyze() {
      return { json: JSON.stringify(output), usage: output.usage };
    },
  };
}

export function createOpenAiCompatibleProvider({
  baseUrl,
  apiKey,
  model,
  maxOutputTokens,
  timeoutMs = 30000,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): AnalysisProvider {
  return {
    name: "openai-compatible",
    model,
    async analyze(input: ProviderInput): Promise<ProviderResponse> {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(
          `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: input.system },
                { role: "user", content: providerContent(input.user) },
              ],
              response_format: { type: "json_object" },
              max_tokens: maxOutputTokens,
              temperature: 0.1,
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`provider_http_${response.status}`);
        }
        const body = await response.json() as {
          choices?: { message?: { content?: string } }[];
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
            completion_tokens_details?: { reasoning_tokens?: number };
          };
        };
        const json = body.choices?.[0]?.message?.content;
        if (!json) throw new Error("provider_empty_output");
        return {
          json,
          raw: body,
          usage: {
            inputTokens: body.usage?.prompt_tokens,
            outputTokens: body.usage?.completion_tokens,
            totalTokens: body.usage?.total_tokens,
            cachedInputTokens: body.usage?.prompt_tokens_details?.cached_tokens,
            reasoningOutputTokens: body.usage?.completion_tokens_details
              ?.reasoning_tokens,
            latencyMs: Date.now() - started,
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function parseProviderOutput(
  response: ProviderResponse,
): AnalysisOutput {
  const value = JSON.parse(response.json) as unknown;
  if (!isRecord(value)) throw new Error("invalid_provider_output");
  const events = requiredRecordArray(value.events, "events", "event");
  const usage = mergeUsage(value.usage, response.usage);
  const decision = requiredStringEnum(value.decision, [
    "published",
    "needs_review",
    "needs_info",
    "excluded",
    "duplicate",
  ], "decision");
  const confidence = requiredConfidence(value.confidence, "confidence");
  if (!isRecord(value.dedupe)) throw new Error("missing_dedupe");
  const dedupe = value.dedupe;
  return {
    decision,
    reason: requiredString(value.reason, "reason"),
    confidence,
    events: events.map(normalizeEvent),
    excludedArticle: normalizeExcludedArticle(value.excludedArticle),
    dedupe: {
      decision: requiredStringEnum(dedupe.decision, [
        "new_event",
        "same_event",
        "update_existing",
        "cancel_existing",
        "withdraw_existing",
        "insufficient_info",
      ], "dedupe_decision"),
      confidence: clamp(numberValue(dedupe.confidence) ?? confidence),
      candidates: Array.isArray(dedupe.candidates) ? dedupe.candidates : [],
      reasoning: clean(dedupe.reasoning),
    },
    usage,
  };
}

function providerContent(parts: ProviderInputPart[]) {
  return parts.map((part) => {
    if (part.type === "image_url") {
      return { type: "image_url", image_url: { url: part.imageUrl } };
    }
    const text = part.type === "text"
      ? part.text
      : `Image metadata: ${JSON.stringify(part.image)}`;
    return { type: "text", text };
  });
}

function normalizeEvent(value: Record<string, unknown>) {
  return {
    title: requiredString(value.title, "event_title"),
    originalTitle: clean(value.originalTitle),
    organizer: clean(value.organizer),
    startsAt: clean(value.startsAt),
    endsAt: clean(value.endsAt),
    timezone: clean(value.timezone) ?? "Asia/Shanghai",
    city: clean(value.city) ?? "Beijing",
    venueName: clean(value.venueName),
    venueAddress: clean(value.venueAddress),
    reservationStatus: optionalStringEnum(value.reservationStatus, [
      "required",
      "not_required",
      "unknown",
    ], "reservation_status") ?? "unknown",
    registrationAction: clean(value.registrationAction),
    registrationUrl: clean(value.registrationUrl),
    scheduleText: clean(value.scheduleText),
    summary: clean(value.summary),
    entryNotes: clean(value.entryNotes),
    publicEligibility: optionalStringEnum(value.publicEligibility, [
      "public",
      "not_public",
      "unclear",
    ], "public_eligibility") ?? "unclear",
    triageDecision: optionalStringEnum(value.triageDecision, [
      "public_activity",
      "possible_public_activity",
      "official_visit",
      "non_public_news",
      "internal_or_private",
      "not_event",
      "unsupported",
    ], "triage_decision") ?? "possible_public_activity",
    triageAction: optionalStringEnum(
      value.triageAction,
      ["extract", "exclude", "review"],
      "triage_action",
    ) ?? "review",
    eventKind: optionalStringEnum(value.eventKind, [
      "single",
      "multi_day",
      "long_running",
      "recurring",
      "news",
      "visit",
      "cancellation",
      "unsupported",
    ], "event_kind") ?? "single",
    scheduleKind: optionalStringEnum(value.scheduleKind, [
      "single",
      "multi_day",
      "long_running",
      "recurring",
      "unsupported",
    ], "schedule_kind") ?? "single",
    recurrenceRule: clean(value.recurrenceRule),
    occurrenceStartsAt: stringArray(value.occurrenceStartsAt),
    confidence: clamp(numberValue(value.confidence) ?? 0),
    publicSignals: stringArray(value.publicSignals),
    exclusionSignals: stringArray(value.exclusionSignals),
    evidence: Array.isArray(value.evidence)
      ? value.evidence.filter(isRecord).map((selection) => ({
        imageId: clean(selection.imageId) ?? "",
        role: optionalStringEnum(selection.role, [
          "cover",
          "poster",
          "qr",
          "registration",
          "article_image",
        ], "evidence_role") ?? "article_image",
        confidence: clamp(numberValue(selection.confidence) ?? 0),
      })).filter((selection) => selection.imageId)
      : [],
    fieldEvidence: isRecord(value.fieldEvidence) ? value.fieldEvidence : {},
    publish: isRecord(value.publish)
      ? {
        createCanonicalEvent: value.publish.createCanonicalEvent === true,
        confidence: clamp(numberValue(value.publish.confidence) ?? 0),
      }
      : undefined,
  };
}

function normalizeExcludedArticle(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    triageDecision: clean(value.triageDecision) ?? "not_event",
    exclusionReason: clean(value.exclusionReason) ?? "not_public_activity",
    publicSignals: stringArray(value.publicSignals),
    exclusionSignals: stringArray(value.exclusionSignals),
    evidence: Array.isArray(value.evidence)
      ? value.evidence.filter(isRecord).map((selection) => ({
        imageId: clean(selection.imageId) ?? "",
        role: optionalStringEnum(selection.role, [
          "cover",
          "poster",
          "qr",
          "registration",
          "article_image",
        ], "evidence_role") ?? "article_image",
        confidence: clamp(numberValue(selection.confidence) ?? 0),
      })).filter((selection) => selection.imageId)
      : [],
  };
}

function mergeUsage(...values: unknown[]): UsageMetrics {
  const usage: UsageMetrics = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  for (const value of values) {
    if (!isRecord(value)) continue;
    usage.inputTokens = numberValue(value.inputTokens) ?? usage.inputTokens;
    usage.outputTokens = numberValue(value.outputTokens) ?? usage.outputTokens;
    usage.totalTokens = numberValue(value.totalTokens) ?? usage.totalTokens;
    usage.cachedInputTokens = numberValue(value.cachedInputTokens) ??
      usage.cachedInputTokens;
    usage.reasoningOutputTokens = numberValue(value.reasoningOutputTokens) ??
      usage.reasoningOutputTokens;
    usage.latencyMs = numberValue(value.latencyMs) ?? usage.latencyMs;
  }
  return usage;
}

function summarizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").slice(0, 4000);
}

function requiredString(value: unknown, field: string): string {
  if (value === undefined || value === null) {
    throw new Error(`missing_${field}`);
  }
  if (typeof value !== "string") throw new Error(`invalid_${field}`);
  const text = clean(value);
  if (!text) throw new Error(`missing_${field}`);
  return text;
}

function requiredStringEnum<T extends string>(
  value: unknown,
  allowed: T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`invalid_${field}`);
  }
  return value as T;
}

function optionalStringEnum<T extends string>(
  value: unknown,
  allowed: T[],
  field: string,
): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`invalid_${field}`);
  }
  return value as T;
}

function requiredConfidence(value: unknown, field: string): number {
  const number = numberValue(value);
  if (number === undefined || number < 0 || number > 1) {
    throw new Error(`invalid_${field}`);
  }
  return number;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => clean(item)).filter(Boolean) as string[]
    : [];
}

function requiredRecordArray(
  value: unknown,
  field: string,
  itemName: string,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`invalid_${field}`);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error(`invalid_${itemName}`);
    return item;
  });
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
