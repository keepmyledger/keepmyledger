# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

KeepMyLedger is a TypeScript monorepo with three workspaces:

- `shared/`: shared runtime types
- `server/`: Express API + DB adapters + business logic
- `web/`: React/Vite frontend

## Core commands

```bash
npm install
npm run dev
npm run build
npm test --workspace=server
npm run lint --workspace=server
```

## Environment assumptions

- Node 22+
- SQLite is default when `DATABASE_URL` is unset
- Postgres enabled when `DATABASE_URL=postgres://...`
- `APP_MODE=selfhost` is default in OSS branch

## Architecture conventions

- Route handlers should remain thin; business logic belongs in `server/src/services/`.
- Data access goes through repos in `server/src/repos/`.
- Avoid cross-layer leakage: routes should not execute ad-hoc SQL.
- Shared API types must be added to `shared/src/types.ts` and exported from
  `shared/src/index.ts`.

## Migration policy (OSS branch)

- Keep migrations minimal and deterministic.
- Current OSS strategy uses a consolidated `001_init.sql` per backend:
  - `server/src/db/migrations/001_init.sql` (SQLite)
  - `server/src/db/migrations-pg/001_init.sql` (Postgres)
- If schema changes are needed, maintainers may either:
  - append new migration files, or
  - regenerate consolidated init in a coordinated release commit.

## Agent do/don't

Do:
- Make focused, minimal edits.
- Preserve existing public API shapes unless asked to change them.
- Add/update tests for behavioural changes.
- Keep comments concise and useful.

Don't:
- Introduce secrets into code or docs.
- Rewrite unrelated files for style-only changes.
- Delete SaaS-gated logic unless explicitly asked.
- Modify lockfiles unless dependency changes require it.

## PR expectations

- Build and tests pass.
- New behaviour has test coverage or explicit rationale.
- Commit messages use clear prefixes (`fix:`, `feat:`, `chore:`).
