# TypeScript 7 Migration Validation Plan

Status: approved

## Validation Mode

Selected modes: regression-test, schema-check, contract-test, smoke-test,
screenshot-review, and manual review.

Reason: package aliases and scripts are configuration contracts; the agent gate
has deterministic behavior requiring a regression-first change; Next.js and
Vercel are integrations requiring build/deployment smoke evidence; the public UI
needs browser verification but no visual redesign review.

## Commands

All local commands run with Node.js 24 active:

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm exec tsc --version
pnpm exec tsc6 --version
pnpm test scripts/agent-operable-regression-gate.test.mjs
pnpm typecheck
pnpm typecheck:ts6
pnpm test
pnpm build
pnpm agent:regression-gate -- --dry-run
git diff --check
```

Deployment and external validation:

```bash
vercel project inspect local-activities
vercel deploy
vercel inspect "$PREVIEW_URL"
gh pr checks --watch
```

Browser verification uses `agent-browser` with content boundaries enabled to
open the Preview, wait for network idle, inspect the public catalog, exercise a
public route or API boundary supported by Preview data, and inspect console and
page errors.

## Pass Criteria

- Node reports major 24 and pnpm reports major 11.
- Frozen installation exits zero without lockfile changes.
- `tsc` reports 7.0.2 and `tsc6` reports the installed 6.0.x compatibility line.
- Focused and full Vitest runs report zero failures.
- Both compiler checks exit zero and create separate ignored caches.
- Next.js build exits zero after its TypeScript phase.
- Regression-gate dry run includes TS7 before TS6 and both before replay/eval.
- Vercel reports Node 24.x and Preview status Ready.
- Browser verification reports expected content/status, no uncaught page errors,
  and no application console errors introduced by the migration.
- GitHub required checks pass and code review has no unresolved findings.

## Manual Checks

- [ ] Package alias ownership matches `ARCHITECTURE.md`.
- [ ] Canonical docs and `AGENTS.md` are mutually consistent.
- [ ] No direct TS6-only, `tsgo`, native-preview, or shared-cache assumption
  remains outside historical/design context.
- [ ] Issue and PR contain validation evidence and follow-up removal criteria.

## Known Gaps

- TS7 does not validate `.mjs`, SQL, external providers, or deployed runtime
  behavior; existing tests and Preview/browser checks cover those boundaries.
- The Next.js language-service plugin may continue to require TS6 in editors;
  CLI TS7 is authoritative during the compatibility period.
