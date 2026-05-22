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
- `web/src/pages/Privacy.tsx`
- `web/src/pages/Terms.tsx`
- `web/public/klm-hero.png`
- `server/src/db/migrations/`
- `server/src/db/migrations-pg/`

## Migration policy

Private and OSS branches may diverge in migration history strategy. For OSS,
we currently use consolidated `001_init.sql` files for SQLite and Postgres.

If private branch migrations change, re-author equivalent OSS migration changes
manually instead of blindly cherry-picking migration commits.

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
grep -RinE "(Creek Ridge|klm-hero|/privacy|/terms)" web/src server README.md
```
