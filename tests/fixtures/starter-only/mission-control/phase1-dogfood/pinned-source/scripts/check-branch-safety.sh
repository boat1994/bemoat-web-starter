#!/usr/bin/env sh
# Blocks routine work on protected Git Flow branches.
set -eu

branch="$(git branch --show-current 2>/dev/null || true)"

if [ -z "$branch" ]; then
  echo "Current branch: <detached>" >&2
  echo "Branch safety failed: detached HEAD is not an implementation branch." >&2
  echo "Create a topic branch first, for example:" >&2
  echo "  git switch -c chore/67-git-flow-branch-guardrails dev" >&2
  exit 1
fi

echo "Current branch: $branch"

case "$branch" in
  main)
    echo "Branch safety failed: main is protected and read-only for direct coding." >&2
    echo "Create a topic branch from dev, for example:" >&2
    echo "  git switch -c chore/67-git-flow-branch-guardrails dev" >&2
    exit 1
    ;;
  dev)
    if [ "${ALLOW_INTEGRATION_BRANCH:-}" = "1" ]; then
      echo "Branch safety: integration maintenance bypass enabled for dev."
      exit 0
    fi

    echo "Branch safety failed: dev is an integration branch, not a routine implementation branch." >&2
    echo "Set ALLOW_INTEGRATION_BRANCH=1 only for controlled integration maintenance." >&2
    echo "For normal work, create a topic branch:" >&2
    echo "  git switch -c chore/67-git-flow-branch-guardrails dev" >&2
    exit 1
    ;;
  feature/*|feat/*|fix/*|refactor/*|chore/*|test/*|docs/*|release/*|hotfix/*)
    echo "Branch safety: $branch is allowed."
    exit 0
    ;;
  *)
    echo "Branch safety failed: Unsupported implementation branch \"$branch\"." >&2
    echo "Allowed branch prefixes: feature/, feat/, fix/, refactor/, chore/, test/, docs/, release/, hotfix/." >&2
    echo "Create a safe topic branch, for example:" >&2
    echo "  git switch -c chore/67-git-flow-branch-guardrails dev" >&2
    exit 1
    ;;
esac
