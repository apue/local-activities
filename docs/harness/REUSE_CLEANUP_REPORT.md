# TypeScript 7 Migration Reuse and Cleanup Report

Status: complete reconnaissance

## Existing Capabilities

- `package.json`: reuse stable install/build/test/typecheck entry points; extend
  compiler scripts and dependency aliases.
- `scripts/agent-operable-regression-gate.mjs`: extend the existing ordered,
  fail-fast gate instead of creating a second migration runner.
- `.gitignore`: reuse `*.tsbuildinfo` for two explicitly named caches.
- `vercel.json` and `.vercel/project.json`: reuse the linked Next.js Preview
  path and Node 24 project setting.
- Canonical docs named by `AGENTS.md`: update in place.

## Extension Points

- `agentOperableRegressionGateSteps`: insert `typecheck_ts6` immediately after
  primary `typecheck`.
- Package script contract: keep `typecheck` stable for callers and add
  `typecheck:ts6` plus `typecheck:compat`.
- PR/issue workflow: record Node 24, compiler, Preview, and review evidence.

## Deprecated or Removable Logic

- Remove direct TS6.0.3 ownership of `tsc` after the aliases install.
- Replace Node 25 typings with Node 24 typings.
- Replace shared compiler-cache behavior with two explicit paths.
- Replace active single-compiler documentation with named ownership.
- Do not delete runtime/business tests; none are made obsolete by this migration.

## Search Evidence

- `rg` over `package.json`, `tsconfig.json`, `pnpm-lock.yaml`, `AGENTS.md`,
  canonical docs, scripts, tests, and Vercel configuration for TypeScript,
  compiler commands, Node versions, pnpm, build, and Preview terms.
- Targeted reads of the regression gate/test, quickstart, technical baseline,
  testing strategy, contribution policy, review prompt, and Vercel config.
- Live Vercel project inspection confirmed Node.js 24.x.

## Decision

- Reuse: package scripts, regression runner, Next build, Vercel config, cache
  ignore, and documentation layers.
- Extend: dependency aliases, compiler scripts, regression sequence, docs.
- New code: no product code; only a repository Node version hint if needed.
- Refactor: none outside the focused gate sequence.
- Deprecate/delete: direct TS6 compiler ownership, Node25 typings, shared cache,
  and conflicting active documentation.

## Risks

- pnpm binary-link ownership must be verified after frozen installation.
- The compatibility wrapper publishes as 6.0.2 and intentionally resolves its
  internal `@typescript/old` dependency to TypeScript 6.0.3, so `tsc6` reports
  6.0.3. This transitive lockfile entry is expected; both compiler checks and
  Next build must still pass.
- Editor plugin behavior is not proof of CLI behavior; CLI probes are mandatory.
