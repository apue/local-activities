# Local Activities

Local Activities is a mobile-first web product for discovering official cultural activities in Beijing before they are easy to miss.

The initial focus is narrow by design: embassy, cultural-center, and official international-organization events that are usually announced through WeChat official accounts and related official pages.

## Product Direction

- Help users answer: "What official cultural activities are worth planning for this weekend?"
- Start as a Vercel-hosted web app, optimized for mobile and WeChat in-app browsing.
- Use seed URLs from WeChat official-account articles to create sources, then let a local collector check those sources every 4 hours.
- Keep source health, ingestion failures, duplicate detection, event updates, and cancellations visible in the admin system.
- Treat collector outputs as drafts or evidence; the backend owns validation, matching, revision history, and publishing.

## Current Repository State

This repository is currently documentation-first. It defines the MVP scope and system baseline before application scaffolding.

## Documents

- [Requirements](docs/requirements.md)
- [Design Spec](docs/superpowers/specs/2026-05-26-local-activities-design.md)
- [External Dependencies](docs/external-dependencies.md)
- [Technical Baseline](docs/technical-baseline.md)
- [Agent Instructions](AGENTS.md)

## Recommended MVP Stack

- Language: TypeScript
- Web framework: Next.js App Router
- Hosting: Vercel
- Database: Supabase Postgres
- Collector runtime: local Node.js worker with Playwright-compatible adapter abstraction
- LLM usage: structured event extraction and uncertain-case assistance

## Next Step

Review the documents and confirm the MVP boundaries before scaffolding the application.
