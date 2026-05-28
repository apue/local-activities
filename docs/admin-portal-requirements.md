# Admin Portal Requirements

## Purpose

The admin portal is the first operator-facing surface for turning untrusted collector output into trustworthy public event listings. It is designed for one operator who reviews official embassy, cultural-center, and international-organization activity leads before they become public events.

The portal must make three things explicit:

- which event drafts need a human decision
- which sources or collector runs need attention
- which already-published events may have public-facing quality problems

## Scope

The first admin portal implementation covers:

- overview of items that need attention
- event draft review queue
- source health list
- collector run history
- published upcoming event sanity list
- add-seed-URL entry point for a known official article or official webpage

The first implementation may start from static or mocked data during UI prototyping, but production behavior must read from backend-owned state. Collector and extraction outputs remain untrusted inputs. The backend decides validation, deduplication, publish eligibility, and final publish state.

## Non-Goals

- Do not build a generic analytics dashboard.
- Do not add PV, BI, retention, funnel, or marketing metrics.
- Do not let collector, crawler, LLM, or agent output publish directly.
- Do not hide source failures in logs only.
- Do not implement a broad multi-role admin system for the MVP.
- Do not add third-party APM for this slice.

## Information Architecture

### Overview

The overview shows only operational counts that help a solo operator decide what to handle next:

- pending drafts
- sources needing attention
- collector runs with failures or partial results
- published upcoming events with sanity warnings

The overview must link or scroll to the corresponding work area.

### Inbox

The inbox is the primary draft review queue. It must show:

- draft title
- source name
- detected time
- detected venue
- review reason
- short extraction summary
- badges for important states such as QR registration, missing fields, duplicate risk, or ready to publish

The inbox must support filtering at least by:

- all drafts
- missing information
- possible duplicates or secondary mentions

Selecting a draft shows a compact detail panel with extracted field status and actions.

### Draft Review

The `Review draft` action opens a focused review view or modal. It must include:

- source context
- original source URL
- detected time and venue
- extraction summary
- evidence or asset entry points, such as poster, QR, and article
- editable event fields
- save, needs-more-info, and publish actions

Editable fields for the MVP:

- title
- date
- start time
- end time
- reservation status
- venue name
- venue address
- registration action or URL
- organizer
- short summary
- entry notes

Most editable fields are optional at the form level because official source material may omit them. The backend must still enforce publish eligibility before an event becomes public. A draft can be saved with incomplete information, but publishing is blocked when required public fields are missing or the draft is a secondary mention that should not become a public event.

The review UI must make the publish state clear:

- publishable draft: show why the minimum public fields are present
- blocked draft: show the blocking reason, such as missing address or secondary mention
- incomplete draft: allow saving without publishing

### Sources

The source list shows tracked source health as product-visible state. Each row must show:

- source name
- health state
- last run timing
- short status or failure note

Supported source health states are defined in [requirements.md](requirements.md#admin-requirements).

Sources with warnings or failures must open an error detail view instead of requiring the operator to search logs.

### Runs

The run history shows recent collector outcomes. Each row must show:

- run time
- run status
- source scope
- result summary
- failure reason when present

Runs with partial or failed outcomes must open an error detail view.

### Error Detail

The error detail view is intentionally simple. It must show the operational information needed to decide whether to retry, pause, or mark a source unsupported:

- error scope, such as source health or collector run
- source or run title
- structured failure reason
- short human-readable note
- last attempt time
- consecutive failure count
- snapshot or screenshot availability
- suggested next action
- bounded log excerpt or diagnostic summary

Supported actions:

- retry now
- open original URL
- pause source
- mark unsupported

These actions must update backend-owned source or run state in production. The UI must not treat a failed fetch as evidence that an event has been cancelled.

### Published

The published list is a sanity surface for public events that are already visible or close to visible. It must show:

- event title
- event date
- public-facing status
- warning or error badge when applicable

The MVP focus is quality control, not historical reporting.

### Add Seed URL

The add-seed flow accepts an official WeChat article URL or official webpage URL and an optional operator note. It queues backend validation and collection work. The portal must not assume a pasted URL is a valid source, a valid activity, or safe to publish.

Production seed URL collection should create Vercel collector jobs for the home-machine collector to claim, as defined in [Local Collector Console And Job Queue Spec](local-collector-console.md).

## Data And State Rules

- Event drafts are not canonical events.
- Article snapshots and event drafts are evidence for review, not public product state.
- Source health and failure reasons are product-visible admin state.
- Backend validation owns publish eligibility.
- Deduplication and secondary-mention handling must happen before publish.
- Admin actions must preserve enough audit context to explain why a draft was published, saved, paused, or rejected.

## Mobile And Layout Requirements

The admin portal should remain usable on mobile and tablet because early operation may happen on a phone or inside a browser opened from chat. The primary review workflow may be denser on desktop, but it must not break on narrow viewports.

Minimum responsive requirements:

- navigation remains reachable
- draft list and selected draft detail stack cleanly
- review form fields fit without horizontal scrolling
- publish actions remain visible after scrolling the review form
- long URLs and error logs wrap or scroll inside their own containers

## Validation Expectations

Prototype validation:

- static JavaScript syntax check
- browser smoke check for dashboard render
- browser smoke check for draft review view
- browser smoke check for error detail view
- desktop and mobile viewport screenshots for layout review

Production implementation validation:

- unit tests for draft publish eligibility
- unit tests for source health and failure state transitions
- integration tests for save, needs-more-info, publish, retry, pause, and mark-unsupported actions
- permission tests proving public users cannot read drafts, diagnostics, or admin notes
- browser smoke tests for the critical admin flows
