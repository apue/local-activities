# TypeScript 7 Migration Codebase Map

Status: current for issue #400

## Overview

The repository is a Next.js 16 full-stack application with TypeScript/TSX app
and server code plus `.mjs` capture and pipeline modules. Toolchain ownership is
centralized in root configuration and an existing agent regression gate.

## Key Directories

- `app/`: Next.js App Router pages, route handlers, and UI tests.
- `src/`: TypeScript server/client/contracts plus `.mjs` capture and pipeline
  modules.
- `scripts/`: operational CLIs and the agent-operable regression gate.
- `tests/`: regression corpus fixtures and migration/contract tests.
- `docs/`: canonical requirements, setup, technical baseline, and testing rules.
- `.github/`: issue/PR templates and Codex review prompt; no Actions workflow is
  currently committed.
- `supabase/`: database migrations and Edge Function code outside the Next.js
  compiler/build runtime.

## Entry Points

- `package.json`: Node/pnpm versions, compiler aliases, and validation scripts.
- `pnpm-lock.yaml`: reproducible package resolution.
- `tsconfig.json`: shared TS/TSX semantics and Next.js plugin configuration.
- `next.config.mjs`: Next.js build configuration.
- `vercel.json`: Vercel framework, install, and build commands.
- `scripts/agent-operable-regression-gate.mjs`: ordered agent validation gate.
- `AGENTS.md`: mandatory coding-agent workflow and technical constraints.

## Tests

- `scripts/agent-operable-regression-gate.test.mjs`: regression-gate contract,
  sequence, output, and fail-fast behavior.
- `app/**/*.test.tsx`: UI behavior.
- `src/**/*.test.ts` and `src/**/*.test.mjs`: application, server, capture, and
  pipeline regression tests.
- `tests/migrations/*.test.ts`: schema contract tests.

## Migration Touch Points

- Modify: `.gitignore`, repository Node version file, `package.json`,
  `pnpm-lock.yaml`, and possibly `tsconfig.json` only if explicit ambient Node
  types are required.
- Modify: agent regression gate and its focused test.
- Modify: `AGENTS.md`, `docs/quickstart.md`, `docs/technical-baseline.md`, and
  `docs/testing-strategy.md`.
- Review for conflicts: `README.md`, `docs/tech-stack.md`, contribution and PR
  templates, and historical goal documents. Historical commands need not be
  rewritten when they remain valid and are clearly historical.
