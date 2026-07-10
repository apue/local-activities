# TypeScript 7 Migration Specification

Status: approved

Issue: #400

## Goal

Use TypeScript 7.0.x as the primary command-line compiler and coding-agent
feedback loop while preserving the smallest TypeScript 6 compatibility surface
required by Next.js 16.2.6. Prove the migrated toolchain under Node.js 24,
pnpm 11, the full local validation suite, and a browser-verified Vercel Preview.

## Non-Goals

- Upgrade the project to Node.js 26 before Vercel supports 26.x.
- Convert `.mjs` collector or pipeline modules to TypeScript.
- Disable Next.js build-time type validation.
- Change product behavior, data models, publishing policy, or runtime providers.
- Remove the TS6 compatibility package before Next.js supports the TS7 API.

## Users and Use Cases

- Coding agents need a fast authoritative type-check after each TS/TSX change.
- Developers need editor and CLI behavior that can transition independently.
- CI and Vercel need deterministic builds even though Next.js still imports the
  TS6 programmatic API.
- Maintainers need an explicit removal condition for the temporary TS6 layer.

## Requirements

### Functional

- `pnpm typecheck` invokes TypeScript 7.0.2.
- `pnpm typecheck:ts6` invokes the TS6 compatibility compiler.
- The two commands use separate incremental build-info files.
- The agent-operable regression gate executes both compiler checks.
- `next build` retains full framework type validation through the package named
  `typescript`.

### Non-Functional

- Node.js 24.x and pnpm 11.x are the only validated toolchain versions.
- `@types/node` matches the Node.js 24 runtime line.
- Installation remains reproducible with `pnpm install --frozen-lockfile`.
- Documentation distinguishes TS7-owned CLI behavior from TS6-owned Next.js API
  compatibility.
- No migration preview package, `tsgo` command, or shared compiler cache remains.

### Constraints

- Use the existing Next.js full-stack architecture.
- Do not add services, frameworks, or third-party observability.
- Follow Issue -> branch -> tests -> PR -> review -> fixes -> checks -> merge.
- Deploy and inspect a Vercel Preview before merge.

## Open Questions

None. Node.js 26 is explicitly deferred to a future issue after Vercel support.

## Acceptance Link

See `ACCEPTANCE.md` and the approved design in
`docs/superpowers/specs/2026-07-10-typescript-7-upgrade-design.md`.
