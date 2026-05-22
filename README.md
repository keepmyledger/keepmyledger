# KeepMyLedger

An open-source personal finance tracker for individuals and small businesses.
Import bank and credit-card statements, categorise transactions with rules or
AI assistance, and produce tax-ready reports - all on your own infrastructure.

> **License:** [AGPL-3.0-or-later](LICENSE)

---

## Features

- **Statement import** - CSV, QIF, and PDF (positional + LLM-assisted)
- **Rule engine** - substring/regex rules with priority ordering
- **AI categorisation** - optional OpenAI-compatible endpoint
- **Google Drive receipts** - link receipt images to transactions
- **Reports** - monthly P&L, annual tax summary, CSV export
- **Multi-backend DB** - SQLite (default, zero-config) or Postgres
- **Local auth** - username/password (argon2id) + TOTP (RFC 6238)
- **Google OAuth** - optional, requires your own OAuth client
- **PWA** - installable as a mobile/desktop app

---

## Quick start (Docker)

```bash
docker run -d \
  -p 3000:3000 \
  -e APP_MODE=selfhost \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -v kml-data:/app/server/data \
  ghcr.io/keepmyledger/keepmyledger:latest
```

Open <http://localhost:3000>. A local owner account is created automatically on
the first request - no sign-up required in self-host mode.

---

## Configuration

All configuration is via environment variables.

| Variable | Default | Description |
|---|---|---|
| `APP_MODE` | `selfhost` | `selfhost` or `saas` |
| `SESSION_SECRET` | *(required)* | Secret for signing session cookies |
| `DATABASE_URL` | *(SQLite)* | `postgres://user:pass@host/db` to use Postgres |
| `OPENAI_API_KEY` | - | AI categorisation (any OpenAI-compatible endpoint) |
| `OPENAI_BASE_URL` | OpenAI default | Override for local LLM servers |
| `GOOGLE_OAUTH_CLIENT_ID` | - | Google OAuth (optional) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | - | Google OAuth (optional) |
| `GOOGLE_DRIVE_ENABLED` | `false` | Enable Google Drive receipt storage |
| `PORT` | `3000` | HTTP listen port |

---

## Development setup

### Prerequisites

- Node 22+
- npm 10+
- (optional) Docker + Docker Compose for Postgres

### Install & run

```bash
git clone https://github.com/keepmyledger/keepmyledger.git
cd keepmyledger
npm install
cp server/.env.example server/.env   # edit as needed
npm run dev
```

`npm run dev` starts the Vite dev server (port 5173) and the Express API server
(port 3001) concurrently. The Vite proxy forwards `/api` requests to Express.

### Testing

```bash
# All tests (SQLite in-memory)
npm test --workspace=server

# Specific suite
npx jest --testPathPattern=csv
```

### Building

```bash
npm run build        # builds shared + server + web
npm start            # starts the compiled server (serves built web assets)
```

---

## Project structure

```
shared/   TypeScript types shared between server and web
server/   Express API (Node 22, TypeScript)
  src/
    db/           SQLite/Postgres adapter + migration runner
    parsers/      Statement file parsers (CSV, QIF, PDF, LLM)
    repos/        Data access layer (interface + SQLite/PG implementations)
    routes/       Express route handlers
    services/     Business logic (import, categorization, drive, AI)
    auth/         Passport strategies, session store
web/      React SPA (Vite, TypeScript)
  src/
    pages/        Page components
    components/   Shared UI components
    styles/       Design tokens
    api/          Typed API client
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

---

## Security

To report a vulnerability privately, see [SECURITY.md](SECURITY.md).
