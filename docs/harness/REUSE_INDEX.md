# TypeScript 7 Migration Reuse Index

Status: current for issue #400

## Reusable Capabilities

- Package scripts
  - Path: `package.json`
  - Reuse: retain `test`, `build`, and `typecheck` as stable public commands;
    extend with explicit TS6 compatibility and combined commands.
  - Validation: compiler version probes, both checks, and build.
- Agent-operable regression gate
  - Path: `scripts/agent-operable-regression-gate.mjs`
  - Reuse: add a TS6 step after the primary TS7 step; keep sequential fail-fast
    execution and structured events.
  - Tests: `scripts/agent-operable-regression-gate.test.mjs`.
- Next.js build validation
  - Path: `package.json` script `build` and `vercel.json`.
  - Reuse: keep `next build`; do not add a parallel build pipeline.
- Existing ignored compiler caches
  - Path: `.gitignore` pattern `*.tsbuildinfo`.
  - Reuse: give TS7 and TS6 distinct filenames covered by the existing pattern.
- Existing Node/pnpm contract
  - Path: `package.json` `engines` and `packageManager`.
  - Reuse: retain Node 24.x and pnpm 11, add a developer version hint.
- Existing browser verification tooling
  - Path: project skill `.agents/skills/agent-browser`.
  - Reuse: deterministic Preview smoke, console, and error inspection.

## Extension Points

- `agentOperableRegressionGateSteps`: add one named compatibility step without
  changing the runner interface.
- Canonical documentation layers named in `AGENTS.md`: record exact ownership
  and commands without adding a competing handbook.
- GitHub issue #400 and PR template: carry validation and handoff evidence.

## Avoid Parallel Implementations

- Prefer package scripts over a new shell wrapper for compiler selection.
- Prefer the existing regression gate over a separate TS migration gate.
- Prefer `next build` over custom Next.js type-check integration.
- Prefer the existing Vercel link and `vercel.json` over new deployment config.
