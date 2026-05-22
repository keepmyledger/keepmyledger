#!/usr/bin/env bash
set -euo pipefail

# Sync selected commits from private main -> public oss/main.
#
# Workflow:
# 1) Finds commits on main since oss-sync-base.
# 2) Skips commits that touch scrub-managed/proprietary paths.
# 3) Cherry-picks allowed commits onto a temp branch from oss/main.
# 4) Pushes temp branch to oss/main.
# 5) Moves oss-sync-base tag to current main HEAD.

OSS_REMOTE="${OSS_REMOTE:-oss}"
OSS_BRANCH="${OSS_BRANCH:-main}"
PRIMARY_BRANCH="${PRIMARY_BRANCH:-main}"
BASE_TAG="${BASE_TAG:-oss-sync-base}"
WORK_BRANCH="${WORK_BRANCH:-oss-sync-work}"

BLOCKED_REGEX='^(fly.toml|TODO.md|STYLING.md|web/src/pages/Privacy.tsx|web/src/pages/Terms.tsx|web/public/klm-hero.png|server/src/db/migrations/|server/src/db/migrations-pg/)'

require_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is not clean. Commit or stash changes first." >&2
    exit 1
  fi
}

ensure_refs() {
  git rev-parse --verify "refs/heads/${PRIMARY_BRANCH}" >/dev/null
  git rev-parse --verify "refs/tags/${BASE_TAG}" >/dev/null
}

collect_commits() {
  git rev-list --reverse "${BASE_TAG}..${PRIMARY_BRANCH}"
}

commit_touches_blocked_path() {
  local commit="$1"
  if git diff-tree --no-commit-id --name-only -r "$commit" | grep -Eq "$BLOCKED_REGEX"; then
    return 0
  fi
  return 1
}

main() {
  require_clean_tree
  git fetch --tags "$OSS_REMOTE" "$OSS_BRANCH"
  git fetch --tags origin "$PRIMARY_BRANCH"
  ensure_refs

  all_commits=()
  while IFS= read -r commit; do
    all_commits+=("$commit")
  done < <(collect_commits)

  if [[ ${#all_commits[@]} -eq 0 ]]; then
    echo "No new commits since ${BASE_TAG}."
    exit 0
  fi

  allowed_commits=()
  skipped_commits=()

  for commit in "${all_commits[@]}"; do
    if commit_touches_blocked_path "$commit"; then
      skipped_commits+=("$commit")
    else
      allowed_commits+=("$commit")
    fi
  done

  echo "Commits since ${BASE_TAG}: ${#all_commits[@]}"
  echo "Allowed for cherry-pick: ${#allowed_commits[@]}"
  echo "Skipped (blocked paths): ${#skipped_commits[@]}"

  if [[ ${#skipped_commits[@]} -gt 0 ]]; then
    echo ""
    echo "Skipped commits touching scrub-managed paths:"
    for commit in "${skipped_commits[@]}"; do
      echo "  - $commit $(git show -s --format=%s "$commit")"
    done
    echo ""
    echo "Review skipped commits manually."
  fi

  if [[ ${#allowed_commits[@]} -eq 0 ]]; then
    echo "No eligible commits to sync."
    exit 0
  fi

  current_branch="$(git rev-parse --abbrev-ref HEAD)"

  git checkout -B "$WORK_BRANCH" "${OSS_REMOTE}/${OSS_BRANCH}"

  for commit in "${allowed_commits[@]}"; do
    echo "Cherry-picking $commit"
    if ! git cherry-pick -x "$commit"; then
      echo "Cherry-pick failed on $commit. Resolve conflicts, then run:"
      echo "  git cherry-pick --continue"
      echo "or abort with:"
      echo "  git cherry-pick --abort"
      exit 1
    fi
  done

  git push "$OSS_REMOTE" "${WORK_BRANCH}:${OSS_BRANCH}"

  git checkout "$current_branch"
  git tag -f "$BASE_TAG" "$PRIMARY_BRANCH"

  echo ""
  echo "Sync complete."
  echo "Updated ${OSS_REMOTE}/${OSS_BRANCH} and moved ${BASE_TAG} -> ${PRIMARY_BRANCH}."
}

main "$@"
