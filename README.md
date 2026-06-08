# Local Activities

Local Activities is a mobile-first web product for discovering official cultural activities in Beijing before they are easy to miss.

The initial focus is narrow by design: embassy, cultural-center, and official international-organization events that are usually announced through WeChat official accounts and related official pages.

## Product Direction

- Help users answer: "What official cultural activities are worth planning for this weekend?"
- Start as a Vercel-hosted web app, optimized for mobile and WeChat in-app browsing.
- Use an external capture worker near Wechat2RSS to upload article bundles and trigger Supabase analysis.
- Keep source health, ingestion failures, duplicate detection, event updates, and cancellations visible in the admin system.
- Treat capture outputs as untrusted source material; Supabase analysis owns validation, dedupe, evidence, ledger, and publishing state.

## Current Repository State

The active pipeline is:

```text
external capture worker
-> Supabase Storage article bundle
-> Supabase Edge Function analysis
-> Supabase DB ledger/drafts/events/evidence/usage/eval
-> Vercel public catalog and admin portal
```

Vercel serves the public/admin app. It does not crawl WeChat or run the production LLM analysis pipeline.

## Documents

- [Requirements](docs/requirements.md)
- [MVP Tech Stack And End-To-End Feature Notes](docs/tech-stack.md)
- [Bootstrap Quickstart](docs/quickstart.md)
- [External Dependencies](docs/external-dependencies.md)
- [Technical Baseline](docs/technical-baseline.md)
- [Testing Strategy](docs/testing-strategy.md)
- [Security And Permissions](docs/security-and-permissions.md)
- [Contributing](CONTRIBUTING.md)
- [Agent Instructions](AGENTS.md)

## Recommended MVP Stack

- Language: TypeScript
- Web framework: Next.js App Router
- Hosting: Vercel
- Database: Supabase Postgres
- Capture runtime: external Node.js worker next to Wechat2RSS
- LLM usage: structured event extraction and uncertain-case assistance
- Map/geocoding: AMAP-first provider abstraction for China
- Calendar: `.ics` export/feed first; OAuth calendar writes later only if needed
- Search/crawling: provider adapters for Exa, Serper, and Firecrawl where allowed
- Backend analysis: Supabase Edge Function with OpenAI-compatible model provider

## Next Step

Review the documents and follow the [Bootstrap Quickstart](docs/quickstart.md) for local setup and validation.
