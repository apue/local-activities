# Security And Permissions

## Purpose

This document defines access boundaries for the reset architecture.

## Actors

### Public User

Allowed:

- read published events
- open public detail pages
- follow official source and reservation links

Not allowed:

- read drafts, ledger details, raw bundles, raw model responses, admin notes, or
  unpublished events
- mutate application state

### Admin User

Allowed:

- review drafts
- publish, reject, edit, or withdraw events through admin policy
- inspect processing ledger, usage, source health, and evaluation reports
- trigger allowed re-analysis or evaluation actions

Required:

- authenticated admin access
- audit-friendly state changes

### Capture Worker

Allowed:

- poll Wechat2RSS
- upload article bundles to Supabase Storage
- call Supabase Edge Functions with bundle metadata

Not allowed:

- direct event/draft/evidence DB writes
- LLM provider calls in production
- canonical event publication
- admin decision mutation

Required:

- collector ID
- `COLLECTOR_EDGE_TOKEN`
- idempotency by source URL/content hash
- structured source failure reasons

### Supabase Edge Function

Allowed:

- read article bundles from Storage
- call configured LLM providers
- validate extraction output
- write ledger, evidence, draft/event, usage, and evaluation rows

Required:

- server-side provider secrets
- schema validation for all inputs and model outputs
- production/eval write isolation

### Vercel App

Allowed:

- render public and admin pages
- perform authenticated admin actions
- trigger approved Supabase functions for analysis/eval workflows

Not allowed:

- production WeChat crawling
- production LLM analysis pipeline ownership

## Secrets

Server-side / Supabase secrets:

- `SUPABASE_SECRET_KEY`
- `DATABASE_URL`
- `COLLECTOR_EDGE_TOKEN`
- `ANALYSIS_LLM_API_KEY`
- map provider credentials when enabled

Server-side non-secret runtime configuration:

- `ANALYSIS_LLM_INPUT_PRICE_CNY_PER_1M`
- `ANALYSIS_LLM_OUTPUT_PRICE_CNY_PER_1M`

Browser-safe values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- domain-restricted public map keys

Rules:

- never expose service-role or provider keys to browser code
- never commit `.env` files
- do not send Supabase, Vercel, admin, or collector secrets to LLM providers
- rotate `COLLECTOR_EDGE_TOKEN` if a capture worker host is lost or shared

## Source Safety

The capture worker must behave like low-frequency source automation:

- do not bypass captchas
- do not evade login requirements
- do not run high-concurrency checks
- report `captcha_required`, `login_required`, `fetch_blocked`, or
  `source_unhealthy`
- preserve only product-needed raw material and evidence under retention policy

## Public Data Exposure

Public pages may expose:

- event title
- summary
- time
- venue
- reservation status/action
- organizer/source attribution
- map link
- poster/registration QR assets when relevant

Public pages must not expose:

- raw article bundles
- processing ledger internals
- raw model responses
- prompts
- unpublished drafts
- admin notes
