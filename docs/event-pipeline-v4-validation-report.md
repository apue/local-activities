# Event Pipeline V4 Validation Report

Date: 2026-06-08

Issue: #259

Base commit: `eec9238ac6ef16de097c66987a16d2499599b659`

## Result

Deterministic Event Pipeline V4 acceptance passed.

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm test` | Passed | 69 files, 477 tests |
| `pnpm typecheck` | Passed | `tsc --noEmit` |
| `pnpm fixture:e2e -- --all` | Passed | 8 V2 fixture cases |
| `pnpm regression:replay -- --all` | Passed | 12 V4 regression corpus cases, offline target |
| `pnpm env:check --env-file .env.local --target local-app` | Passed | 6/6 required local app vars configured |
| `pnpm smoke:admin-readonly --env-file .env.local` | Failed against hosted URL | `.env.local` points at `https://local-activities.vercel.app`; direct `curl` also failed with connection reset |
| `APP_BASE_URL=http://127.0.0.1:3000 pnpm smoke:admin-readonly --env-file .env.local` | Passed | Local Next dev server, read-only admin/API checks |
| `APP_BASE_URL=http://127.0.0.1:3000 pnpm smoke:public-catalog --env-file .env.local` | Passed | Local public home and one event detail page |

All pnpm commands emitted the existing engine warning because this shell uses
Node v26 while the project declares Node 24.x.

## Resource Check

Before and after validation, the same five `playwright-mcp` tool service process
pairs were present. No additional agent-browser, capture, Chromium, browser
runner, or port 3000 listener remained after the local smoke run. The local Next
dev server was stopped after smoke validation.

## Skipped Live/Mutating Checks

These checks were not run:

- live WeChat crawling
- live agent-browser article capture
- live LLM extraction or eval
- storage writes
- hosted production cleanup
- production seed import
- production public publish

Reason: #259 only requires deterministic acceptance and available read-only
smoke checks. Mutating production and live provider/source commands remain
operator-approved workflows.

## Known Gaps

- The V4 regression corpus documents that a second real operator-sourced Beiping
  duplicate/update bundle is still missing. The corpus uses the available
  Beiping fixture and does not fabricate a second source.
- Hosted smoke from this Mac failed because `https://local-activities.vercel.app`
  reset the connection. The same read-only smoke passed against the local Next
  app with `.env.local`.
