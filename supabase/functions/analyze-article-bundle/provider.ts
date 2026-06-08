import type {
  AnalysisOutput,
  AnalysisProvider,
  AnalyzeRequest,
  ArticleBundle,
  BundleImage,
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
    user.push({ type: "image_metadata", image: metadataImage(image) });
    if (image.publicUrl) {
      user.push({
        type: "image_url",
        imageUrl: image.publicUrl,
        imageId: image.imageId,
      });
    }
  }

  return {
    system: [
      "You analyze official Beijing cultural activity articles. Return strict JSON only.",
      "Apply public event eligibility rules: public attendance or registration signals are required; internal/private/news-only/official visit articles must be excluded.",
      "Do not return prose. Do not return an eligible boolean. Always return this JSON object shape:",
      '{"decision":"published|needs_review|needs_info|excluded|duplicate","reason":"short reason","confidence":0.0,"events":[],"excludedArticle":{"triageDecision":"not_event|non_public_news|official_visit|internal_or_private|unsupported","exclusionReason":"why excluded","publicSignals":[],"exclusionSignals":[]},"dedupe":{"decision":"new_event|same_event|update_existing|cancel_existing|withdraw_existing|insufficient_info","confidence":0.0,"candidates":[],"reasoning":"short dedupe reasoning"}}',
      "For non-events, set decision to excluded, events to [], and dedupe.decision to insufficient_info.",
      "Support multi-event extraction.",
      "For public events, include one event object per activity with title, organizer, startsAt, endsAt, timezone, city, venueName, venueAddress, reservationStatus, registrationAction, registrationUrl, scheduleText, summary, publicEligibility, triageDecision, triageAction, eventKind, scheduleKind, confidence, evidence, and publish.createCanonicalEvent.",
      "Select poster/QR evidence from image metadata and never rely on remote source URLs as stable product assets.",
    ].join(" "),
    user,
    responseFormat: "json",
  };
}

function metadataImage(image: BundleImage): BundleImage {
  if (!image.publicUrl?.startsWith("data:")) return image;
  return { ...image, publicUrl: undefined };
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
  fetchImpl = fetch,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): AnalysisProvider {
  return {
    name: "openai-compatible",
    model,
    async analyze(input: ProviderInput): Promise<ProviderResponse> {
      try {
        return await requestOpenAiCompatible({
          input,
          baseUrl,
          apiKey,
          model,
          maxOutputTokens,
          timeoutMs,
          fetchImpl,
        });
      } catch (error) {
        if (
          hasVisionImageUrl(input) &&
          error instanceof Error &&
          (/^provider_http_(400|403|413|500|502|503|504)/.test(
            error.message,
          ) || /^provider_timeout:/.test(error.message))
        ) {
          const textOnly = withoutVisionImageUrls(input);
          const response = await requestOpenAiCompatible({
            input: textOnly,
            baseUrl,
            apiKey,
            model,
            maxOutputTokens,
            timeoutMs,
            fetchImpl,
          });
          return {
            ...response,
            raw: {
              response: response.raw,
              fallback: "text_only_after_vision_http_error",
              visionError: error.message,
            },
          };
        }
        throw error;
      }
    },
  };
}

async function requestOpenAiCompatible({
  input,
  baseUrl,
  apiKey,
  model,
  maxOutputTokens,
  timeoutMs,
  fetchImpl,
}: {
  input: ProviderInput;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<ProviderResponse> {
  const started = Date.now();
  const controller = new AbortController();
  let timeoutId: number | undefined;
  try {
    const response = await withTimeout(
      fetchImpl(
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
      ),
      timeoutMs,
      () => controller.abort(),
      (id) => {
        timeoutId = id;
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `provider_http_${response.status}${
          text ? `:${text.slice(0, 300)}` : ""
        }`,
      );
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
  } catch (error) {
    if (
      controller.signal.aborted ||
      error instanceof Error &&
        error.message === `provider_timeout:${timeoutMs}`
    ) {
      throw new Error(`provider_timeout:${timeoutMs}`);
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  setTimerId: (id: number) => void,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const id = setTimeout(() => {
        onTimeout();
        reject(new Error(`provider_timeout:${timeoutMs}`));
      }, timeoutMs);
      setTimerId(id);
    }),
  ]);
}

function hasVisionImageUrl(input: ProviderInput): boolean {
  return input.user.some((part) => part.type === "image_url");
}

function withoutVisionImageUrls(input: ProviderInput): ProviderInput {
  return {
    ...input,
    user: input.user.filter((part) => part.type !== "image_url"),
  };
}

export function parseProviderOutput(
  response: ProviderResponse,
): AnalysisOutput {
  const value = JSON.parse(response.json) as unknown;
  if (!isRecord(value)) throw new Error("invalid_provider_output");
  const normalizedValue = normalizeEligibleFalseOutput(value);
  const usage = mergeUsage(normalizedValue.usage, response.usage);
  const decision = normalizeTopLevelDecision(normalizedValue.decision);
  const confidence = requiredConfidence(
    normalizedValue.confidence,
    "confidence",
  );
  const events = eventRecordsForDecision(normalizedValue.events, decision);
  const dedupe = isRecord(normalizedValue.dedupe)
    ? normalizedValue.dedupe
    : defaultDedupeForDecision(decision, confidence);
  return {
    decision,
    reason: requiredString(normalizedValue.reason, "reason"),
    confidence,
    events: events.map(normalizeEvent),
    excludedArticle: normalizeExcludedArticle(normalizedValue.excludedArticle),
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

function defaultDedupeForDecision(
  decision: AnalysisOutput["decision"],
  confidence: number,
): Record<string, unknown> {
  return {
    decision: ["published", "needs_review", "needs_info"].includes(decision)
      ? "new_event"
      : "insufficient_info",
    confidence,
    candidates: [],
    reasoning:
      "Provider omitted dedupe; backend assigned a conservative default.",
  };
}

function normalizeEligibleFalseOutput(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (value.decision !== undefined || value.eligible !== false) return value;
  const reason = clean(value.reason) ?? "Not a public activity.";
  return {
    ...value,
    decision: "excluded",
    reason,
    confidence: numberValue(value.confidence) ?? 0.8,
    events: [],
    excludedArticle: isRecord(value.excludedArticle) ? value.excludedArticle : {
      triageDecision: "not_event",
      exclusionReason: reason,
      publicSignals: [],
      exclusionSignals: [],
    },
    dedupe: isRecord(value.dedupe)
      ? value.dedupe
      : { decision: "insufficient_info", confidence: 0.8 },
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
  const timezone = clean(value.timezone) ?? "Asia/Shanghai";
  const city = clean(value.city) ?? "Beijing";
  const startsAt = normalizeEventDateTime(
    clean(value.startsAt),
    timezone,
    city,
  );
  const endsAt = normalizeEventDateTime(clean(value.endsAt), timezone, city);
  const eventKind = normalizeEventKind(value.eventKind);
  const scheduleKind = normalizeScheduleKindForEvent({
    scheduleKind: normalizeScheduleKind(value.scheduleKind),
    eventKind,
    startsAt,
    endsAt,
  });
  return {
    title: requiredString(value.title, "event_title"),
    originalTitle: clean(value.originalTitle),
    organizer: clean(value.organizer),
    startsAt,
    endsAt,
    timezone,
    city,
    venueName: clean(value.venueName),
    venueAddress: clean(value.venueAddress),
    reservationStatus: normalizeReservationStatus(value.reservationStatus),
    registrationAction: clean(value.registrationAction),
    registrationUrl: clean(value.registrationUrl),
    scheduleText: clean(value.scheduleText),
    summary: clean(value.summary),
    entryNotes: clean(value.entryNotes),
    publicEligibility: normalizePublicEligibility(value.publicEligibility),
    triageDecision: normalizeTriageDecision(value.triageDecision),
    triageAction: normalizeTriageAction(value.triageAction),
    eventKind,
    scheduleKind,
    recurrenceRule: clean(value.recurrenceRule),
    occurrenceStartsAt: stringArray(value.occurrenceStartsAt),
    confidence: clamp(numberValue(value.confidence) ?? 0),
    publicSignals: stringArray(value.publicSignals),
    exclusionSignals: stringArray(value.exclusionSignals),
    evidence: normalizeEvidenceSelections(value.evidence),
    fieldEvidence: isRecord(value.fieldEvidence) ? value.fieldEvidence : {},
    publish: isRecord(value.publish)
      ? {
        createCanonicalEvent: value.publish.createCanonicalEvent === true,
        confidence: clamp(numberValue(value.publish.confidence) ?? 0),
      }
      : undefined,
  };
}

function normalizeEventDateTime(
  value: string | undefined,
  timezone: string,
  city: string,
): string | undefined {
  if (!value) return undefined;
  if (!isChinaLocalContext(timezone, city)) return value;
  if (value.endsWith("Z")) {
    return `${value.slice(0, -1)}+08:00`;
  }
  return value.replace(/\+00:00$/, "+08:00");
}

function isChinaLocalContext(timezone: string, city: string): boolean {
  const normalizedTimezone = timezone.trim().toLowerCase();
  if (
    ["asia/shanghai", "asia/chongqing", "asia/harbin"].includes(
      normalizedTimezone,
    )
  ) return true;
  const normalizedCity = city.trim().toLowerCase();
  return [
    "beijing",
    "北京",
    "北京市",
    "chongqing",
    "重庆",
    "成都",
    "chengdu",
    "苏州",
    "suzhou",
    "中国",
    "china",
    "全国多城",
  ].includes(normalizedCity);
}

function normalizeScheduleKindForEvent({
  scheduleKind,
  eventKind,
  startsAt,
  endsAt,
}: {
  scheduleKind:
    | "single"
    | "multi_day"
    | "long_running"
    | "recurring"
    | "unsupported";
  eventKind:
    | "single"
    | "multi_day"
    | "long_running"
    | "recurring"
    | "news"
    | "visit"
    | "cancellation"
    | "unsupported";
  startsAt?: string;
  endsAt?: string;
}) {
  if (scheduleKind !== "unsupported") return scheduleKind;
  if (!startsAt) return scheduleKind;
  if (
    ["single", "multi_day", "long_running", "recurring"].includes(eventKind)
  ) return eventKind as "single" | "multi_day" | "long_running" | "recurring";
  if (endsAt) return "single";
  return scheduleKind;
}

function normalizeExcludedArticle(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    triageDecision: clean(value.triageDecision) ?? "not_event",
    exclusionReason: clean(value.exclusionReason) ?? "not_public_activity",
    publicSignals: stringArray(value.publicSignals),
    exclusionSignals: stringArray(value.exclusionSignals),
    evidence: normalizeEvidenceSelections(value.evidence),
  };
}

function normalizeEvidenceSelections(value: unknown) {
  return Array.isArray(value)
    ? value.filter(isRecord).map((selection) => ({
      imageId: clean(selection.imageId) ?? "",
      role: normalizeEvidenceRole(selection.role),
      confidence: clamp(numberValue(selection.confidence) ?? 0),
    })).filter((selection) => selection.imageId)
    : [];
}

function normalizeEvidenceRole(
  value: unknown,
): "cover" | "poster" | "qr" | "registration" | "article_image" {
  const text = clean(value)?.toLowerCase();
  if (!text) return "article_image";
  if (text === "cover" || text.includes("cover") || text.includes("封面")) {
    return "cover";
  }
  if (
    text === "poster" ||
    text.includes("poster") ||
    text.includes("flyer") ||
    text.includes("海报")
  ) return "poster";
  if (
    text === "qr" ||
    text.includes("qr") ||
    text.includes("二维码")
  ) return "qr";
  if (
    text === "registration" ||
    text.includes("register") ||
    text.includes("报名") ||
    text.includes("预约")
  ) return "registration";
  return "article_image";
}

function normalizeReservationStatus(
  value: unknown,
): "required" | "not_required" | "unknown" {
  const text = clean(value)?.toLowerCase();
  if (!text) return "unknown";
  if (
    text === "unknown" ||
    text.includes("unknown") ||
    text.includes("unclear") ||
    text.includes("not confirmed") ||
    text.includes("未确认") ||
    text.includes("不明确")
  ) return "unknown";
  if (text === "required" || text.includes("required")) return "required";
  if (
    text.includes("booking") ||
    text.includes("reservation") ||
    text.includes("registration") ||
    text.includes("预约") ||
    text.includes("报名")
  ) {
    return text.includes("not") || text.includes("no ")
      ? "not_required"
      : "required";
  }
  if (
    text === "not_required" ||
    text.includes("not required") ||
    text.includes("no reservation") ||
    text.includes("无需") ||
    text.includes("不需要")
  ) return "not_required";
  return "unknown";
}

function normalizePublicEligibility(
  value: unknown,
): "public" | "not_public" | "unclear" {
  const text = clean(value)?.toLowerCase();
  if (!text) return "unclear";
  if (
    text === "not_public" ||
    text === "not public" ||
    text.includes("不公开") ||
    text.includes("internal") ||
    text.includes("private")
  ) return "not_public";
  if (
    text === "unclear" ||
    text === "unknown" ||
    text.includes("unclear") ||
    text.includes("not clearly") ||
    text.includes("not confirmed") ||
    text.includes("未说明") ||
    text.includes("不明确")
  ) return "unclear";
  if (
    text === "public" ||
    text.includes("公开") ||
    text.includes("公众") ||
    text.includes("大众") ||
    text.includes("public") ||
    text.includes("open")
  ) {
    return text.includes("not public") || text.includes("private") ||
        text.includes("not clearly") ||
        text.includes("not confirmed") ||
        text.includes("unclear")
      ? "not_public"
      : "public";
  }
  return "unclear";
}

function normalizeTriageDecision(
  value: unknown,
):
  | "public_activity"
  | "possible_public_activity"
  | "official_visit"
  | "non_public_news"
  | "internal_or_private"
  | "not_event"
  | "unsupported" {
  const text = clean(value)?.toLowerCase();
  const aliases: Record<
    string,
    | "public_activity"
    | "possible_public_activity"
    | "official_visit"
    | "non_public_news"
    | "internal_or_private"
    | "not_event"
    | "unsupported"
  > = {
    public_activity: "public_activity",
    public_event: "public_activity",
    public: "public_activity",
    possible_public_activity: "possible_public_activity",
    possible_public_event: "possible_public_activity",
    official_visit: "official_visit",
    non_public_news: "non_public_news",
    news: "non_public_news",
    internal_or_private: "internal_or_private",
    private: "internal_or_private",
    not_event: "not_event",
    not_activity: "not_event",
    unsupported: "unsupported",
  };
  if (!text) return "possible_public_activity";
  const decision = aliases[text];
  return decision ?? "possible_public_activity";
}

function normalizeTriageAction(
  value: unknown,
): "extract" | "exclude" | "review" {
  const text = clean(value)?.toLowerCase();
  const aliases: Record<string, "extract" | "exclude" | "review"> = {
    extract: "extract",
    publish: "extract",
    published: "extract",
    include: "extract",
    exclude: "exclude",
    reject: "exclude",
    review: "review",
    needs_review: "review",
  };
  if (!text) return "review";
  const action = aliases[text];
  return action ?? "review";
}

function normalizeEventKind(
  value: unknown,
):
  | "single"
  | "multi_day"
  | "long_running"
  | "recurring"
  | "news"
  | "visit"
  | "cancellation"
  | "unsupported" {
  const text = clean(value)?.toLowerCase();
  const aliases: Record<
    string,
    | "single"
    | "multi_day"
    | "long_running"
    | "recurring"
    | "news"
    | "visit"
    | "cancellation"
    | "unsupported"
  > = {
    single: "single",
    seminar: "single",
    lecture: "single",
    talk: "single",
    workshop: "single",
    screening: "single",
    concert: "single",
    performance: "single",
    multi_day: "multi_day",
    exhibition: "long_running",
    long_running: "long_running",
    recurring: "recurring",
    news: "news",
    visit: "visit",
    cancellation: "cancellation",
    unsupported: "unsupported",
  };
  if (!text) return "single";
  const kind = aliases[text];
  return kind ?? "unsupported";
}

function normalizeScheduleKind(
  value: unknown,
): "single" | "multi_day" | "long_running" | "recurring" | "unsupported" {
  const text = clean(value)?.toLowerCase();
  const aliases: Record<
    string,
    "single" | "multi_day" | "long_running" | "recurring" | "unsupported"
  > = {
    single: "single",
    single_session: "single",
    single_event: "single",
    event: "single",
    one_time: "single",
    one_off: "single",
    multi_day: "multi_day",
    long_running: "long_running",
    exhibition: "long_running",
    recurring: "recurring",
    unsupported: "unsupported",
  };
  if (!text) return "single";
  const kind = aliases[text];
  return kind ?? "unsupported";
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

function normalizeTopLevelDecision(
  value: unknown,
): "published" | "needs_review" | "needs_info" | "excluded" | "duplicate" {
  const text = clean(value)?.toLowerCase();
  const aliases: Record<
    string,
    "published" | "needs_review" | "needs_info" | "excluded" | "duplicate"
  > = {
    published: "published",
    publish: "published",
    auto_publish: "published",
    needs_review: "needs_review",
    review: "needs_review",
    needs_info: "needs_info",
    needs_information: "needs_info",
    insufficient_info: "needs_info",
    excluded: "excluded",
    exclude: "excluded",
    not_event: "excluded",
    not_activity: "excluded",
    not_public_activity: "excluded",
    non_public_news: "excluded",
    news: "excluded",
    official_visit: "excluded",
    internal_or_private: "excluded",
    duplicate: "duplicate",
    possible_duplicate: "duplicate",
    same_event: "duplicate",
  };
  const decision = text ? aliases[text] : undefined;
  if (!decision) throw new Error("invalid_decision");
  return decision;
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

function eventRecordsForDecision(
  value: unknown,
  decision:
    | "published"
    | "needs_review"
    | "needs_info"
    | "excluded"
    | "duplicate",
): Record<string, unknown>[] {
  if (decision === "excluded" && value === undefined) return [];
  return requiredRecordArray(value, "events", "event");
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
