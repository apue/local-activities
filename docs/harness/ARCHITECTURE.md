# TypeScript 7 Migration Architecture

Status: approved

## Summary

The repository uses two compiler packages during the framework transition but
only one primary compiler. The TS7 package owns `tsc` and standalone checking;
the package named `typescript` exposes the TS6 API that Next.js 16.2.6 imports
during `next build`. Separate scripts and caches make ownership observable.

## Boundaries

- `@typescript/native` alias:
  - Responsibility: TS7 CLI and primary diagnostics.
  - Dependency: `typescript@7.0.2`.
- `typescript` alias:
  - Responsibility: Next.js programmatic compiler API and explicit legacy
    compatibility diagnostics.
  - Dependency: `@typescript/typescript6@6.0.2`.
- `package.json` scripts:
  - Responsibility: stable human/agent validation entry points.
- `scripts/agent-operable-regression-gate.mjs`:
  - Responsibility: order both compiler gates with existing regression steps.
- `tsconfig.json`:
  - Responsibility: shared source semantics, not compiler ownership.
- Vercel:
  - Responsibility: build and run the Next.js app under Node.js 24.x.

## Data and Control Flow

1. `pnpm typecheck` resolves the TS7-provided `tsc` binary.
2. TS7 reads `tsconfig.json` and writes `tsconfig.ts7.tsbuildinfo`.
3. `pnpm typecheck:ts6` resolves `tsc6` and writes
   `tsconfig.ts6.tsbuildinfo`.
4. `pnpm build` first executes the TS7 primary check, then starts Next.js.
5. Next.js resolves the package named `typescript` and uses its TS6 compiler
   API for framework type validation.
6. Vercel installs with pnpm 11 and executes the same build under Node.js 24.

## Agentic Harness Components

- Instructions: `AGENTS.md` validation and coverage boundaries.
- Tools: pnpm scripts, Vercel CLI, and agent-browser.
- Guardrails: both compilers, Vitest, Next.js build, Preview, browser errors,
  GitHub checks, and code review.
- Handoff: issue #400 comments and PR validation/review notes.
- Context: `SPEC.md`, `ACCEPTANCE.md`, `DECISIONS.md`, and the approved design.

## Alternatives Considered

- Direct TS7 replacement: rejected because Next.js 16.2.6 imports the missing
  stable compiler API and `next build` fails.
- Keep TS6 as primary and add an optional TS7 experiment: rejected because it
  does not achieve the requested primary-agent/compiler upgrade.
- Disable Next.js build type checking: rejected because it weakens a production
  gate and conflicts with the project testing policy.
- Wait for TS7.1/Next.js support: rejected because the supported alias layout
  enables a safe migration now.

## Risks

- Binary alias collision: verify `tsc --version` and `tsc6 --version` after a
  frozen install.
- Incremental cache incompatibility: use distinct build-info paths.
- Ambient Node API drift: align `@types/node` to 24.x and build on Node 24.
- Editor plugin mismatch: treat CLI TS7 as authoritative and keep editor TS7
  adoption optional until the Next plugin supports it.
- Framework compatibility regression: keep `pnpm build` as a mandatory gate.
