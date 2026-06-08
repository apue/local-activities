# Requirements

## Purpose

Build a mobile-first product that helps users in Beijing discover official or
operator-curated cultural activities in time to plan their week and weekend.
The first wedge remains embassy, cultural-center, and official
international-organization events.

## User-Facing Requirements

- Show actionable upcoming Beijing activities.
- Prioritize the next 3 to 10 days and weekend planning.
- Use a cultural-calendar homepage, not a generic news feed.
- Event cards should show title, time, organizer/source, area or venue,
  reservation status, and a poster thumbnail when available.
- Event detail pages should prioritize time, venue, reservation action,
  official source URL, map action, and registration QR when applicable.
- Public pages must not expose extraction diagnostics, raw confidence,
  admin-only notes, prompts, or raw model responses.
- Hide expired events from the main public flow.
- Keep every public activity page shareable by URL.

## Admin Requirements

The admin portal supports:

- draft review
- publish/reject/edit actions with audit state
- article audit / processing ledger
- source health and capture failures
- usage summaries
- evaluation reports

Reject actions must record reasons. Feedback should be usable as future
regression/evaluation material.

## Automated Pipeline Requirements

The production pipeline is:

```text
external capture worker
-> Supabase Storage article bundle
-> Supabase Edge Function analysis
-> Supabase DB ledger/drafts/events/evidence/usage/eval
-> Vercel public catalog and admin portal
```

Capture worker requirements:

- Poll Wechat2RSS at a low cadence, initially every 4 hours.
- Preserve article material as bundles: manifest, HTML, text, images, links,
  and diagnostics.
- Upload bundles to Supabase Storage.
- Trigger Supabase Edge Function analysis.
- Report `login_required`, `captcha_required`, `fetch_blocked`, and related
  source failures without bypassing platform protections.
- Never call LLM providers in the production path.
- Never write event/draft/evidence database rows directly.

Analysis requirements:

- Read article bundles from Storage.
- Use multimodal LLM input when image evidence exists.
- Extract zero, one, or multiple public event candidates.
- Identify non-public official activity, news, unrelated posts, duplicates,
  updates, and cancellations.
- Attach poster, registration QR, link, and source evidence.
- Write a processing ledger row for every article, including excluded and failed
  articles.
- Route high-confidence publishable events to public state only after backend
  validation and publish policy.

## Data Requirements

- Separate raw capture bundles from product event evidence assets.
- Separate article processing ledger from canonical public events.
- A single article may contain zero, one, or multiple activities.
- A single real-world event may be mentioned by multiple articles.
- Dedupe must use title, time, location, organizer, registration URL/action, and
  source/evidence overlap.
- Event drafts should keep field-level provenance for admin review.
- Canonical public events should expose only user-facing fields.
- Evaluation data must not mutate production drafts/events.

## Non-Goals

- Do not build an open user-submitted city-events platform.
- Do not promise complete coverage of all Beijing cultural events.
- Do not make a WeChat mini program first.
- Do not rely on a formal WeChat API for third-party official-account feeds.
- Do not bypass captchas, login requirements, or platform protections.
- Do not store permanent full article mirrors as a public product feature.
- Do not use Vercel as the WeChat crawler or production analysis runtime for the
  reset.

## Success Criteria

- New Wechat2RSS articles can flow through capture, Storage, analysis, ledger,
  draft/event creation, admin review, and public display without manual URL
  pasting.
- False positives and false negatives are auditable through the ledger.
- Posters and registration QR assets render from app-owned Storage.
- Model/prompt/schema changes can be evaluated against a fixed corpus before
  becoming the default.
