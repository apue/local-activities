# TypeScript 7 Direct-Replacement Problem Review

Status: diagnosed; architecture avoids the failure

## Symptom

Replacing the package named `typescript` directly with 7.0.2 allows standalone
type checking but causes `next build` to fail during Next.js TypeScript setup.

## Evidence

- Expected: TS7 standalone type check and Next.js build both exit zero.
- Actual: TS7 type check exits zero; Next.js reports the TypeScript package as
  missing and then fails because the expected compiler API module is absent.
- Source inspection: Next.js 16.2.6 resolves
  `typescript/lib/typescript.js` and calls the TypeScript programmatic API.
- Package inspection: TypeScript 7.0.2 exports its CLI and unstable APIs but no
  stable `lib/typescript.js` entry point.

## Triage Class

contract-mismatch

## Root Cause

TypeScript 7.0 intentionally ships without a stable programmatic API, while
Next.js 16.2.6 still requires the TypeScript 6 API during build validation.

## Impact Scope

- Affected: package dependency ownership and `next build`.
- Not affected: application TS/TSX source semantics in the observed check.
- User impact if unfixed: Preview and production builds fail.

## Fix Options

1. Supported package aliases: retain TS6 API under `typescript`, supply TS7
   `tsc` through `@typescript/native`. Preserves all gates with temporary cost.
2. Disable Next.js type validation. Rejected because it weakens safety.
3. Wait for framework/API support. Safe but fails the current upgrade goal.

## Recommended Repair Depth

contract repair through the supported side-by-side alias architecture.

## Validation Required

- TS7 and TS6 version probes and type checks.
- Next.js production build under Node 24.
- Vercel Preview build and browser smoke.

## Remaining Delta

Remove the TS6 compatibility alias in a future issue after Next.js supports the
stable TypeScript 7 API.
