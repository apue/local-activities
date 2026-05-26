# Requirements

## Purpose

Build a tool that helps users in Beijing discover official cultural activities in time to plan their weekend. The product should reduce missed opportunities caused by fragmented WeChat official-account announcements and other official pages.

## Target User Behavior

The primary user checks the product on Thursday or Friday to decide what to do over the weekend. A secondary use case is checking on Saturday or Sunday morning for events that are still available.

## MVP User-Facing Requirements

- Show upcoming official cultural activities, with emphasis on the next 3 to 10 days.
- Prioritize weekend planning over historical search.
- Make action-critical information visible:
  - activity title
  - organizer or source
  - start and end time
  - venue name and address
  - reservation requirement
  - reservation URL or official action URL
  - source URL
  - current status
- Support views for:
  - this weekend
  - today available
  - reservation closing soon
  - upcoming events worth planning
- Hide expired events from the main user flow.
- Keep every public activity page shareable by URL.

## Admin Requirements

- Add a seed URL from an official WeChat article or official webpage.
- Parse the seed article into a candidate activity and candidate source.
- Track source health using a small state model:
  - `checking`
  - `healthy`
  - `attention_needed`
  - `unsupported`
  - `paused`
- Store specific failure reasons, including:
  - `fetch_blocked`
  - `fetch_timeout`
  - `login_required`
  - `captcha_required`
  - `parser_mismatch`
  - `source_identity_missing`
  - `activity_fields_missing`
  - `not_activity`
- Show source runs, recent successes, recent failures, and consecutive failure counts.
- Support review queues for:
  - uncertain event extraction
  - possible duplicates
  - conflicting updates
  - suspected cancellations

## Collector Requirements

- A local collector checks tracked sources every 4 hours.
- The collector uploads normalized results to the backend instead of writing directly to the database.
- The backend receives:
  - source run reports
  - article index items
  - article snapshots
  - event drafts
  - failure reports
- The collector implementation must be replaceable. Playwright, browser extension, Computer Use, AgentBrowser, or a future agent editor should all be able to emit the same result objects.

## Data Requirements

- Separate article mentions from canonical events.
- A single real-world event may be mentioned by multiple sources.
- A single article may contain zero, one, or multiple activities.
- Event matching must support no-ID deduplication using title, time, location, organizer, registration URL, and text evidence.
- Updates and cancellations must create revision proposals or status changes with source evidence.

## Non-Goals For MVP

- Do not build a generic city-events platform.
- Do not cover all Beijing cultural events.
- Do not make a WeChat mini program first.
- Do not rely on a formal WeChat API for third-party official-account feeds.
- Do not guarantee every WeChat source can be continuously tracked.
- Do not store a permanent full-text mirror of official-account articles.
- Do not make map browsing the primary experience.

## Success Criteria

- A user can open the mobile web app and quickly understand what official cultural activities are relevant for the coming weekend.
- An admin can paste one seed URL and get a source plus activity candidate.
- Healthy sources are checked automatically every 4 hours.
- Failures are visible and actionable in the admin UI.
- Duplicate or updated events do not create confusing public listings.
