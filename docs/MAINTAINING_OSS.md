# Maintaining the OSS Mirror

This document explains how to sync non-proprietary changes from the private
`main` branch to the public OSS repository (`oss/main`).

## Remotes

Expected remote configuration:

```bash
git remote -v
# origin -> git@github.com:BrianRidgeway/keepmyledger.git
# oss    -> git@github.com:keepmyledger/keepmyledger.git
```

## Baseline tag

`oss-sync-base` marks the latest commit on private `main` that has already been
considered for OSS sync.

After each successful sync, the script moves this tag forward.

## Sync command

From the private repo:

```bash
bash scripts/oss-sync.sh
```

What the script does:

1. Computes commits in `oss-sync-base..main`.
2. Skips commits that touch scrub-managed/proprietary paths.
3. Cherry-picks remaining commits (with `-x`) onto a temp branch from `oss/main`.
4. Pushes the temp branch back to `oss/main`.
5. Moves `oss-sync-base` to `main`.

## Scrub-managed paths

Commits touching these paths are intentionally skipped and require manual review:

- `fly.toml`
- `TODO.md`
- `STYLING.md`
- `scripts/private/`
- `web/index.html` — contains deployment-specific JSON-LD/OG tags
- `web/tsconfig.json` — paths diverge between branches (private → `.local.*`, OSS → `.template.*`)
- `web/public/klm-hero*` — brand hero images
- `web/src/content/**/*.local.*` — brand/legal override files (`.template.*` files are public)

Migration files (`server/src/db/migrations/`, `server/src/db/migrations-pg/`) are **not** scrub-managed.
New migrations cherry-pick normally; if a migration is OSS-inappropriate, skip it per-commit instead.

## Content template pattern

Brand, legal, SEO, and cookie content lives in `web/src/content/` as a
template/override pair:

- `*.template.*` — generic placeholder content, committed to OSS
- `*.local.*` — deployment-specific overrides, gitignored on OSS (tracked on private)

Vite's `resolve.alias` (in `vite.config.ts`) and `web/tsconfig.json` `paths` both resolve the
`@content/*` aliases. At build time they prefer `.local.*` when present, falling back to `.template.*`.

Fork operators only need to create their own `.local.*` files — they will survive upstream `git pull`
updates without overwriting.

## Migration policy

OSS and private use identical, versioned migration numbering starting at `001_init.sql`.
The `001_init.sql` on OSS represents a consolidated end-state schema; future changes land
as `002_*.sql`, `003_*.sql`, etc. on both branches simultaneously.

When a new private migration is OSS-inappropriate (e.g. SaaS-only billing columns), skip it
per-commit rather than scrub-managing the entire migrations directory.

## Conflict handling

If a cherry-pick fails:

1. Resolve conflicts in the work branch.
2. Continue with `git cherry-pick --continue`.
3. Re-run test/build checks.
4. Push once clean.

If a commit should be skipped, abort (`git cherry-pick --abort`), remove it from
the candidate list, and rerun the script.

## Verification checklist

Run before or after a sync:

```bash
npm run build
npm test --workspace=server
# Confirm no private brand strings leaked into OSS
grep -RinE "(KeepMyLedger|Creek Ridge|keepmyledger\.com)" web/src web/public web/scripts web/index.html
# Confirm no .local.* files reached OSS
find web/src/content -name "*.local.*" 2>/dev/null
```
