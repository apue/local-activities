# TypeScript 7 Migration Decisions

Status: approved

## Decision Log

### 2026-07-10: Adopt TS7 with an isolated TS6 framework compatibility layer

Status: accepted

Context: TypeScript 7.0.2 checks the repository successfully, but Next.js 16.2.6
still imports the stable TypeScript programmatic API that TS7.0 does not expose.

Decision: Install TS7 under `@typescript/native` so it owns `tsc`; install
`@typescript/typescript6` under the `typescript` name so Next.js can load the API
and humans can run `tsc6` explicitly.

Alternatives considered: direct replacement, optional-only TS7, disabling build
type checks, or waiting for TS7.1. All were rejected for compatibility, fidelity,
or validation reasons documented in `ARCHITECTURE.md`.

Consequences: the repository temporarily carries two compiler packages and two
type-check commands. The TS6 layer must be removed once Next.js supports the
stable TS7 API.

Validation: compare compiler versions, run both checks, and run `pnpm build`.

### 2026-07-10: Keep Node.js 24 for the TS7 migration

Status: accepted

Context: the local shell selected Node 26, but the repository and live Vercel
project specify 24.x. Node 26 is Current rather than LTS and is not offered by
Vercel.

Decision: validate only Node.js 24.x with pnpm 11.x, align `@types/node` to 24.x,
and defer Node.js 26 to a separate issue after Vercel support.

Consequences: local commands must activate the installed Node 24 toolchain. No
Vercel runtime change is required in this PR.

Validation: capture `node --version`, `pnpm --version`, Vercel project settings,
and Preview build evidence.
