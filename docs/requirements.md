# Requirements

## Purpose

Build a tool that helps users in Beijing discover admin-curated activities in time to plan their weekend. The initial wedge remains embassy, cultural-center, and official international-organization events, but the MVP can publish any operator-reviewed Beijing activity URL that yields the minimum public fields.

## Target User Behavior

The primary user checks the product on Thursday or Friday to decide what to do over the weekend. A secondary use case is checking on Saturday or Sunday morning for events that are still available.

## MVP User-Facing Requirements

- Show upcoming admin-curated activities, with emphasis on the next 3 to 10 days.
- Prioritize weekend planning over historical search.
- Use a cultural-calendar homepage grouped by time, not a generic news feed.
- Default public browsing should emphasize actionable upcoming events:
  - today
  - tomorrow when relevant
  - this weekend
  - next week
  - later upcoming events
- Make action-critical information visible:
  - activity title
  - organizer or source
  - start and end time
  - venue name and address
  - reservation requirement
  - reservation URL or official action URL
  - source URL
  - current status
- Event list cards should show a thumbnail, time, title, organizer/source, area or venue, and reservation/status tag.
- Event detail pages should behave as action pages, not article mirrors. The detail page should prioritize:
  - status and reservation requirement
  - time
  - venue name and address
  - map action
  - official source action
  - registration link or registration QR code when required
  - short description and entry notes
- Public pages must not expose extraction diagnostics, admin review notes, raw confidence explanations, or labels such as "official evidence".
- If a registration QR code is the only action mechanism, show a dedicated registration QR section and keep the core time, venue, and entry information as text.
- Retain relevant poster or QR assets for user confirmation, but do not require users to read an image to discover action-critical information.
- Hide expired events from the main user flow.
- Keep every public activity page shareable by URL.

## Admin Requirements

Detailed admin portal behavior is defined in [Admin Portal Requirements](admin-portal-requirements.md).

- Add a seed URL or pasted shared text from a public activity page.
- Parse the seed article into a candidate activity and candidate source.
- Auto-publish parsed activity drafts when the backend can validate the minimum public fields: title, start time, source URL, and either venue name or venue address.
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

- The current MVP collector runner is the Mac-local Wechat2RSS collector.
- Vercel hosts the app and ingest APIs, but does not run the production WeChat
  crawler in Event Pipeline V3.
- Future tracked-source polling should check supported sources at a low cadence, initially every 4 hours.
- The collector uploads normalized results to the backend instead of writing directly to the database.
- The backend receives:
  - source run reports
  - article index items
  - article snapshots
  - event drafts
  - failure reports
- The collector implementation must be replaceable. Playwright, browser extension, Computer Use, AgentBrowser, or a future agent editor should all be able to emit the same result objects.
- Browser-based collectors must scroll WeChat article pages far enough to trigger lazy-loaded images before deciding extraction is complete.
- Collector outputs should preserve article images that are relevant to event facts, especially posters and registration QR codes.
- Collector extraction should support these observed official-account page patterns:
  - text-dominant article with complete time, venue, and reservation information
  - image-dominant article where the event facts exist mainly in poster images
  - QR-registration article where the registration mechanism is only present in an image
  - article that mentions multiple related activities or project milestones
  - expired article that should remain source evidence but not enter the main public flow
- Missing public action fields should be reported as structured review reasons instead of filled by inference.

## Data Requirements

- Separate article mentions from canonical events.
- A single real-world event may be mentioned by multiple sources.
- A single article may contain zero, one, or multiple activities.
- Event matching must support no-ID deduplication using title, time, location, organizer, registration URL, and text evidence.
- Updates and cancellations must create revision proposals or status changes with source evidence.
- Event drafts should keep field-level provenance sufficient for admin review, but canonical public events should expose only user-facing fields.
- Secondary mentions in a source article should not automatically become public events unless the parser can clearly extract a standalone activity with the minimum public fields.
- Expired source posts may be retained for source health and matching history, but expired canonical events should be hidden from the default public homepage.

## Source Page Pattern Examples

Recent seed-page analysis established the following MVP fixture patterns:

- Embassy article with a registration QR code embedded in a poster image: event facts can be extracted, and the QR image must be retained for the public registration section.
- Embassy event article with complete text fields and no registration requirement: the public event can be high confidence when time, venue, and entry policy are explicit.
- Image-dominant embassy invitation: OCR or vision extraction is required because the useful fields are not in DOM text.
- Cultural-center article with one main talk and secondary exhibition mentions: the main activity can become an event draft, while secondary mentions need review.

## Non-Goals For MVP

- Do not build an open user-submitted city-events platform.
- Do not promise complete coverage of all Beijing cultural events.
- Do not make a WeChat mini program first.
- Do not rely on a formal WeChat API for third-party official-account feeds.
- Do not guarantee every WeChat source can be continuously tracked.
- Do not store a permanent full-text mirror of official-account articles.
- Do not make map browsing the primary experience.

## Success Criteria

- A user can open the mobile web app and quickly understand what admin-curated activities are relevant for the coming weekend.
- The Mac-local Wechat2RSS collector can ingest subscribed official-account
  articles and produce reviewable or publishable events when parsing succeeds.
- A future collector implementation can be swapped in without changing the
  backend ingestion contract.
- Failures are visible and actionable in the admin UI.
- Duplicate or updated events do not create confusing public listings.
