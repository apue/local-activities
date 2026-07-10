# TypeScript 7 Upgrade Design

## Status

Approved for implementation under GitHub issue #400. This file records the
migration design; the repository's canonical technical and testing guidance
remains in the documentation layers named by `AGENTS.md` and will be updated by
the implementation.

## Goal

Make TypeScript 7.0.x the primary compiler used by developers, coding agents,
and the standalone type-check command without weakening Next.js build-time type
validation. Keep only the TypeScript 6 compatibility surface that Next.js
16.2.6 requires until Next.js can consume the TypeScript 7 programmatic API.

## Runtime decision

- Node.js 24.x is the only supported development, CI, build, and Vercel runtime
  for this migration.
- pnpm 11.x remains the package manager.
- Node.js 26 is outside this change. It will receive a separate issue after it
  becomes LTS and Vercel exposes 26.x as a supported build and function runtime.
- `@types/node` must track the Node.js 24 runtime rather than exposing APIs from
  Node.js 25 or 26.

## Current constraints

- The application currently uses TypeScript 6.0.3 and Next.js 16.2.6.
- The existing `tsconfig.json` already uses `strict`, `module: esnext`,
  `moduleResolution: bundler`, and an ES2022 target.
- TypeScript 7.0.2 type-checks the current TS/TSX source without code changes.
- Replacing the `typescript` package directly with 7.0.2 breaks `next build`.
  Next.js still loads `typescript/lib/typescript.js` and calls the compiler API,
  while TypeScript 7.0 intentionally does not expose a stable compiler API.
- The collector and pipeline contain `.mjs` modules. They remain outside the
  TypeScript compiler boundary and continue to rely on Vitest and runtime tests.

## Chosen architecture

Use Microsoft's supported side-by-side package arrangement:

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@7.0.2",
    "typescript": "npm:@typescript/typescript6@6.0.2"
  }
}
```

The packages have deliberately different responsibilities:

- `@typescript/native` supplies the `tsc` executable. `pnpm typecheck` therefore
  runs TypeScript 7.
- The package named `typescript` supplies the TypeScript 6 programmatic API and
  the `tsc6` executable. Next.js resolves this package during `next build`.
- No application module may import `typescript` as a runtime dependency. The
  compatibility package exists only for framework tooling and the explicit
  compatibility check.

The scripts will expose the boundary directly:

```json
{
  "build": "pnpm typecheck && next build",
  "typecheck": "tsc --noEmit --tsBuildInfoFile tsconfig.ts7.tsbuildinfo",
  "typecheck:ts6": "tsc6 --noEmit --tsBuildInfoFile tsconfig.ts6.tsbuildinfo",
  "typecheck:compat": "pnpm typecheck && pnpm typecheck:ts6"
}
```

Keeping the TS7 check inside the stable `build` entry point makes Vercel
Preview and production builds enforce the same primary compiler gate before
Next.js performs its TS6-backed framework validation.

Separate build-info files prevent the two compiler implementations from reading
or overwriting the same incremental state. The existing `*.tsbuildinfo` ignore
rule covers both files. Next.js continues to own its build cache under `.next`.

## Configuration changes

- Pin the Node.js development line to 24 in a repository version file while
  retaining `engines.node: 24.x` and `packageManager: pnpm@11.0.0`.
- Align `@types/node` to the latest compatible 24.x release.
- Keep the existing module resolution, target, JSX, strictness, and Next plugin
  settings unless the real TypeScript 7 run proves a change is required.
- Make Node globals explicit in `tsconfig.json` if required by TypeScript 7's
  `types` default; do not broaden ambient types beyond the packages the app uses.
- Do not set `typescript.ignoreBuildErrors` in Next.js.

## Coding-agent behavior

`AGENTS.md` will require coding agents to:

- use Node.js 24 and pnpm 11;
- treat `pnpm typecheck` as the TypeScript 7 gate;
- run `pnpm typecheck:ts6` for shared contracts, Next.js integration, compiler
  configuration, and dependency changes;
- run `pnpm test` and `pnpm build` before handoff;
- avoid claiming that TypeScript validates `.mjs`, SQL, provider behavior, or
  deployed runtime behavior;
- preserve the TS6 package only as a temporary Next.js compatibility layer and
  remove it in a future issue once the framework no longer needs it.

TypeScript 7 editor/LSP adoption is optional during the compatibility period.
The Next.js language-service plugin may still rely on the TypeScript 6 API, so
the command-line compiler is the authoritative TS7 gate.

## Documentation changes

Update the current documentation layers instead of treating this design file as
ongoing source of truth:

- `AGENTS.md`: exact compiler ownership, commands, agent validation rules, and
  TS6 removal condition.
- `docs/technical-baseline.md`: Node 24, pnpm 11, TS7 primary compiler, and the
  temporary Next.js compatibility boundary.
- `docs/testing-strategy.md`: TS7, TS6 compatibility, test, and build gates.
- `docs/quickstart.md`: version activation, install, and verification commands.
- Other directly conflicting setup or contribution text found by targeted
  search.

## Cleanup

The implementation will search for and remove:

- the direct TypeScript 6.0.3 dependency;
- scripts or documentation that describe a single undifferentiated compiler;
- shared incremental-cache assumptions;
- obsolete migration experiments, preview package names, or `tsgo` commands;
- redundant tests that only cover removed configuration.

No application or test code will be deleted merely to satisfy a cleanup count.
Any removal requires a confirmed replacement and no remaining caller.

## Validation

Primary validation modes are schema/configuration checks, regression tests,
build smoke tests, deployment smoke tests, browser verification, and code
review. This migration does not change deterministic product behavior, so it
does not require new business-logic TDD unless implementation uncovers a bug.

Run under Node.js 24.x and pnpm 11.x:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm typecheck:ts6
pnpm test
pnpm build
```

The Vercel Preview must build successfully and browser automation must verify:

- the public catalog responds and renders;
- at least one dynamic or API route used by the public surface responds as
  expected for available Preview data;
- the browser reports no uncaught page errors;
- the console contains no application errors introduced by the migration.

GitHub checks and an explicit code review follow the local and Preview gates.
Actionable review findings are fixed and revalidated before merge.

## Rollback and stop conditions

- If TS7 and TS6 report different actionable diagnostics, keep both compilers
  installed, record the smallest reproduction, and diagnose before changing
  application semantics.
- If Next.js cannot build with the compatibility alias, do not disable build
  type checking; stop and reassess the framework boundary.
- If Vercel does not use Node 24 or cannot install the aliased packages, stop and
  resolve environment parity before merge.
- Rollback consists of reverting the migration commit(s), restoring TypeScript
  6.0.3 as the sole compiler, and retaining the issue evidence for a later retry.

## Deferred work

- Remove the TS6 compatibility package after a Next.js release supports the
  stable TypeScript 7 API.
- Upgrade to Node.js 26 in a separate issue after Node 26 is LTS and Vercel
  supports 26.x.
- Convert `.mjs` collector or pipeline modules to TypeScript only through
  separately scoped, independently testable issues.
