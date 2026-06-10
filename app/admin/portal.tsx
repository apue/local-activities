"use client";

import { useEffect, useMemo, useState } from "react";

import {
  adminApiRequest,
  loadAdminState,
  loginAdmin,
  patchAdminDraft,
} from "../../src/client/admin-portal-api";
import {
  canRunDraftReviewAction,
  formatDateTime,
  formatLlmCostCny,
  formatTokenCount,
  formatUsageTimestamp,
  getDraftEvidenceItems,
  getDraftBlockingReasons,
  getDraftSourceUrl,
  getReviewStateLabel,
  getUsageRangeLabel,
  isDraftPublishableForDisplay,
} from "../../src/client/admin-portal-utils";
import styles from "./portal.module.css";

type CollectorJob = {
  jobId: string;
  seedUrl: string;
  state: string;
  requestedAt: string;
  collectorId?: string;
  lastHeartbeatAt?: string;
  lastHeartbeatStage?: string;
  resultMessage?: string;
  preferredRunner: string;
  actualRunner?: string;
  runnerState: string;
  fallbackEligible: boolean;
  fallbackReason?: string;
  attemptNumber: number;
};

type EventDraft = {
  id: string;
  articleUrl: string;
  title?: string;
  organizer?: string;
  startsAt?: string;
  endsAt?: string;
  venueName?: string;
  venueAddress?: string;
  reservationStatus?: string;
  registrationUrl?: string;
  scheduleText?: string;
  posterImageUrl?: string;
  posterImageAlt?: string;
  posterImageSourceUrl?: string;
  posterAssetId?: string;
  qrAssetId?: string;
  registrationQrAssetId?: string;
  registrationQrImageUrl?: string;
  registrationQrImageAlt?: string;
  summary?: string;
  entryNotes?: string;
  hardBlockers?: PublishBlocker[];
  softBlockers?: PublishBlocker[];
  operatorOverrideReason?: string;
  publishDecision?: PublishDecision;
  confidence: number;
  reviewState: string;
  evidenceAssetIds: string[];
  fieldEvidence: Record<string, string[]>;
};

type PublishBlocker = {
  code: string;
  message: string;
};

type PublishDecision = {
  canPublish: boolean;
  canPublishWithOverride: boolean;
  requiresOperatorOverride: boolean;
  hardBlockers: PublishBlocker[];
  softBlockers: PublishBlocker[];
  disabledReason?: string;
};

type ApiState = "idle" | "loading" | "ready" | "error";

type LlmUsageRecord = {
  id: string;
  recordedAt: string;
  operation: string;
  provider: string;
  model: string;
  status: "succeeded" | "failed";
  totalTokens: number;
  costMicroCny: number;
  latencyMs?: number;
  metadata: Record<string, unknown>;
};

type LlmUsageSummary = {
  range: {
    key: UsageRange;
    label: string;
    startsAt?: string;
  };
  latestRecordedAt?: string;
  totals: {
    requestCount: number;
    successCount: number;
    errorCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costMicroCny: number;
  };
  byModel: Array<{
    provider: string;
    model: string;
    operation: string;
    workload: string;
    environment: string;
    requestCount: number;
    totalTokens: number;
    costMicroCny: number;
  }>;
  byEnvironment: Array<{
    environment: string;
    requestCount: number;
    successCount: number;
    errorCount: number;
    totalTokens: number;
    costMicroCny: number;
    latestRecordedAt?: string;
  }>;
  byRun: Array<{
    runId: string;
    environment: string;
    requestCount: number;
    totalTokens: number;
    costMicroCny: number;
    latestRecordedAt?: string;
  }>;
  recent: LlmUsageRecord[];
};

type UsageRange = "today" | "7d" | "all";

type ExcludedArticle = {
  id: string;
  articleUrl: string;
  triageDecision: string;
  confidence: number;
  publicSignals: string[];
  exclusionSignals: string[];
  exclusionReason: string;
  evidenceAssetIds: string[];
  promptVersion: string;
  provider: string;
  model: string;
  processingState: string;
  promotedAt?: string;
  createdAt?: string;
};

type ProcessingLedgerRecord = {
  id: string;
  sourceUrl: string;
  state: string;
  decision?: string;
  reason?: string;
  confidence?: number;
  provider?: string;
  model?: string;
  draftId?: string;
  canonicalEventId?: string;
  excludedArticleId?: string;
  dataClass: "production" | "eval" | "test" | "smoke";
  errorDetails?: Record<string, unknown>;
  createdAt: string;
};

type EvaluationRun = {
  runId: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  corpusVersion: string;
  status: "running" | "completed" | "failed";
  validity: "valid" | "invalidated";
  invalidatedReason?: string;
  invalidatedAt?: string;
  startedAt: string;
  completedAt?: string;
  caseCount: number;
  passCount: number;
  failCount: number;
  summary: Record<string, unknown>;
  artifactPath?: string;
  caseResults: Array<{
    id: string;
    caseId: string;
    expectedAction?: string;
    actualAction?: string;
    passed: boolean;
    errors: unknown[];
    createdAt: string;
  }>;
  createdAt: string;
};

type PipelineAttempt = {
  attemptId: string;
  attemptNumber: number;
  provider?: string;
  model?: string;
  promptVersion?: string;
  schemaVersion?: string;
  usage: Record<string, unknown>;
  validatorIssues: unknown[];
  reason?: string;
  latencyMs?: number;
};

type PipelineStep = {
  stepId: string;
  stepOrder: number;
  nodeName: string;
  nodeVersion?: string;
  status: string;
  decision?: string;
  reason?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  schemaVersion?: string;
  usageId?: string;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  validationIssues: unknown[];
  latencyMs?: number;
  attempts: PipelineAttempt[];
};

type PipelineArtifact = {
  artifactId: string;
  stepId?: string;
  path: string;
  kind: string;
  bucket?: string;
};

type PipelineRun = {
  runId: string;
  dataClass: "production" | "eval" | "test" | "smoke";
  sourceKind?: string;
  sourceId?: string;
  articleBundleId?: string;
  caseId?: string;
  status: string;
  decision?: string;
  reason?: string;
  startedAt: string;
  finishedAt?: string;
  steps: PipelineStep[];
  artifacts: PipelineArtifact[];
  createdAt: string;
};

const emptyUsageSummary: LlmUsageSummary = {
  range: {
    key: "today",
    label: "Today",
  },
  totals: {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costMicroCny: 0,
  },
  byModel: [],
  byEnvironment: [],
  byRun: [],
  recent: [],
};

export function AdminPortal() {
  const [token, setToken] = useState("");
  const [jobs, setJobs] = useState<CollectorJob[]>([]);
  const [drafts, setDrafts] = useState<EventDraft[]>([]);
  const [usage, setUsage] = useState<LlmUsageSummary>(emptyUsageSummary);
  const [excludedArticles, setExcludedArticles] = useState<ExcludedArticle[]>(
    [],
  );
  const [ledger, setLedger] = useState<ProcessingLedgerRecord[]>([]);
  const [evaluationRuns, setEvaluationRuns] = useState<EvaluationRun[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState("");
  const [usageRange, setUsageRange] = useState<UsageRange>("today");
  const [operatorOverrideReason, setOperatorOverrideReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [draftPatch, setDraftPatch] = useState({
    title: "",
    scheduleText: "",
    venueName: "",
    venueAddress: "",
    registrationUrl: "",
    registrationQrAssetId: "",
    summary: "",
    entryNotes: "",
  });
  const [draftAction, setDraftAction] = useState<
    "save" | "needs-info" | "reject" | "publish" | null
  >(null);
  const [status, setStatus] = useState<ApiState>("idle");
  const [message, setMessage] = useState("Loading admin state...");

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0],
    [drafts, selectedDraftId],
  );
  const blockingReasons = selectedDraft
    ? getDraftBlockingReasons(selectedDraft)
    : [];
  const selectedDecision = selectedDraft?.publishDecision;
  const canReviewSelectedDraft = selectedDraft
    ? canRunDraftReviewAction(selectedDraft)
    : false;
  const canPublishSelectedDraft = selectedDraft
    ? isDraftPublishableForDisplay(selectedDraft, operatorOverrideReason)
    : false;
  const publishRequiresOverride = Boolean(
    selectedDecision?.requiresOperatorOverride ||
      selectedDecision?.canPublishWithOverride,
  );
  const evidenceItems = selectedDraft
    ? getDraftEvidenceItems(selectedDraft)
    : [];
  const selectedDraftSourceUrl = selectedDraft
    ? getDraftSourceUrl(selectedDraft)
    : "";

  useEffect(() => {
    setOperatorOverrideReason(selectedDraft?.operatorOverrideReason ?? "");
    setDraftPatch({
      title: selectedDraft?.title ?? "",
      scheduleText: selectedDraft?.scheduleText ?? "",
      venueName: selectedDraft?.venueName ?? "",
      venueAddress: selectedDraft?.venueAddress ?? "",
      registrationUrl: selectedDraft?.registrationUrl ?? "",
      registrationQrAssetId: selectedDraft?.registrationQrAssetId ?? "",
      summary: selectedDraft?.summary ?? "",
      entryNotes: selectedDraft?.entryNotes ?? "",
    });
  }, [selectedDraft?.id, selectedDraft?.operatorOverrideReason]);

  async function refresh(options: { usageRange?: UsageRange } = {}) {
    const enteredToken = token.trim();
    const requestedUsageRange = options.usageRange ?? usageRange;
    setStatus("loading");
    setMessage("Loading admin state...");
    try {
      if (enteredToken) {
        await loginAdmin({ token: enteredToken });
        setToken("");
      }
      const adminState = await loadAdminState({
        reviewFilter,
        usageRange: requestedUsageRange,
      });
      const loadedJobs = adminState.jobs as CollectorJob[];
      const loadedDrafts = adminState.drafts as EventDraft[];
      const loadedUsage = adminState.usage as LlmUsageSummary;
      const loadedExcludedArticles =
        adminState.excludedArticles as ExcludedArticle[];
      const loadedLedger = adminState.ledger as ProcessingLedgerRecord[];
      const loadedEvaluationRuns =
        adminState.evaluationRuns as EvaluationRun[];
      const loadedPipelineRuns = adminState.pipelineRuns as PipelineRun[];
      setJobs(loadedJobs);
      setDrafts(loadedDrafts);
      setUsage(loadedUsage);
      setExcludedArticles(loadedExcludedArticles);
      setLedger(loadedLedger);
      setEvaluationRuns(loadedEvaluationRuns);
      setPipelineRuns(loadedPipelineRuns);
      setSelectedDraftId((current) =>
        current && loadedDrafts.some((draft) => draft.id === current)
          ? current
          : (loadedDrafts[0]?.id ?? null),
      );
      setStatus("ready");
      setMessage("Admin state loaded.");
    } catch (error) {
      setStatus("error");
      const message = error instanceof Error ? error.message : "Load failed.";
      setMessage(
        message !== "invalid_admin_token"
          ? message
          : "Enter admin token to load data.",
      );
    }
  }

  useEffect(() => {
    void refresh();
    // Run once on mount to let an existing HttpOnly cookie restore the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function actOnDraft(action: "needs-info" | "reject" | "publish") {
    if (!selectedDraft) return;

    setStatus("loading");
    setDraftAction(action);
    setMessage(`${action}...`);
    try {
      const body = getDraftActionBody({
        action,
        operatorOverrideReason,
        rejectReason,
      });
      await adminApiRequest(
        `/api/admin/event-drafts/${selectedDraft.id}/${action}`,
        {
          method: "POST",
          body,
        },
      );
      await refresh();
      if (action === "publish") setOperatorOverrideReason("");
      if (action === "reject") setRejectReason("");
      setMessage(`Draft ${action} completed.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Draft action failed.");
    } finally {
      setDraftAction(null);
    }
  }

  async function saveDraftPatch() {
    if (!selectedDraft) return;

    setStatus("loading");
    setDraftAction("save");
    setMessage("Saving draft fields...");
    try {
      await patchAdminDraft({
        draftId: selectedDraft.id,
        patch: compactDraftPatch(draftPatch),
      });
      await refresh();
      setMessage("Draft fields saved.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Save draft failed.");
    } finally {
      setDraftAction(null);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.sidebar} aria-label="Admin controls">
        <div className={styles.brand}>
          <span className={styles.mark}>北</span>
          <div>
            <strong>Local Activities</strong>
            <span>Admin portal</span>
          </div>
        </div>

        <form
          className={styles.authForm}
          onSubmit={(event) => {
            event.preventDefault();
            void refresh();
          }}
        >
          <input
            type="hidden"
            autoComplete="username"
            value="admin"
            readOnly
          />
          <label className={styles.field}>
            <span>Admin token</span>
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              placeholder="ADMIN_ACCESS_TOKEN"
              autoComplete="current-password"
            />
          </label>
          <button className={styles.primaryButton} type="submit">
            Load state
          </button>
        </form>

        <p className={`${styles.status} ${styles[status]}`}>{message}</p>
      </section>

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Solo operator workflow</p>
            <h1>Review incoming activity leads</h1>
          </div>
          <div className={styles.metrics}>
            <div>
              <span>{drafts.length}</span>
              <small>drafts</small>
            </div>
            <div>
              <span>{jobs.length}</span>
              <small>jobs</small>
            </div>
            <div>
              <span>{usage.totals.requestCount}</span>
              <small>LLM calls · {getUsageRangeLabel(usage.range.key)}</small>
            </div>
            <div>
              <span>{pipelineRuns.length}</span>
              <small>V5 traces</small>
            </div>
          </div>
        </header>

        <section className={styles.grid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Review queue</p>
                <h2>Drafts</h2>
              </div>
              <select
                value={reviewFilter}
                onChange={(event) => setReviewFilter(event.target.value)}
              >
                <option value="">All</option>
                <option value="ready_for_review">Ready</option>
                <option value="needs_review">Review</option>
                <option value="needs_info">Needs info</option>
                <option value="possible_duplicate">Duplicate?</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            <div className={styles.list}>
              {drafts.map((draft) => (
                <button
                  key={draft.id}
                  className={`${styles.draftRow} ${
                    selectedDraft?.id === draft.id ? styles.selected : ""
                  }`}
                  onClick={() => setSelectedDraftId(draft.id)}
                  type="button"
                >
                  <span>
                    <strong>{draft.title ?? "Untitled draft"}</strong>
                    <small>
                      {draft.venueName ?? draft.venueAddress ?? "Venue missing"}
                    </small>
                  </span>
                  <em>{getReviewStateLabel(draft.reviewState)}</em>
                </button>
              ))}
              {drafts.length === 0 ? (
                <div className={styles.empty}>No drafts loaded.</div>
              ) : null}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Decision panel</p>
                <h2>Review draft</h2>
              </div>
              {selectedDraft ? (
                <span
                  className={
                    canPublishSelectedDraft
                      ? styles.readyBadge
                      : styles.blockedBadge
                  }
                >
                  {canPublishSelectedDraft
                    ? "Publishable"
                    : selectedDecision?.canPublishWithOverride
                      ? "Override required"
                    : "Blocked"}
                </span>
              ) : null}
            </div>

            {selectedDraft ? (
              <div className={styles.detail}>
                <h3>{selectedDraft.title ?? "Untitled draft"}</h3>
                <dl>
                  <div>
                    <dt>Time</dt>
                    <dd>
                      {selectedDraft.scheduleText ??
                        formatDateTime(selectedDraft.startsAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Organizer</dt>
                    <dd>{selectedDraft.organizer ?? "Missing"}</dd>
                  </div>
                  <div>
                    <dt>Venue</dt>
                    <dd>
                      {selectedDraft.venueName ??
                        selectedDraft.venueAddress ??
                        "Missing"}
                    </dd>
                  </div>
                  <div>
                    <dt>Reservation</dt>
                    <dd>{selectedDraft.reservationStatus ?? "Missing"}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{Math.round(selectedDraft.confidence * 100)}%</dd>
                  </div>
                </dl>
                <p className={styles.summary}>
                  {selectedDraft.summary ?? "No extraction summary."}
                </p>
                <div className={styles.editGrid}>
                  <label>
                    <span>Title</span>
                    <input
                      value={draftPatch.title}
                      onChange={(event) =>
                        setDraftPatch((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Schedule text</span>
                    <input
                      value={draftPatch.scheduleText}
                      onChange={(event) =>
                        setDraftPatch((current) => ({
                          ...current,
                          scheduleText: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Venue</span>
                    <input
                      value={draftPatch.venueName}
                      onChange={(event) =>
                        setDraftPatch((current) => ({
                          ...current,
                          venueName: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Registration URL</span>
                    <input
                      value={draftPatch.registrationUrl}
                      onChange={(event) =>
                        setDraftPatch((current) => ({
                          ...current,
                          registrationUrl: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>QR asset id</span>
                    <input
                      value={draftPatch.registrationQrAssetId}
                      onChange={(event) =>
                        setDraftPatch((current) => ({
                          ...current,
                          registrationQrAssetId: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Summary</span>
                    <textarea
                      value={draftPatch.summary}
                      onChange={(event) =>
                        setDraftPatch((current) => ({
                          ...current,
                          summary: event.target.value,
                        }))
                      }
                      rows={3}
                    />
                  </label>
                </div>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => void saveDraftPatch()}
                  disabled={!canReviewSelectedDraft || draftAction !== null}
                >
                  {draftAction === "save" ? "Saving..." : "Save fields"}
                </button>
                {evidenceItems.length ? (
                  <div className={styles.evidenceGrid}>
                    {evidenceItems.map((item) => (
                      <figure key={`${item.kind}-${item.assetId ?? item.imageUrl}`}>
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.imageAlt ?? item.label}
                            width={item.kind === "poster" ? 320 : 220}
                            height={item.kind === "poster" ? 240 : 220}
                            loading="lazy"
                          />
                        ) : (
                          <div className={styles.evidencePlaceholder}>
                            {item.assetId ?? "Evidence linked"}
                          </div>
                        )}
                        <figcaption>
                          <strong>{item.label}</strong>
                          {item.assetId ? <span>{item.assetId}</span> : null}
                          {item.sourceUrl ? (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Source image
                            </a>
                          ) : null}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
                <a
                  className={styles.sourceLink}
                  href={selectedDraftSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open source URL · {selectedDraftSourceUrl}
                </a>
                <div className={styles.blockers}>
                  {selectedDecision?.hardBlockers.length ? (
                    selectedDecision.hardBlockers.map((blocker) => (
                      <span key={blocker.code} title={blocker.message}>
                        Hard: {blocker.message}
                      </span>
                    ))
                  ) : null}
                  {selectedDecision?.softBlockers.length ? (
                    selectedDecision.softBlockers.map((blocker) => (
                      <span
                        className={styles.softBlocker}
                        key={blocker.code}
                        title={blocker.message}
                      >
                        Soft: {blocker.message}
                      </span>
                    ))
                  ) : null}
                  {!blockingReasons.length ? (
                    <span>minimum public fields present</span>
                  ) : null}
                  {selectedDecision?.disabledReason ? (
                    <small>{selectedDecision.disabledReason}</small>
                  ) : null}
                </div>
                {publishRequiresOverride ? (
                  <label className={styles.overrideField}>
                    <span>Operator override reason</span>
                    <textarea
                      value={operatorOverrideReason}
                      onChange={(event) =>
                        setOperatorOverrideReason(event.target.value)
                      }
                      placeholder="Why this soft-blocked draft is safe to publish"
                      rows={3}
                    />
                  </label>
                ) : null}
                <label className={styles.overrideField}>
                  <span>Reject reason</span>
                  <textarea
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder="Why this draft should not become an event"
                    rows={2}
                  />
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    onClick={() => actOnDraft("needs-info")}
                    disabled={!canReviewSelectedDraft || draftAction !== null}
                  >
                    {draftAction === "needs-info" ? "Saving..." : "Needs info"}
                  </button>
                  <button
                    type="button"
                    onClick={() => actOnDraft("reject")}
                    disabled={
                      !canReviewSelectedDraft ||
                      !rejectReason.trim() ||
                      draftAction !== null
                    }
                  >
                    {draftAction === "reject" ? "Rejecting..." : "Reject"}
                  </button>
                  <button
                    className={styles.primaryButton}
                    type="button"
                    onClick={() => actOnDraft("publish")}
                    disabled={
                      !canReviewSelectedDraft ||
                      !canPublishSelectedDraft ||
                      draftAction !== null
                    }
                  >
                    {draftAction === "publish" ? "Publishing..." : "Publish"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.empty}>Select a draft to review.</div>
            )}
          </section>
        </section>

        <section className={styles.auditGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Article audit</p>
                <h2>Processing ledger</h2>
              </div>
              <span className={styles.countBadge}>{ledger.length} rows</span>
            </div>
            <div className={styles.auditList}>
              {ledger.slice(0, 8).map((row) => (
                <div key={row.id} className={styles.auditRow}>
                  <div>
                    <strong>{row.state.replaceAll("_", " ")}</strong>
                    <small>{formatDateTime(row.createdAt)}</small>
                  </div>
                  <a href={row.sourceUrl} target="_blank" rel="noreferrer">
                    {row.sourceUrl}
                  </a>
                  <small>
                    {row.decision ?? "no decision"} ·{" "}
                    {formatConfidence(row.confidence)} ·{" "}
                    {row.provider ?? "provider missing"}/
                    {row.model ?? "model missing"}
                    {row.reason ? ` · ${row.reason}` : ""}
                    {row.draftId ? ` · draft ${row.draftId}` : ""}
                    {row.excludedArticleId
                      ? ` · excluded ${row.excludedArticleId}`
                      : ""}
                  </small>
                </div>
              ))}
              {ledger.length === 0 ? (
                <div className={styles.empty}>
                  No processing ledger rows loaded.
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Article audit</p>
                <h2>Excluded articles</h2>
              </div>
              <span className={styles.countBadge}>
                {excludedArticles.length} excluded
              </span>
            </div>
            <div className={styles.auditList}>
              {excludedArticles.slice(0, 8).map((article) => (
                <div key={article.id} className={styles.auditRow}>
                  <div>
                    <strong>
                      {article.triageDecision.replaceAll("_", " ")}
                    </strong>
                    <small>{formatConfidence(article.confidence)}</small>
                  </div>
                  <a href={article.articleUrl} target="_blank" rel="noreferrer">
                    {article.articleUrl}
                  </a>
                  <small>
                    {article.exclusionReason}
                    {article.exclusionSignals.length
                      ? ` · signals: ${article.exclusionSignals.join(", ")}`
                      : ""}
                    {article.evidenceAssetIds.length
                      ? ` · evidence: ${article.evidenceAssetIds.length}`
                      : ""}
                  </small>
                </div>
              ))}
              {excludedArticles.length === 0 ? (
                <div className={styles.empty}>No excluded articles loaded.</div>
              ) : null}
            </div>
          </section>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>V5 pipeline</p>
              <h2>Trace ledger</h2>
            </div>
            <span className={styles.countBadge}>
              {pipelineRuns.length} runs
            </span>
          </div>
          <div className={styles.pipelineList}>
            {pipelineRuns.slice(0, 8).map((run) => (
              <div key={run.runId} className={styles.pipelineRun}>
                <div className={styles.pipelineRunHeader}>
                  <div>
                    <strong>{run.runId}</strong>
                    <small>
                      {run.status}
                      {run.decision ? ` · ${run.decision}` : ""} ·{" "}
                      {formatDateTime(run.startedAt)}
                    </small>
                  </div>
                  <span>
                    {run.sourceKind ?? "source"}:{run.sourceId ?? "unknown"}
                    {run.articleBundleId ? ` · ${run.articleBundleId}` : ""}
                    {run.caseId ? ` · ${run.caseId}` : ""}
                  </span>
                </div>
                {run.reason ? (
                  <p className={styles.pipelineReason}>{run.reason}</p>
                ) : null}
                <div className={styles.pipelineSteps}>
                  {run.steps.map((step) => {
                    const primaryAttempt = step.attempts[0];
                    return (
                      <div key={step.stepId} className={styles.pipelineStep}>
                        <div>
                          <strong>
                            {step.stepOrder}. {step.nodeName}
                          </strong>
                          <span>
                            {step.status}
                            {step.decision ? ` · ${step.decision}` : ""}
                          </span>
                        </div>
                        <small>
                          {step.reason ?? "no step reason"} ·{" "}
                          {step.provider ?? primaryAttempt?.provider ?? "provider"} /
                          {step.model ?? primaryAttempt?.model ?? "model"} ·{" "}
                          {step.promptVersion ??
                            primaryAttempt?.promptVersion ??
                            "prompt"}{" "}
                          ·{" "}
                          {step.schemaVersion ??
                            primaryAttempt?.schemaVersion ??
                            "schema"}
                        </small>
                        <small>
                          {formatPipelineUsage(primaryAttempt?.usage)}
                          {formatPipelineLatency(
                            step.latencyMs ?? primaryAttempt?.latencyMs,
                          )}
                          {" · "}
                          issues {step.validationIssues.length}
                          {primaryAttempt?.validatorIssues.length
                            ? `/${primaryAttempt.validatorIssues.length}`
                            : ""}
                          {step.usageId ? ` · ${step.usageId}` : ""}
                        </small>
                      </div>
                    );
                  })}
                </div>
                {run.artifacts.length ? (
                  <div className={styles.pipelineArtifacts}>
                    {run.artifacts.slice(0, 8).map((artifact) => (
                      <span key={artifact.artifactId}>
                        {artifact.kind}:{" "}
                        {artifact.bucket ? `${artifact.bucket}/` : ""}
                        {artifact.path}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {pipelineRuns.length === 0 ? (
              <div className={styles.empty}>No V5 pipeline traces loaded.</div>
            ) : null}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Evaluation</p>
              <h2>Reports</h2>
            </div>
            <span className={styles.countBadge}>
              {evaluationRuns.length} runs
            </span>
          </div>
          <div className={styles.evalList}>
            {evaluationRuns.slice(0, 6).map((run) => (
              <div key={run.runId} className={styles.evalRow}>
                <div>
                  <strong>{run.runId}</strong>
                  <small>
                    {run.status} · {formatDateTime(run.startedAt)}
                  </small>
                </div>
                <span>
                  {run.passCount}/{run.caseCount} passed
                </span>
                <small>
                  {run.provider}/{run.model} · {run.corpusVersion} ·{" "}
                  {run.promptVersion}
                  {run.artifactPath ? ` · ${run.artifactPath}` : ""}
                </small>
              </div>
            ))}
            {evaluationRuns.length === 0 ? (
              <div className={styles.empty}>No evaluation reports loaded.</div>
            ) : null}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>LLM ledger</p>
              <h2>Usage · {getUsageRangeLabel(usage.range.key)}</h2>
            </div>
            <div className={styles.segmentedControl} aria-label="Usage range">
              {(["today", "7d", "all"] as const).map((range) => (
                <button
                  key={range}
                  className={usageRange === range ? styles.activeSegment : ""}
                  type="button"
                  onClick={() => {
                    setUsageRange(range);
                    void refresh({ usageRange: range });
                  }}
                >
                  {getUsageRangeLabel(range)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.usageSummary}>
            <div>
              <small>Tokens · {getUsageRangeLabel(usage.range.key)}</small>
              <span>{formatTokenCount(usage.totals.totalTokens)}</span>
            </div>
            <div>
              <small>Estimated cost</small>
              <span>{formatLlmCostCny(usage.totals.costMicroCny)}</span>
            </div>
            <div>
              <small>Failures</small>
              <span>{usage.totals.errorCount}</span>
            </div>
            <div>
              <small>Latest record</small>
              <span>{formatUsageTimestamp(usage.latestRecordedAt)}</span>
            </div>
          </div>

          <div className={styles.usageList}>
            {usage.byEnvironment.map((environment) => (
              <div
                key={environment.environment}
                className={styles.usageRow}
              >
                <strong>{environment.environment.replaceAll("_", " ")}</strong>
                <span>{environment.requestCount} calls</span>
                <small>
                  {formatTokenCount(environment.totalTokens)} tokens ·{" "}
                  {formatLlmCostCny(environment.costMicroCny)} · latest{" "}
                  {formatUsageTimestamp(environment.latestRecordedAt)}
                </small>
              </div>
            ))}
          </div>

          <div className={styles.usageList}>
            {usage.byModel.map((model) => (
              <div
                key={`${model.provider}:${model.model}:${model.operation}:${model.workload}:${model.environment}`}
                className={styles.usageRow}
              >
                <strong>{model.model}</strong>
                <span>{model.operation.replaceAll("_", " ")}</span>
                <small>
                  {model.provider} · {model.environment.replaceAll("_", " ")} ·{" "}
                  {model.workload.replaceAll("_", " ")} ·{" "}
                  {model.requestCount} calls ·{" "}
                  {formatTokenCount(model.totalTokens)} tokens ·{" "}
                  {formatLlmCostCny(model.costMicroCny)}
                </small>
              </div>
            ))}
            {usage.byModel.length === 0 ? (
              <div className={styles.empty}>No LLM usage loaded.</div>
            ) : null}
          </div>

          <div className={styles.usageFailures}>
            {usage.byRun.slice(0, 5).map((run) => (
              <div
                key={`${run.runId}:${run.environment}`}
                className={styles.usageRow}
              >
                <strong>{run.runId}</strong>
                <span>{run.environment.replaceAll("_", " ")}</span>
                <small>
                  {run.requestCount} calls · {formatTokenCount(run.totalTokens)}{" "}
                  tokens · {formatLlmCostCny(run.costMicroCny)}
                </small>
              </div>
            ))}
          </div>

          <div className={styles.usageFailures}>
            {usage.recent
              .filter((record) => record.status === "failed")
              .slice(0, 5)
              .map((record) => (
                <div key={record.id} className={styles.usageRow}>
                  <strong>{record.model}</strong>
                  <span>{formatDateTime(record.recordedAt)}</span>
                  <small>
                    {record.operation.replaceAll("_", " ")}
                    {record.latencyMs ? ` · ${record.latencyMs}ms` : ""}
                  </small>
                </div>
              ))}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Collector queue</p>
              <h2>Recent jobs</h2>
            </div>
          </div>
          <div className={styles.jobList}>
            {jobs.map((job) => (
              <div key={job.jobId} className={styles.jobRow}>
                <strong>{job.runnerState}</strong>
                <span>{job.seedUrl}</span>
                <small>
                  {job.actualRunner ?? job.preferredRunner} · attempt{" "}
                  {job.attemptNumber}
                  <br />
                  {job.fallbackReason ?? job.collectorId ?? "no failure"} ·{" "}
                  {job.lastHeartbeatAt
                    ? formatDateTime(job.lastHeartbeatAt)
                    : "no heartbeat"}
                </small>
              </div>
            ))}
            {jobs.length === 0 ? (
              <div className={styles.empty}>No collector jobs loaded.</div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function compactDraftPatch(input: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function getDraftActionBody({
  action,
  operatorOverrideReason,
  rejectReason,
}: {
  action: "needs-info" | "reject" | "publish";
  operatorOverrideReason: string;
  rejectReason: string;
}) {
  if (action === "publish" && operatorOverrideReason.trim()) {
    return JSON.stringify({
      operatorOverrideReason: operatorOverrideReason.trim(),
    });
  }
  if (action === "reject" && rejectReason.trim()) {
    return JSON.stringify({
      reason: rejectReason.trim(),
    });
  }
  return undefined;
}

function formatConfidence(value: number | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a";
}

function formatPipelineUsage(usage: Record<string, unknown> | undefined) {
  if (!usage) return "tokens 0";
  const totalTokens =
    typeof usage.totalTokens === "number"
      ? usage.totalTokens
      : typeof usage.total_tokens === "number"
        ? usage.total_tokens
        : undefined;
  const costMicroCny =
    typeof usage.costMicroCny === "number"
      ? usage.costMicroCny
      : typeof usage.cost_micro_cny === "number"
        ? usage.cost_micro_cny
        : undefined;
  return `${formatTokenCount(totalTokens)} tokens · ${formatLlmCostCny(
    costMicroCny,
  )}`;
}

function formatPipelineLatency(latencyMs: number | undefined) {
  return typeof latencyMs === "number" ? ` · ${latencyMs}ms` : "";
}
