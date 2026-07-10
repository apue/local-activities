# TypeScript 7 Migration Acceptance

Status: approved

## Done Definition

- [ ] Package metadata installs TS7 as the `tsc` owner and TS6 as the Next.js
  compatibility API owner.
- [ ] Node.js 24 and pnpm 11 are explicit and verified.
- [ ] Both compiler checks, all tests, and the production build pass.
- [ ] `pnpm build` runs the TS7 primary check before `next build`, including on
  Vercel.
- [ ] The agent regression gate includes both compiler checks and its focused
  tests prove ordering and fail-fast behavior.
- [ ] Canonical docs and `AGENTS.md` describe the new boundary and commands.
- [ ] Direct TS6-only and shared-cache assumptions are removed.
- [ ] Vercel Preview succeeds and browser verification finds no introduced page,
  console, or runtime errors on the public surface.
- [ ] PR review has no unresolved actionable findings and checks pass.
- [ ] The PR is merged and issue #400 has a complete handoff.

## Acceptance Criteria

1. Given a clean checkout running Node.js 24 and pnpm 11, when
   `pnpm install --frozen-lockfile` runs, then installation succeeds without an
   unsupported-engine warning or lockfile mutation.
2. Given the installed dependencies, when `pnpm typecheck` runs, then its
   compiler reports version 7.0.2 and exits successfully.
3. Given the compatibility package, when `pnpm typecheck:ts6` runs, then the
   TS6 compiler exits successfully using a different build-info file.
4. Given the migrated regression gate, when its focused tests run, then the gate
   orders unit tests, TS7, TS6, replay, and evaluation and stops at the first
   failing step.
5. Given the application, when `pnpm test` and `pnpm build` run under Node 24,
   then all tests pass, TS7 runs first, and Next.js completes framework type
   validation.
6. Given the Preview deployment, when the public catalog and one public runtime
   boundary are opened, then expected content/status appears without uncaught
   browser errors or introduced console errors.
7. Given the final diff, when reviewed against issue #400, then no preview-era
   package names, shared TS build cache, Node 26 claim, or undocumented TS6
   dependency remains.

## Manual Review Checklist

- [ ] Behavior matches `SPEC.md` and the approved design.
- [ ] Next.js owns no product logic change.
- [ ] `.mjs`, SQL, and deployed behavior are not claimed as TypeScript coverage.
- [ ] TS6 has a named future removal condition.
- [ ] Node.js 26 is deferred rather than partially configured.
- [ ] Vercel project and deployment both report Node.js 24.x.

## Out of Scope

- Product feature changes.
- Collector/pipeline language conversion.
- Node.js 26 adoption.
