export type AnalyzeDataClass = "production" | "eval" | "test" | "smoke";
export type AnalyzeMode = AnalyzeDataClass;

export type AnalyzeRequest = {
  sourceUrl: string;
  publishedAt?: string;
  bundleId: string;
  storagePrefix: string;
  contentHash: string;
  sourceProvider: string;
  sourceId?: string;
  sourceName?: string;
  dataClass: AnalyzeDataClass;
  evalRunId?: string;
};

export type ArticleBundleWriteResult =
  | "written"
  | "skipped_existing"
  | "skipped_processed";

export type BundleImage = {
  imageId: string;
  storagePath: string;
  bundleStoragePath?: string;
  hasBytes?: boolean;
  sourceUrl?: string;
  publicUrl?: string;
  contentType?: string;
  contentHash?: string;
  byteLength?: number;
  width?: number;
  height?: number;
  altText?: string;
  nearbyText?: string;
  roleHint?: string;
};

export type ArticleBundle = {
  manifest: Record<string, unknown>;
  html: string;
  text: string;
  links: unknown[];
  diagnostics: unknown[];
  images: BundleImage[];
};

export type StorageReader = {
  downloadText(bucket: string, path: string): Promise<string | null>;
  downloadBytes?(bucket: string, path: string): Promise<Uint8Array | null>;
  uploadBytes?(
    bucket: string,
    path: string,
    body: Uint8Array,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<void>;
  createSignedUrl?(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<string | null>;
  createPublicUrl?(bucket: string, path: string): Promise<string>;
};

export type ProviderInputPart =
  | { type: "text"; text: string }
  | { type: "image_metadata"; image: BundleImage }
  | { type: "image_url"; imageUrl: string; imageId: string };

export type ProviderInput = {
  system: string;
  user: ProviderInputPart[];
  responseFormat: "json";
};

export type UsageMetrics = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costMicroCny?: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
  latencyMs?: number;
};

export type ProviderResponse = {
  json: string;
  usage?: Partial<UsageMetrics>;
  raw?: unknown;
};

export type AnalysisProvider = {
  name: string;
  model: string;
  analyze(input: ProviderInput): Promise<ProviderResponse>;
};

export type EvidenceSelection = {
  imageId: string;
  role: "cover" | "poster" | "qr" | "registration" | "article_image";
  confidence?: number;
};

export type ExtractedEvent = {
  title: string;
  originalTitle?: string;
  organizer?: string;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  city?: string;
  venueName?: string;
  venueAddress?: string;
  reservationStatus?: "required" | "not_required" | "unknown";
  registrationAction?: string;
  registrationUrl?: string;
  scheduleText?: string;
  summary?: string;
  entryNotes?: string;
  publicEligibility?: "public" | "not_public" | "unclear";
  triageDecision?:
    | "public_activity"
    | "possible_public_activity"
    | "official_visit"
    | "non_public_news"
    | "internal_or_private"
    | "not_event"
    | "unsupported";
  triageAction?: "extract" | "exclude" | "review";
  eventKind?:
    | "single"
    | "multi_day"
    | "long_running"
    | "recurring"
    | "news"
    | "visit"
    | "cancellation"
    | "unsupported";
  scheduleKind?:
    | "single"
    | "multi_day"
    | "long_running"
    | "recurring"
    | "unsupported";
  recurrenceRule?: string;
  occurrenceStartsAt?: string[];
  confidence?: number;
  publicSignals?: string[];
  exclusionSignals?: string[];
  evidence?: EvidenceSelection[];
  fieldEvidence?: Record<string, unknown>;
  publish?: {
    createCanonicalEvent?: boolean;
    confidence?: number;
  };
};

export type AnalysisOutput = {
  decision:
    | "published"
    | "needs_review"
    | "needs_info"
    | "excluded"
    | "duplicate";
  reason: string;
  confidence: number;
  events: ExtractedEvent[];
  excludedArticle?: {
    triageDecision: string;
    exclusionReason: string;
    publicSignals?: string[];
    exclusionSignals?: string[];
    evidence?: EvidenceSelection[];
  };
  dedupe: {
    decision:
      | "new_event"
      | "same_event"
      | "update_existing"
      | "cancel_existing"
      | "withdraw_existing"
      | "insufficient_info";
    confidence?: number;
    candidates?: unknown[];
    reasoning?: string;
  };
  usage: UsageMetrics;
};

export type DatabaseWriter = {
  insert(
    table: string,
    payload: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<unknown>;
  upsert?(
    table: string,
    payload: Record<string, unknown>,
    options?: { onConflict?: string },
  ): Promise<unknown>;
  writeArticleBundle?(
    payload: Record<string, unknown>,
    status: "analysis_started" | "processed" | "failed",
  ): Promise<ArticleBundleWriteResult>;
  findCanonicalCandidates?(
    event: ExtractedEvent,
    request: AnalyzeRequest,
  ): Promise<unknown[]>;
  findArticleBundle?(
    bundleId: string,
    dataClass: AnalyzeDataClass,
  ): Promise<{ status?: string } | null>;
};
