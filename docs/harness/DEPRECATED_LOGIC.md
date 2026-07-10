# TypeScript 7 Migration Deprecated Logic

Status: scoped for issue #400

## Deprecated or Legacy Logic

- `package.json` direct `typescript: 6.0.3`
  - Replacement: TS7 alias owns `tsc`; TS6 compatibility alias owns the API and
    `tsc6`.
  - Removal condition: migrated scripts and Next.js build pass.
- `package.json` `@types/node: 25.9.1`
  - Replacement: current Node 24.x type line.
  - Removal condition: TS7, TS6, tests, and build pass under Node 24.
- `package.json` shared `typecheck: tsc --noEmit`
  - Replacement: explicit TS7 and TS6 commands with distinct cache files.
  - Removal condition: regression gate and docs use the new commands.
- Agent regression gate with only one compiler step
  - Replacement: primary TS7 step followed by TS6 compatibility step.
  - Removal condition: focused red/green regression test proves the sequence.
- Documentation describing generic TypeScript without compiler ownership
  - Replacement: canonical docs explain TS7 primary and temporary TS6 API use.
  - Removal condition: targeted search finds no conflicting active guidance.

## Deletion Candidates Rejected

- Application, collector, pipeline, migration, and product tests: not obsolete;
  they cover runtime boundaries TS7 does not validate.
- Historical goal documents containing `pnpm typecheck`: command remains valid
  and historical records should not be rewritten without a contradiction.
- Next.js TypeScript plugin configuration: retained for TS6-compatible editor
  tooling and framework integration.

## Required Validation

- Search for TS6-only, `tsgo`, native-preview, shared-cache, Node 25, and Node 26
  active guidance after edits.
- Run compiler probes, both type checks, focused gate tests, full tests, build,
  Preview, browser smoke, and code review.
