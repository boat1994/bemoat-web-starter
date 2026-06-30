# Dev Branch Policy Sync Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Align the starter workflow rails so `dev` is the single documented integration branch before harness sync is run in child projects.

**Architecture:** Keep the synced CI workflow on `main` and `dev`, then align the branch safety shell guard, active workflow documentation, and integration tests around that contract. Use focused Vitest coverage to make `dev` branch behavior and synced CI branch targets explicit, then run the full starter validation tier because scripts and tests change.

**Tech Stack:** Markdown workflow docs, GitHub Actions YAML, POSIX shell, Vitest, TypeScript test files, pnpm scripts.

## Global Constraints

- Make `dev` the single documented integration branch for routine work.
- Keep `main` as the stable release baseline.
- Block direct routine work on both `main` and `dev`.
- Preserve the existing child-synced CI behavior: trigger on `main` and `dev`, and run only child-safe `bemoat:*` scripts.
- Add or update tests so future policy edits cannot drift back to `develop` unnoticed.
- Keep the change limited to workflow rails, docs, and tests.
- Do not create or push the `dev` branch as part of this work.
- Do not change Cloudflare `env.dev` deployment semantics.
- Do not sync into a child project in this change.
- Do not rename local or remote branches automatically.
- Do not touch Payload schema or generated Payload types.

---

## File Structure

- `tests/int/branch-safety.int.spec.ts`: owns executable behavior for `scripts/check-branch-safety.sh`; update expected protected integration branch from `develop` to `dev`.
- `tests/int/boilerplate-sync.int.spec.ts`: owns child-synced CI and hook contract checks; add branch-target assertions for `.github/workflows/ci.yml`.
- `scripts/check-branch-safety.sh`: owns local branch safety enforcement; change protected integration branch from `develop` to `dev` and update all examples.
- `AGENTS.md`: root agent contract inherited by child projects; replace active `develop` workflow language with `dev`.
- `README.md`: starter and child-facing workflow overview; replace active `develop` workflow language with `dev`.
- `docs/workflow/git-flow.md`: canonical Git Flow guardrails; rewrite branch roles, examples, release/hotfix flow, and bootstrap note for `dev`.
- `docs/agent-loop/README.md`: agent loop overview; replace branch gate and branch rows with `dev`.
- `docs/agent-loop/checklist.md`: operational checklist; replace issue and sync branch checklist items with `dev`.
- `docs/agent-loop/composer-issue-workflow-prompt.md`: paste-ready workflow prompt; replace branch commands, stop conditions, and PR target with `dev`.
- `docs/agent-loop/harness-sync-workflow.md`: child harness sync workflow; replace sync branch creation, PR target, and stop conditions with `dev`.
- `docs/agent-loop/issue-driven-branch-workflow.md`: issue branch workflow; replace branch creation, PR target, bootstrap note, and stop conditions with `dev`.
- `docs/agent-loop/migration-draft-pr.md`: migration PR workflow; replace normal draft PR target from `develop` to `dev`.
- `docs/agent-loop/operating-manual.md`: model operating checklist and prompt seed; replace active branch instructions with `dev`.
- `docs/superpowers/specs/2026-06-30-dev-branch-policy-sync-contract-design.md`: leave unchanged; it records the approved design and intentionally mentions rejected `develop` alternatives.
- `.github/workflows/ci.yml`: leave branch targets unchanged unless a test exposes missing `dev`; this file should continue to list `main` and `dev`.

## Task 1: Lock The `dev` Branch Contract In Tests

**Files:**
- Modify: `tests/int/branch-safety.int.spec.ts`
- Modify: `tests/int/boilerplate-sync.int.spec.ts`
- Read: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `runBranchCheck(branch: string, env?: Record<string, string>)` in `tests/int/branch-safety.int.spec.ts`.
- Produces: Vitest assertions that later tasks must satisfy:
  - `dev` exits with status `1` unless `ALLOW_INTEGRATION_BRANCH=1`.
  - unsupported branch guidance points to `dev`.
  - synced CI includes `main` and `dev`, not `develop`.

- [x] **Step 1: Update the branch safety test to expect `dev`**

Replace the two `develop` tests and unsupported-branch guidance expectation in `tests/int/branch-safety.int.spec.ts` with this code:

```ts
  it('blocks routine implementation on dev without an explicit bypass', () => {
    const result = runBranchCheck('dev')

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Current branch: dev')
    expect(result.stderr).toContain('dev is an integration branch')
  })

  it('allows dev only for explicit integration maintenance', () => {
    const result = runBranchCheck('dev', { ALLOW_INTEGRATION_BRANCH: '1' })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('integration maintenance bypass enabled')
  })
```

Then change the unsupported-branch assertion to:

```ts
    expect(result.stderr).toContain('git switch -c chore/67-git-flow-branch-guardrails dev')
```

- [x] **Step 2: Add synced CI branch target assertions**

In `tests/int/boilerplate-sync.int.spec.ts`, inside `describe('synced harness CI and hooks', () => {`, add this test after `uses only child-safe bemoat:* scripts in synced CI workflow`:

```ts
  it('targets main and dev in the synced CI workflow', () => {
    const ciWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')

    expect(ciWorkflow).toContain('branches:\n      - main\n      - dev')
    expect(ciWorkflow).not.toContain('- develop')
  })
```

- [x] **Step 3: Run focused tests and verify the expected failure**

Run:

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/branch-safety.int.spec.ts tests/int/boilerplate-sync.int.spec.ts
```

Expected: FAIL in `tests/int/branch-safety.int.spec.ts` because `scripts/check-branch-safety.sh` still protects `develop` and does not protect `dev`. The synced CI test should pass because `.github/workflows/ci.yml` already targets `main` and `dev`.

- [x] **Step 4: Commit the failing tests**

Run:

```bash
git add tests/int/branch-safety.int.spec.ts tests/int/boilerplate-sync.int.spec.ts
git commit -m "test: lock dev branch workflow contract"
```

Expected: commit succeeds with only the two test files staged.

## Task 2: Align Branch Guard And Active Workflow Docs To `dev`

**Files:**
- Modify: `scripts/check-branch-safety.sh`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/workflow/git-flow.md`
- Modify: `docs/agent-loop/README.md`
- Modify: `docs/agent-loop/checklist.md`
- Modify: `docs/agent-loop/composer-issue-workflow-prompt.md`
- Modify: `docs/agent-loop/harness-sync-workflow.md`
- Modify: `docs/agent-loop/issue-driven-branch-workflow.md`
- Modify: `docs/agent-loop/migration-draft-pr.md`
- Modify: `docs/agent-loop/operating-manual.md`

**Interfaces:**
- Consumes: failing tests from Task 1.
- Produces:
  - `scripts/check-branch-safety.sh` blocks `dev`.
  - Active workflow docs consistently instruct agents to create branches from `dev` and target PRs to `dev`.
  - Historical/spec files may still mention `develop` when describing rejected alternatives or old context.

- [x] **Step 1: Replace the protected integration branch in the shell guard**

In `scripts/check-branch-safety.sh`, replace the whole `case "$branch" in` block with:

```sh
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
```

Also replace the detached-HEAD example near the top with:

```sh
  echo "  git switch -c chore/67-git-flow-branch-guardrails dev" >&2
```

- [x] **Step 2: Rewrite the canonical Git Flow doc**

In `docs/workflow/git-flow.md`, replace active branch-policy references as follows:

```text
`develop` -> `dev`
Sync `develop`. -> Sync `dev`.
develop -> release/2026-07-01 -> main -> develop -> dev -> release/2026-07-01 -> main -> dev
main -> hotfix/67-branch-policy -> main -> develop -> main -> hotfix/67-branch-policy -> main -> dev
Recommended `develop` protections: -> Recommended `dev` protections:
Older repos may not have `develop` yet. Create `develop` once from current `main` -> Older repos may not have `dev` yet. Create `dev` once from current `main`
```

After editing, this command should show no `develop` matches in the active Git Flow doc:

```bash
rg -n 'develop' docs/workflow/git-flow.md
```

Expected: no output.

- [x] **Step 3: Update root agent and README workflow surfaces**

In `AGENTS.md` and `README.md`, replace active workflow language so these exact phrases appear:

```text
do not routine-code on `dev`
create a topic branch from `dev`
Open a pull request targeting `dev`
```

Use these command snippets wherever branch creation examples appear:

```bash
git switch dev
git pull origin dev
git switch -c docs/dev-branch-policy-sync-contract
```

For the README Mermaid node, use:

```text
Create issue branch from dev — never edit main or routine-code on dev
```

- [x] **Step 4: Update active agent-loop workflow docs**

In these files, replace active `develop` workflow instructions with `dev`:

```text
docs/agent-loop/README.md
docs/agent-loop/checklist.md
docs/agent-loop/composer-issue-workflow-prompt.md
docs/agent-loop/harness-sync-workflow.md
docs/agent-loop/issue-driven-branch-workflow.md
docs/agent-loop/migration-draft-pr.md
docs/agent-loop/operating-manual.md
```

Use these exact branch command blocks in workflow instructions that show commands:

```bash
git fetch origin
git switch dev
git pull origin dev
git switch -c docs/dev-branch-policy-sync-contract
```

For harness sync branches, use:

```bash
git fetch origin
git switch dev
git pull origin dev
git switch -c chore/sync-harness-from-starter-73
```

For bootstrap notes, use this wording:

```text
If a repository has not created `dev` yet, follow the bootstrap note in [Git Flow guardrails](../workflow/git-flow.md) and call out the temporary exception in the PR.
```

- [x] **Step 5: Search active workflow surfaces for stale `develop`**

Run:

```bash
rg -n 'develop' AGENTS.md README.md docs/workflow docs/agent-loop scripts/check-branch-safety.sh tests/int/branch-safety.int.spec.ts
```

Expected: no matches in those active workflow surfaces. If matches remain in the approved design spec or historical implementation plans outside this command, leave them unless they are active agent instructions.

- [x] **Step 6: Run focused tests and verify they pass**

Run:

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/branch-safety.int.spec.ts tests/int/boilerplate-sync.int.spec.ts
```

Expected: PASS. `branch-safety.int.spec.ts` should show `dev` protected and bypassable; `boilerplate-sync.int.spec.ts` should show child-synced CI stays on `main` and `dev`.

- [x] **Step 7: Commit the guard and docs alignment**

Run:

```bash
git add scripts/check-branch-safety.sh AGENTS.md README.md docs/workflow/git-flow.md docs/agent-loop/README.md docs/agent-loop/checklist.md docs/agent-loop/composer-issue-workflow-prompt.md docs/agent-loop/harness-sync-workflow.md docs/agent-loop/issue-driven-branch-workflow.md docs/agent-loop/migration-draft-pr.md docs/agent-loop/operating-manual.md
git commit -m "docs: align branch workflow on dev"
```

Expected: commit succeeds with only branch-policy docs and `scripts/check-branch-safety.sh` staged.

## Task 3: Validate Sync Readiness And Prepare The PR

**Files:**
- Read: `.bemoat/boilerplate-sync-manifest.json`
- Read: `scripts/sync-boilerplate.mjs`
- Read: `.github/workflows/ci.yml`
- Read: files changed in Tasks 1 and 2
- Modify: no source files unless validation exposes a concrete missed `develop` reference in an active workflow surface

**Interfaces:**
- Consumes: passing focused tests from Task 2.
- Produces:
  - full validation evidence for PR body and issue report,
  - confirmation that no sync manifest change is needed,
  - confirmation that child sync should be delayed until this PR merges.

- [x] **Step 1: Confirm managed-path lists do not need changes**

Run:

```bash
node -e "import('./scripts/sync-boilerplate.mjs').then(m=>{const fs=require('fs');const manifest=JSON.parse(fs.readFileSync('.bemoat/boilerplate-sync-manifest.json','utf8')); const keys=['managedPaths','seedOnlyPaths','mergeKeepPaths','managedPackageScripts','suggestedPackageScripts','buildContractPackageScripts','buildContractFilePaths','suggestedPackageSections']; for (const k of keys) { const ok=JSON.stringify(manifest[k])===JSON.stringify(m[k]); console.log(k+': '+(ok?'OK':'MISMATCH')); if(!ok) process.exitCode=1; } })"
```

Expected:

```text
managedPaths: OK
seedOnlyPaths: OK
mergeKeepPaths: OK
managedPackageScripts: OK
suggestedPackageScripts: OK
buildContractPackageScripts: OK
buildContractFilePaths: OK
suggestedPackageSections: OK
```

- [x] **Step 2: Run whitespace validation**

Run:

```bash
git diff --check
```

Expected: no output and exit code `0`.

- [x] **Step 3: Run guard safety**

Run:

```bash
pnpm run guard:safety
```

Expected:

```text
Central guard pack passed.
```

- [x] **Step 4: Run full starter check**

Run:

```bash
pnpm run check
```

Expected: PASS for `guard:safety`, `lint`, `typecheck`, and `test:int`.

- [x] **Step 5: Review changed files for scope**

Run:

```bash
git status --short
git diff --stat
```

Expected changed paths are limited to:

```text
AGENTS.md
README.md
docs/agent-loop/README.md
docs/agent-loop/checklist.md
docs/agent-loop/composer-issue-workflow-prompt.md
docs/agent-loop/harness-sync-workflow.md
docs/agent-loop/issue-driven-branch-workflow.md
docs/agent-loop/migration-draft-pr.md
docs/agent-loop/operating-manual.md
docs/workflow/git-flow.md
scripts/check-branch-safety.sh
tests/int/branch-safety.int.spec.ts
tests/int/boilerplate-sync.int.spec.ts
```

The spec and plan commits may already be present on the branch. No `src/**`, `wrangler.jsonc`, `.env*`, `pnpm-lock.yaml`, generated Payload types, migration files, or Cloudflare resource IDs should appear.

- [x] **Step 6: Commit validation fixes if validation required edits**

If Step 1 through Step 5 exposed a missed active workflow reference and the executor changed files, run:

```bash
git add AGENTS.md README.md docs/agent-loop/README.md docs/agent-loop/checklist.md docs/agent-loop/composer-issue-workflow-prompt.md docs/agent-loop/harness-sync-workflow.md docs/agent-loop/issue-driven-branch-workflow.md docs/agent-loop/migration-draft-pr.md docs/agent-loop/operating-manual.md docs/workflow/git-flow.md scripts/check-branch-safety.sh tests/int/branch-safety.int.spec.ts tests/int/boilerplate-sync.int.spec.ts
git commit -m "chore: finish dev branch workflow validation"
```

Expected: commit succeeds only when there were concrete validation edits. If no files changed after validation, skip this commit.

- [x] **Step 7: Push and open or update PR**

Run:

```bash
git push -u origin HEAD
gh pr list --head "$(git branch --show-current)" --state open
```

If no PR exists, create one targeting `main` because `origin/dev` does not exist yet in this starter checkout:

```bash
gh pr create --base main --head "$(git branch --show-current)" --title "[Workflow] Align branch policy on dev" --body-file /tmp/dev-branch-policy-pr-body.md
```

The PR body file must include:

```markdown
## Summary
- Aligns active workflow docs and branch safety from `develop` to `dev`.
- Keeps synced child CI on `main` and `dev`.
- Adds tests that lock the `dev` branch contract.

## Test plan
- `pnpm exec vitest run --config ./vitest.config.mts tests/int/branch-safety.int.spec.ts tests/int/boilerplate-sync.int.spec.ts`
- `git diff --check`
- `pnpm run guard:safety`
- `pnpm run check`

## Risks
- `origin/dev` does not exist yet, so this PR targets `main` as a bootstrap exception.
- Child projects with an existing `develop` branch need a human branch-policy decision before adopting this sync.

## Human review needed
- Confirm `dev` is the intended integration branch.
- After merge, create/protect `dev` where needed before routine work moves there.
- Run a child harness sync only after this PR merges.
```

Expected: PR URL is printed.

- [x] **Step 8: Final sync-readiness note**

Collect the final facts:

```bash
git branch --show-current
git log --oneline main..HEAD
gh pr list --head "$(git branch --show-current)" --state open
```

Report this exact structure to the user, replacing command output lines with the values printed by the commands above:

```text
Branch: output from git branch --show-current
Commits: output from git log --oneline main..HEAD
PR: URL from gh pr list for the current branch
Validation: focused tests, git diff --check, guard:safety, check
Sync readiness: do not sync child projects until this PR merges; after merge run harness-only sync and review harness-only diffs.
```
