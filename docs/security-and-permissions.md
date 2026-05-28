# Security And Permissions

## Purpose

This document defines the security boundaries for the MVP. The project uses public pages, admin tools, collector ingestion, local browser automation, LLM extraction, and external provider credentials. Those boundaries must stay explicit.

## Actors

### Public User

Allowed:

- read published upcoming events
- open public event detail pages
- follow official source and reservation links

Not allowed:

- read drafts, source diagnostics, extraction evidence, admin notes, or unpublished events
- mutate application state

### Admin User

Allowed:

- add seed URLs
- review event drafts
- resolve duplicates, updates, and cancellations
- update source status and admin decisions
- publish, correct, or withdraw canonical events

Required:

- authenticated admin access before any admin route or action
- audit-friendly state changes through backend policy

### Collector

Allowed:

- request assigned source tasks when that endpoint exists
- claim collector jobs and send heartbeats when the job queue endpoint exists
- upload source run reports
- upload article indexes and snapshots
- upload event drafts and failure reports

Not allowed:

- direct database access
- public event publication
- canonical event mutation
- admin decision mutation

Required:

- collector API key
- collector ID for job claim, heartbeat, and diagnostics
- idempotent uploads by URL and content hash
- structured failure reasons

### Backend Service

Allowed:

- validate and persist collector uploads
- run extraction, matching, revision, and publication policy
- expose scoped public and admin data

Required:

- keep service-role database credentials server-side
- validate all collector and admin inputs
- enforce public/admin/collector boundaries in every access path

### LLM / Agent Module

Allowed:

- classify article content
- propose event drafts
- propose evidence and uncertainty notes
- assist with duplicate, update, and cancellation reasoning

Not allowed:

- write final canonical event state directly
- publish events directly
- invent missing facts without source evidence

Required:

- structured output validation
- evidence snippets for extracted fields
- confidence and uncertainty reporting

## Secrets

Server-side secrets:

- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COLLECTOR_API_KEY`
- `SUPABASE_SECRET_KEY`
- map provider credentials

Collector-machine-only secrets:

- `TEXT_INFERENCE_API_KEY`
- `VISION_INFERENCE_API_KEY`
- agent API keys or local agent credentials
- `LOCAL_COLLECTOR_CONSOLE_TOKEN`

Rules:

- never expose service-role keys to browser code
- never commit `.env` files
- keep collector credentials out of public frontend bundles
- rotate `COLLECTOR_API_KEY` if a collector machine is lost or shared
- do not send Supabase, Vercel, admin, or collector secrets to the LLM or agent API

## Collector Safety

The collector should behave like low-frequency browser automation, not aggressive scraping.

Rules:

- do not bypass captcha
- do not evade login requirements
- do not run high-concurrency source checks
- report `captcha_required`, `login_required`, `fetch_blocked`, or `parser_mismatch` instead of hiding failure
- store only the structured data and evidence needed for the product
- avoid long-term full-text article mirrors as a product feature

## Publication Safety

High-impact fields require special care:

- time
- venue
- reservation URL
- registration deadline
- cancellation status

Rules:

- uncertain high-impact changes go to admin review
- failed source fetches do not imply cancellation
- LLM output is draft evidence, not final truth
- every update or cancellation should point to source evidence or an admin decision

## Public Data Exposure

Public pages may expose:

- event title
- summary
- time
- venue
- reservation status and official link
- organizer/source attribution
- map deeplink

Public pages must not expose:

- collector diagnostics
- raw article snapshots
- LLM prompts or raw model responses
- admin notes
- unpublished drafts
- internal matching scores unless intentionally productized later
