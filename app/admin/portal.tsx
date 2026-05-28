"use client";

import { FormEvent, useMemo, useState } from "react";

import {
  formatDateTime,
  getDraftBlockingReasons,
  getReviewStateLabel,
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
  summary?: string;
  entryNotes?: string;
  confidence: number;
  reviewState: string;
  evidenceAssetIds: string[];
  fieldEvidence: Record<string, string[]>;
};

type ApiState = "idle" | "loading" | "ready" | "error";

export function AdminPortal() {
  const [token, setToken] = useState("");
  const [seedUrl, setSeedUrl] = useState("");
  const [jobs, setJobs] = useState<CollectorJob[]>([]);
  const [drafts, setDrafts] = useState<EventDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState("");
  const [status, setStatus] = useState<ApiState>("idle");
  const [message, setMessage] = useState("Enter admin token to load data.");

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0],
    [drafts, selectedDraftId],
  );
  const blockingReasons = selectedDraft
    ? getDraftBlockingReasons(selectedDraft)
    : [];

  async function api<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(body.error ?? "request_failed");
    }
    return body;
  }

  async function refresh() {
    if (!token.trim()) {
      setMessage("Admin token is required.");
      return;
    }

    setStatus("loading");
    setMessage("Loading admin state...");
    try {
      const query = reviewFilter ? `?reviewState=${reviewFilter}` : "";
      const [jobsResponse, draftsResponse] = await Promise.all([
        api<{ jobs: CollectorJob[] }>("/api/admin/collector-jobs"),
        api<{ drafts: EventDraft[] }>(`/api/admin/event-drafts${query}`),
      ]);
      setJobs(jobsResponse.jobs);
      setDrafts(draftsResponse.drafts);
      setSelectedDraftId((current) =>
        current && draftsResponse.drafts.some((draft) => draft.id === current)
          ? current
          : (draftsResponse.drafts[0]?.id ?? null),
      );
      setStatus("ready");
      setMessage("Admin state loaded.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Load failed.");
    }
  }

  async function createSeedJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!seedUrl.trim()) return;

    setStatus("loading");
    setMessage("Creating collector job...");
    try {
      await api("/api/admin/collector-jobs", {
        method: "POST",
        body: JSON.stringify({ seedUrl }),
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
    setMessage(`${action}...`);
    try {
      await api(`/api/admin/event-drafts/${selectedDraft.id}/${action}`, {
        method: "POST",
      });
      await refresh();
      setMessage(`Draft ${action} completed.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Draft action failed.");
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
            <span>Seed URL</span>
            <textarea
              value={seedUrl}
              onChange={(event) => setSeedUrl(event.target.value)}
              placeholder="https://mp.weixin.qq.com/s/..."
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
            <h1>Review incoming official activity leads</h1>
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
                    <small>{draft.venueName ?? "Venue missing"}</small>
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
                    isDraftPublishableForDisplay(selectedDraft)
                      ? styles.readyBadge
                      : styles.blockedBadge
                  }
                >
                  {isDraftPublishableForDisplay(selectedDraft)
                    ? "Publishable"
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
                    <dd>{formatDateTime(selectedDraft.startsAt)}</dd>
                  </div>
                  <div>
                    <dt>Organizer</dt>
                    <dd>{selectedDraft.organizer ?? "Missing"}</dd>
                  </div>
                  <div>
                    <dt>Venue</dt>
                    <dd>{selectedDraft.venueName ?? "Missing"}</dd>
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
                <a className={styles.sourceLink} href={selectedDraft.articleUrl}>
                  Open source URL
                </a>
                <div className={styles.blockers}>
                  {blockingReasons.length ? (
                    blockingReasons.map((reason) => (
                      <span key={reason}>{reason.replaceAll("_", " ")}</span>
                    ))
                  ) : (
                    <span>minimum public fields present</span>
                  )}
                </div>
                <div className={styles.actions}>
                  <button type="button" onClick={() => actOnDraft("needs-info")}>
                    Needs info
                  </button>
                  <button type="button" onClick={() => actOnDraft("reject")}>
                    Reject
                  </button>
                  <button
                    className={styles.primaryButton}
                    type="button"
                    onClick={() => actOnDraft("publish")}
                    disabled={!isDraftPublishableForDisplay(selectedDraft)}
                  >
                    Publish
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
