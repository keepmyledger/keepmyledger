# Contributing to KeepMyLedger

Thank you for your interest in contributing! This document covers everything
you need to get started.

---

## Table of contents

- [Development setup](#development-setup)
- [Running tests](#running-tests)
- [Code conventions](#code-conventions)
- [Submitting a pull request](#submitting-a-pull-request)
- [Reporting bugs](#reporting-bugs)
- [Requesting features](#requesting-features)

---

## Development setup

### Prerequisites

- **Node 22+** and **npm 10+**
- **Git**
- (optional) **Docker** - for Postgres integration tests

### Steps

```bash
git clone https://github.com/keepmyledger/keepmyledger.git
cd keepmyledger
npm install                       # installs all three workspaces
cp server/.env.example server/.env
# Edit server/.env - at minimum set SESSION_SECRET
npm run dev
```

`npm run dev` starts the Vite dev server on **:5173** and the Express API on
**:3001**. The Vite proxy forwards `/api` calls to Express; no CORS config
needed locally.

### Environment variables

See the table in [README.md](README.md#configuration) for all variables. For
local dev the only required one is `SESSION_SECRET`; leave `DATABASE_URL`
unset to use SQLite.

---

## Running tests

```bash
# All server tests (SQLite in-memory)
npm test --workspace=server

# Watch mode
npm test --workspace=server -- --watch

# Single file
npx jest --testPathPattern=csv --workspace=server
```

Tests live in `server/src/__tests__/`. Each test file has a corresponding
source file with the same name. Integration tests that need a real DB use the
SQLite in-memory adapter from `server/src/__tests__/helpers/db.ts`.

---

## Code conventions

- **Language**: TypeScript throughout. Avoid `any`; use `unknown` + type guards.
- **Formatting**: Prettier (see `.prettierrc`). Run `npm run format` before
  committing, or install the VS Code Prettier extension with format-on-save.
- **Imports**: prefer named exports. No default exports from library modules;
  default export only for React page components.
- **Error handling**: throw `Error` subclasses with meaningful messages; never
  swallow errors silently.
- **DB queries**: go through the repo interfaces (`server/src/repos/`); do not
  write raw SQL in routes or services.
- **Secrets**: never commit secrets or credentials. Use `.env` (git-ignored).

---

## Submitting a pull request

1. Fork the repo and create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes. Keep commits focused - one logical change per commit.
3. Ensure all tests pass: `npm test --workspace=server`
4. Open a PR against `main`. Fill in the PR template.
5. A maintainer will review and merge. Rebasing may be requested for a cleaner
   history.

**PR checklist:**
- [ ] Tests added / updated for new behaviour
- [ ] `npm run build` succeeds
- [ ] No new linting errors (`npm run lint --workspace=server`)
- [ ] PR description explains *why*, not just *what*

---

## Reporting bugs

Use [GitHub Issues](https://github.com/keepmyledger/keepmyledger/issues) and
select the **Bug report** template.

## Requesting features

Use [GitHub Issues](https://github.com/keepmyledger/keepmyledger/issues) and
select the **Feature request** template. For large changes, open an issue
first to discuss before investing in an implementation.
