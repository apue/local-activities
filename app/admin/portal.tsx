"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  adminApiRequest,
  loadAdminState,
  loginAdmin,
} from "../../src/client/admin-portal-api";
import {
  canRunDraftReviewAction,
  formatDateTime,
  formatLlmCostCny,
  formatTokenCount,
  formatUsageTimestamp,
  getDraftEvidenceItems,
  getDraftBlockingReasons,
  getReviewStateLabel,
  getUsageRangeLabel,
  isDraftPublishableForDisplay,
} from "../../src/client/admin-portal-utils";
import { extractFirstHttpUrl } from "../../src/shared/seed-url";
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
    requestCount: number;
    totalTokens: number;
    costMicroCny: number;
  }>;
  recent: LlmUsageRecord[];
};

type UsageRange = "today" | "7d" | "all";

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
  recent: [],
};

export function AdminPortal() {
  const [token, setToken] = useState("");
  const [seedUrl, setSeedUrl] = useState("");
  const [jobs, setJobs] = useState<CollectorJob[]>([]);
  const [drafts, setDrafts] = useState<EventDraft[]>([]);
  const [usage, setUsage] = useState<LlmUsageSummary>(emptyUsageSummary);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState("");
  const [usageRange, setUsageRange] = useState<UsageRange>("today");
  const [operatorOverrideReason, setOperatorOverrideReason] = useState("");
  const [draftAction, setDraftAction] = useState<
    "needs-info" | "reject" | "publish" | null
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

  useEffect(() => {
    setOperatorOverrideReason(selectedDraft?.operatorOverrideReason ?? "");
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
      setJobs(loadedJobs);
      setDrafts(loadedDrafts);
      setUsage(loadedUsage);
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

  async function createSeedJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const extractedSeedUrl = extractFirstHttpUrl(seedUrl);
    if (!extractedSeedUrl) {
      setStatus("error");
      setMessage("Paste a URL or shared text that contains a URL.");
      return;
    }

    setStatus("loading");
    setMessage("Creating collector job...");
    try {
      await adminApiRequest("/api/admin/collector-jobs", {
        method: "POST",
        body: JSON.stringify({ seedUrl: extractedSeedUrl }),
      });
      setSeedUrl("");
      await refresh();
      setMessage("Collector job queued.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Create job failed.");
    }
  }

  async function actOnDraft(action: "needs-info" | "reject" | "publish") {
    if (!selectedDraft) return;

    setStatus("loading");
    setDraftAction(action);
    setMessage(`${action}...`);
    try {
      const body =
        action === "publish" && operatorOverrideReason.trim()
          ? JSON.stringify({
              operatorOverrideReason: operatorOverrideReason.trim(),
            })
          : undefined;
      await adminApiRequest(`/api/admin/event-drafts/${selectedDraft.id}/${action}`, {
        method: "POST",
        body,
      });
      await refresh();
      if (action === "publish") setOperatorOverrideReason("");
      setMessage(`Draft ${action} completed.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Draft action failed.");
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
          className={styles.seedForm}
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

        <form className={styles.seedForm} onSubmit={createSeedJob}>
          <label className={styles.field}>
            <span>URL or shared text</span>
            <textarea
              value={seedUrl}
              onChange={(event) => setSeedUrl(event.target.value)}
              placeholder="https://mp.weixin.qq.com/s/... or pasted share text"
              rows={4}
            />
          </label>
          <button className={styles.primaryButton} type="submit">
            Queue collector job
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
                            <a href={item.sourceUrl}>Source image</a>
                          ) : null}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
                <a className={styles.sourceLink} href={selectedDraft.articleUrl}>
                  Open source URL
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
                    disabled={!canReviewSelectedDraft || draftAction !== null}
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
            {usage.byModel.map((model) => (
              <div
                key={`${model.provider}:${model.model}:${model.operation}`}
                className={styles.usageRow}
              >
                <strong>{model.model}</strong>
                <span>{model.operation.replaceAll("_", " ")}</span>
                <small>
                  {model.provider} · {model.workload.replaceAll("_", " ")} ·{" "}
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
