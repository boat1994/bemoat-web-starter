# Git Flow branching guardrails

This repository uses a lightweight Git Flow model so AI-assisted work happens on explicit work branches and moves through pull request review.

## Branch roles

| Branch | Role | Direct coding |
|--------|------|---------------|
| `main` | Stable release baseline | No |
| `dev` | Integration baseline for active work | No, except controlled integration maintenance |

Routine feature, fix, refactor, docs, chore, and test work must happen on a topic branch.

## Topic branches

Create normal work branches from current `dev`:

```bash
git fetch origin
git switch dev
git pull origin dev
git switch -c <type>/<issue-number>-<short-slug>
```

Allowed prefixes:

```text
feature/*
feat/*
fix/*
refactor/*
chore/*
test/*
docs/*
```

Examples:

```text
feature/67-git-flow-branch-guardrails
feat/42-mobbin-reference-cms
fix/72-storybook-build
chore/67-git-flow-branch-guardrails
```

## Normal feature flow

1. Read the issue and acceptance criteria.
2. Sync `dev`.
3. Create a topic branch from `dev`.
4. Implement only the issue scope.
5. Run the required validation tier.
6. Push the topic branch.
7. Open or update a pull request targeting `dev`.
8. Wait for review and CI.
9. Humans merge; agents do not merge.

## Release flow

Use release branches only when `dev` is ready to stabilize:

```text
dev -> release/<version-or-date> -> main -> dev
```

Release branches may use:

```text
release/*
```

Release PRs into `main` should include validation evidence and any required release notes. After release, back-merge or reconcile release changes into `dev`.

## Hotfix flow

Use hotfix branches only for urgent stable-line fixes:

```text
main -> hotfix/<issue-number>-<short-scope> -> main -> dev
```

Hotfix branches may use:

```text
hotfix/*
```

Hotfix PRs target `main`, stay minimal, and must be followed by a back-merge or cherry-pick into `dev`.

## AI coding rule

Before editing files, agents must run `git status` and confirm the current branch.

If the branch is `main`:

- stop immediately
- do not edit files
- do not commit
- create or ask for a topic branch from `dev`

If the branch is `dev`:

- stop before coding unless the task is explicitly integration maintenance
- prefer a topic branch from `dev`
- use `ALLOW_INTEGRATION_BRANCH=1` only for controlled integration maintenance

Allowed implementation branches are:

```text
feature/*
feat/*
fix/*
refactor/*
chore/*
test/*
docs/*
release/*
hotfix/*
```

## Local branch safety checks

Manual check:

```bash
pnpm run branch:check
```

Child-safe namespaced check:

```bash
pnpm run bemoat:branch:check
```

The check blocks `main`, blocks `dev` unless `ALLOW_INTEGRATION_BRANCH=1`, and allows the branch patterns above.

Install optional local hooks:

```bash
pnpm run hooks:install
```

The installed hooks run branch safety before commits and pushes. The pre-push hook then runs the child-safe harness checks.

## GitHub branch protection checklist

Recommended `main` protections:

- require pull request before merging
- require status checks before merging
- block force pushes
- block deletions
- restrict direct pushes

Recommended `dev` protections:

- require pull request before merging when possible
- require validation checks
- block force pushes
- block deletions

## Bootstrap note

Older repos may not have `dev` yet. Create `dev` once from current `main`, push it, and enable branch protection before moving routine work to Git Flow. Until `dev` exists, use the safest available protected baseline and call out the temporary exception in the PR.
