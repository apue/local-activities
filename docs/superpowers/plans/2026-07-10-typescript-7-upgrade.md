# TypeScript 7 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TypeScript 7.0.2 the primary compiler and coding-agent check,
retain only the TS6 API compatibility required by Next.js 16.2.6, and prove the
complete toolchain locally and on Vercel Preview under Node.js 24 and pnpm 11.

**Architecture:** The `@typescript/native` alias supplies TS7's `tsc` binary;
the package named `typescript` aliases `@typescript/typescript6` so Next.js can
load the stable compiler API and humans can run `tsc6`. Separate package scripts
and build-info files expose ownership, and the existing agent regression gate
runs both compilers before pipeline replay/evaluation.

**Tech Stack:** Node.js 24.x, pnpm 11.0.0, TypeScript 7.0.2,
`@typescript/typescript6` 6.0.2, Next.js 16.2.6, Vitest 4.1.7, Vercel CLI,
agent-browser, GitHub CLI.

## Global Constraints

- Node.js 24.x is the only development, test, build, and Vercel runtime.
- pnpm 11.x is the only package manager.
- `pnpm typecheck` must run TS7; `pnpm typecheck:ts6` must run TS6.
- Next.js build-time type validation must remain enabled.
- TS7 and TS6 must not share incremental build state.
- Do not migrate `.mjs`, SQL, product behavior, or external providers.
- Do not add frameworks, services, or third-party observability.
- Node.js 26 remains deferred until it is LTS and Vercel supports 26.x.
- Use issue #400 and branch `codex/400-typescript-7-upgrade`.

References:

- `docs/harness/SPEC.md`
- `docs/harness/ARCHITECTURE.md`
- `docs/harness/ACCEPTANCE.md`
- `docs/harness/REUSE_CLEANUP_REPORT.md`
- `docs/harness/VALIDATION_PLAN.md`
- `docs/superpowers/specs/2026-07-10-typescript-7-upgrade-design.md`

---

### Task 1: Lock the toolchain and regression-gate contract with failing tests

**Files:**

- Modify: `scripts/agent-operable-regression-gate.test.mjs`
- Test: `scripts/agent-operable-regression-gate.test.mjs`

**Interfaces:**

- Consumes: `packageJson.scripts`, `packageJson.devDependencies`, and
  `buildAgentOperableRegressionGatePlan()`.
- Produces: failing contract assertions for exact compiler aliases, isolated
  scripts, ordered TS7/TS6 checks, and TS6 fail-fast behavior.

- [ ] **Step 1: Add the failing package-toolchain contract test**

Add after the existing package-script test:

```js
it("exposes the isolated TypeScript 7 and TypeScript 6 toolchain", () => {
  expect(packageJson.devDependencies).toMatchObject({
    "@types/node": "24.13.3",
    "@typescript/native": "npm:typescript@7.0.2",
    typescript: "npm:@typescript/typescript6@6.0.2",
  });
  expect(packageJson.scripts).toMatchObject({
    typecheck:
      "tsc --noEmit --tsBuildInfoFile tsconfig.ts7.tsbuildinfo",
    "typecheck:ts6":
      "tsc6 --noEmit --tsBuildInfoFile tsconfig.ts6.tsbuildinfo",
    "typecheck:compat": "pnpm typecheck && pnpm typecheck:ts6",
  });
});
```

- [ ] **Step 2: Extend the expected gate sequence**

Keep the existing primary step named `typecheck` with display
`pnpm typecheck`. Add this object immediately after it in the plan assertion:

```js
expect.objectContaining({
  name: "typecheck_ts6",
  display: "pnpm typecheck:ts6",
}),
```

Add `typecheck_ts6` to the dry-run expectation and successful `calls` array.
Change the fail-fast test so its fake runner fails on `typecheck_ts6`, expects
error message `agent_operable_regression_gate_failed:typecheck_ts6`, and expects
these calls:

```js
["unit_tests", "typecheck", "typecheck_ts6"]
```

- [ ] **Step 3: Run the focused test and verify RED**

Run under Node.js 24:

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
node --version
pnpm test scripts/agent-operable-regression-gate.test.mjs
```

Expected: Node reports `v24.x`; the test fails because aliases/scripts and the
`typecheck_ts6` gate step do not exist. A syntax/import error is not an accepted
RED state.

### Task 2: Implement the TS7/TS6 package and gate boundary

**Files:**

- Create: `.nvmrc`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tsconfig.json`
- Modify: `scripts/agent-operable-regression-gate.mjs`
- Test: `scripts/agent-operable-regression-gate.test.mjs`

**Interfaces:**

- Consumes: the failing contract from Task 1 and existing `tsconfig.json`.
- Produces: `tsc` version 7.0.2, `tsc6` version 6.0.x, isolated caches, explicit
  Node ambient types, and an ordered compatibility gate.

- [ ] **Step 1: Add the Node 24 developer version hint**

Create `.nvmrc` with exactly:

```text
24
```

- [ ] **Step 2: Update package scripts and dependency ownership**

Set these exact scripts in `package.json`:

```json
"typecheck": "tsc --noEmit --tsBuildInfoFile tsconfig.ts7.tsbuildinfo",
"typecheck:ts6": "tsc6 --noEmit --tsBuildInfoFile tsconfig.ts6.tsbuildinfo",
"typecheck:compat": "pnpm typecheck && pnpm typecheck:ts6"
```

Set these exact development dependencies:

```json
"@types/node": "24.13.3",
"@typescript/native": "npm:typescript@7.0.2",
"typescript": "npm:@typescript/typescript6@6.0.2"
```

Preserve `packageManager: pnpm@11.0.0`, `engines.node: 24.x`, and
`engines.pnpm: 11.x`.

- [ ] **Step 3: Make Node ambient types explicit**

Add this property inside `compilerOptions` in `tsconfig.json`:

```json
"types": [
  "node"
],
```

Do not change target, module, module resolution, JSX, strictness, Next plugin,
include, or exclude settings.

- [ ] **Step 4: Add the TS6 compatibility gate step**

Insert immediately after the existing `typecheck` entry in
`agentOperableRegressionGateSteps`:

```js
{
  name: "typecheck_ts6",
  args: ["typecheck:ts6"],
},
```

Do not change the generic sequential runner or its event schema.

- [ ] **Step 5: Regenerate the lockfile under Node 24 and pnpm 11**

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
node --version
pnpm --version
pnpm install
```

Expected: Node major 24, pnpm major 11, aliases resolve to TS7.0.2 and TS6.0.2,
and no unsupported-engine warning appears.

- [ ] **Step 6: Run the focused test and verify GREEN**

```bash
pnpm test scripts/agent-operable-regression-gate.test.mjs
```

Expected: all focused tests pass, including package contract, ordering,
dry-run, success, and TS6 fail-fast behavior.

- [ ] **Step 7: Probe both binaries and run both compiler checks**

```bash
pnpm exec tsc --version
pnpm exec tsc6 --version
pnpm typecheck
pnpm typecheck:ts6
```

Expected: `tsc` reports 7.0.2; `tsc6` reports 6.0.x; both checks exit zero; root
contains separate ignored `tsconfig.ts7.tsbuildinfo` and
`tsconfig.ts6.tsbuildinfo` files.

- [ ] **Step 8: Verify a frozen reinstall does not mutate the lockfile**

```bash
shasum pnpm-lock.yaml
pnpm install --frozen-lockfile
shasum pnpm-lock.yaml
```

Expected: installation exits zero and the two lockfile hashes are identical.

- [ ] **Step 9: Commit the implementation**

```bash
git add .nvmrc package.json pnpm-lock.yaml tsconfig.json \
  scripts/agent-operable-regression-gate.mjs \
  scripts/agent-operable-regression-gate.test.mjs
git commit -m "build: adopt TypeScript 7 compiler"
```

### Task 3: Update agent and canonical toolchain documentation

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/quickstart.md`
- Modify: `docs/technical-baseline.md`
- Modify: `docs/testing-strategy.md`

**Interfaces:**

- Consumes: exact commands and ownership implemented by Task 2.
- Produces: active instructions for developers, coding agents, reviewers, and
  future compatibility-layer removal.

- [ ] **Step 1: Add exact TypeScript rules to AGENTS.md**

Under Technical Direction, replace the generic TypeScript rule with these
requirements, preserving surrounding project constraints:

```markdown
- Use TypeScript 7.0.x as the primary compiler for web-app and shared-contract
  `.ts`/`.tsx` code. `pnpm typecheck` is the authoritative TS7 CLI gate.
- Keep `@typescript/typescript6` only as the package named `typescript` while
  Next.js requires the TS6 programmatic API; `pnpm typecheck:ts6` is the
  explicit compatibility gate. Remove this layer in a dedicated issue once
  Next.js supports the stable TS7 API.
- Coding agents must run both compiler checks for shared contracts, Next.js
  integration, compiler configuration, or dependency changes, followed by
  `pnpm test` and `pnpm build` before handoff.
- TypeScript checks do not validate `.mjs`, SQL, external providers, or deployed
  runtime behavior; use their focused tests and smoke checks.
```

Retain and strengthen the existing Node 24/pnpm 11 rule; explicitly state that
Node 26 is deferred until Vercel supports it.

- [ ] **Step 2: Update the quickstart**

Add `.nvmrc`/Homebrew activation commands and verify versions before install:

```bash
export PATH="$(brew --prefix node@24)/bin:$PATH"
node --version
pnpm --version
pnpm install --frozen-lockfile
```

List routine commands in this order:

```bash
pnpm test
pnpm typecheck
pnpm typecheck:ts6
pnpm build
pnpm env:check --env-file .env.local --target local-app
```

Explain that TS7 owns the primary check while TS6 exists only for Next.js API
compatibility.

- [ ] **Step 3: Update the technical baseline**

Add a `Toolchain` section naming Node 24, pnpm 11, TS7 primary ownership, TS6
Next.js API compatibility, Node 24 typings, distinct cache files, and removal
condition. State that Node 26 is a future separate upgrade.

- [ ] **Step 4: Update the testing strategy and gate sequence**

Document both compiler checks and change the regression-gate list to:

```markdown
- `pnpm test`
- `pnpm typecheck` (TypeScript 7 primary check)
- `pnpm typecheck:ts6` (temporary Next.js compatibility check)
- `pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory`
- `pnpm pipeline:v5:eval -- --corpus-dir tests/regression-corpus --all --store memory`
```

Add Node 24/pnpm 11 and `pnpm build` to toolchain-change validation.

- [ ] **Step 5: Review documentation consistency**

```bash
rg -n "TypeScript|typescript|typecheck|Node.js 2[456]|pnpm 11|tsgo|native-preview" \
  AGENTS.md README.md CONTRIBUTING.md docs package.json \
  --glob '!docs/superpowers/**'
```

Expected: active guidance agrees with TS7 primary/TS6 compatibility and Node24;
generic product language and historical goal documents may remain when they do
not contradict the active documentation layers.

- [ ] **Step 6: Commit canonical documentation**

```bash
git add AGENTS.md docs/quickstart.md docs/technical-baseline.md docs/testing-strategy.md
git commit -m "docs: define TypeScript 7 development workflow"
```

### Task 4: Finalize harness records and remove migration residue

**Files:**

- Modify: `docs/harness/*.md`
- Create: `docs/harness/HARNESS_MODE.json` (already generated by initialization)
- Modify: `docs/superpowers/plans/2026-07-10-typescript-7-upgrade.md`
- Review: repository-wide compiler and runtime references

**Interfaces:**

- Consumes: actual Task 2/3 implementation and validation names.
- Produces: durable issue context and a clean migration audit with no vague
  templates or false database/product deletion candidates.

- [ ] **Step 1: Run the harness validator**

```bash
python3 /Users/yangtian/Developer/agent-skills/personal-codex-skills/skills/codex-development-harness/scripts/check_harness.py --root .
```

Expected: zero missing required artifacts and zero draft placeholder failures.

- [ ] **Step 2: Search for obsolete migration residue**

```bash
rg -n "typescript@6\.0\.3|\"typescript\": \"6\.0\.3\"|@types/node.*25\.9\.1|tsgo|@typescript/native-preview|shared.*tsbuildinfo|Node.js 26" \
  package.json pnpm-lock.yaml tsconfig.json scripts AGENTS.md README.md \
  docs/quickstart.md docs/technical-baseline.md docs/testing-strategy.md
```

Expected: no active old package/config command remains. A clearly marked Node26
deferral in active docs is acceptable; preview-era commands should not remain.

- [ ] **Step 3: Confirm cleanup does not delete runtime coverage**

```bash
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: no application, migration, collector, pipeline, or product test is
deleted; only focused toolchain/config/docs/harness changes appear.

- [ ] **Step 4: Update plan checkboxes and harness status**

Mark completed implementation tasks in this plan and set harness artifact status
to current/validated where evidence exists. Do not mark Preview, PR checks,
review, or merge complete before those events occur.

- [ ] **Step 5: Commit planning and harness records**

```bash
git add docs/harness docs/superpowers/plans
git commit -m "docs: record TypeScript 7 migration harness"
```

### Task 5: Run the complete local Node 24 validation gate

**Files:**

- Review: all changed files
- Generated and ignored: `tsconfig.ts7.tsbuildinfo`,
  `tsconfig.ts6.tsbuildinfo`, `.next/`

**Interfaces:**

- Consumes: completed implementation and docs.
- Produces: fresh local evidence for the issue and PR.

- [ ] **Step 1: Activate and prove the runtime**

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
node --version
pnpm --version
```

Expected: Node `v24.x` and pnpm `11.x`.

- [ ] **Step 2: Run fresh install and compiler probes**

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --version
pnpm exec tsc6 --version
```

Expected: install succeeds, TS7 reports 7.0.2, and TS6 reports 6.0.x.

- [ ] **Step 3: Run all local gates**

```bash
pnpm typecheck
pnpm typecheck:ts6
pnpm test
pnpm build
pnpm agent:regression-gate -- --dry-run
git diff --check
```

Expected: both type checks, 62+ test files, Next.js build, gate-plan inspection,
and diff whitespace validation all exit zero.

- [ ] **Step 4: Inspect final scope and worktree state**

```bash
git status --short --branch
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- package.json tsconfig.json \
  scripts/agent-operable-regression-gate.mjs \
  scripts/agent-operable-regression-gate.test.mjs AGENTS.md
```

Expected: only issue #400 changes, no secrets, generated output, or unrelated
user files are tracked.

- [ ] **Step 5: Add an issue handoff before publishing**

Post the required handoff comment to issue #400 with completed files, every
validation command and result, open Preview/PR/review work, and the next action.

### Task 6: Publish the branch and open the PR

**Files:**

- External: GitHub issue #400 and the new pull request.

**Interfaces:**

- Consumes: clean validated branch.
- Produces: remote branch and draft/non-draft PR linked with `Closes #400`.

- [ ] **Step 1: Push the issue branch**

```bash
git push -u origin codex/400-typescript-7-upgrade
```

- [ ] **Step 2: Open the PR with exact evidence**

Create a PR titled `Upgrade application toolchain to TypeScript 7` whose body
contains:

```markdown
Closes #400

## Changes

- make TypeScript 7.0.2 the primary CLI compiler
- retain isolated TypeScript 6 API compatibility for Next.js 16.2.6
- add dual compiler regression gates and Node 24-aligned configuration
- update agent, setup, technical, testing, and harness documentation

## Tests

- [x] Node.js 24.x / pnpm 11.x
- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm typecheck`
- [x] `pnpm typecheck:ts6`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm agent:regression-gate -- --dry-run`

## Review Notes

- TS6 is temporary and exists only because Next.js still imports its compiler API.
- Node.js 26 is deferred until it is LTS and supported by Vercel.
- Vercel Preview and browser verification evidence will be added before merge.
```

- [ ] **Step 3: Inspect published PR scope**

```bash
gh pr view --json number,title,headRefName,baseRefName,files,commits,url
```

Expected: base `main`, correct issue branch, and only issue #400 files/commits.

### Task 7: Deploy and browser-verify the Vercel Preview

**Files:**

- External: Vercel Preview deployment and PR validation notes.
- Local ignored evidence when useful: `.agent-runs/issue-400/`.

**Interfaces:**

- Consumes: the pushed branch and linked Vercel project.
- Produces: a Ready Preview URL, deployment inspection, and browser evidence.

- [ ] **Step 1: Confirm live Vercel project runtime**

```bash
vercel project inspect local-activities
```

Expected: project `local-activities`, Node.js Version `24.x`.

- [ ] **Step 2: Create the Preview deployment**

```bash
PREVIEW_URL="$(vercel deploy --yes)"
export PREVIEW_URL
echo "$PREVIEW_URL"
```

Record the returned Preview URL exactly. Do not use `--prod`.

- [ ] **Step 3: Inspect deployment state and build output**

```bash
vercel inspect "$PREVIEW_URL"
```

Expected: state Ready, framework Next.js, successful install/build, Node 24.x.

- [ ] **Step 4: Verify the public surface with agent-browser**

With `AGENT_BROWSER_CONTENT_BOUNDARIES=1` and allowed domains restricted to the
Preview and required Vercel asset hosts, use a named `issue-400-preview` session:

```bash
agent-browser --session issue-400-preview batch --bail \
  "open $PREVIEW_URL" \
  "wait --load networkidle" \
  "get title" \
  "snapshot -i"
agent-browser --session issue-400-preview errors
agent-browser --session issue-400-preview console
```

Expected: public catalog title/content is present, page errors are empty, and no
application error appears in console output.

- [ ] **Step 5: Verify one public runtime boundary**

Open `/api/health` on the same Preview and inspect its body/status using the
browser session. Expected: successful HTTP response and the documented health
shape; environment-specific dependency health may be reported explicitly but
must not produce an uncaught page error.

- [ ] **Step 6: Close the browser and update PR/issue evidence**

```bash
agent-browser --session issue-400-preview close
```

Add the Preview URL, Vercel Ready status, public page result, health result,
console result, and page-error result to the PR and issue handoff.

### Task 8: Run checks, code review, and repair findings

**Files:**

- Review: complete PR diff.
- Modify: only files required by actionable review findings.

**Interfaces:**

- Consumes: PR, local/Preview evidence, GitHub checks, review prompt.
- Produces: passing checks, explicit CR findings, fixes, and revalidation.

- [ ] **Step 1: Wait for GitHub checks**

```bash
gh pr checks --watch
```

If no Actions checks are configured, record that fact and use the complete local
and Vercel validation plan as the required evidence rather than inventing a new
workflow in this issue.

- [ ] **Step 2: Review the PR after checks**

Read `.github/codex/prompts/review.md`, inspect the full diff, and review for
bugs, weakened build validation, alias/caching errors, Node/runtime drift,
missing regression coverage, conflicting docs, secrets, and unrelated changes.
Publish findings first with file/line references, ordered by severity. If there
are no findings, publish that conclusion plus residual risks.

- [ ] **Step 3: Repair each actionable finding diagnosis-first**

For a code/config defect, add or adjust a failing focused test/check, observe the
expected failure, apply the smallest repair, and rerun the focused check. For a
documentation-only finding, correct the contradiction and run the consistency
search plus `git diff --check`.

- [ ] **Step 4: Push fixes and rerun complete evidence**

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm install --frozen-lockfile
pnpm typecheck
pnpm typecheck:ts6
pnpm test
pnpm build
git diff --check
git push
gh pr checks --watch
```

Repeat Preview/browser verification if a finding changes dependencies, build
configuration, Next.js code, Vercel configuration, or runtime behavior.

- [ ] **Step 5: Resolve review conversations with evidence**

Reply to actionable comments with the repair and validation result, or explain
technically why no change is appropriate. Confirm no unresolved actionable
review thread remains.

### Task 9: Merge and complete issue handoff

**Files:**

- External: PR, issue #400, main branch.

**Interfaces:**

- Consumes: Ready Preview, passing checks, no unresolved findings, and explicit
  user confirmation immediately before merge.
- Produces: merged main, closed issue, and final durable handoff.

- [ ] **Step 1: Run the completion audit**

Map every item in `docs/harness/ACCEPTANCE.md` to current file, command, Vercel,
browser, GitHub, or review evidence. Treat missing or indirect evidence as open
work and resolve it before requesting merge.

- [ ] **Step 2: Request explicit merge confirmation**

Report the PR URL, local commands/results, Preview URL/results, GitHub checks,
review findings/fixes, and residual risks. Ask the user to confirm squash merge.

- [ ] **Step 3: Squash merge only after confirmation**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Verify main and issue state**

```bash
gh pr view --json state,mergedAt,mergeCommit,url
gh issue view 400 --json state,url
git -C /Users/yangtian/Developer/local-activities pull --ff-only
git -C /Users/yangtian/Developer/local-activities status --short --branch
```

Expected: PR merged, issue closed, local main fast-forwarded, and the user's
pre-existing `.agent-runs/` remains untouched.

- [ ] **Step 5: Add the final issue handoff if the issue remains commentable**

Record done work, every final validation command, Preview/browser result, review
resolution, merge commit, deferred Node26 issue condition, and no open work for
issue #400.
