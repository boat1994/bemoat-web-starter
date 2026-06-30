# Dev Branch Policy Sync Contract Design

## Summary

Align the Bemoat starter workflow docs, branch safety guard, synced CI contract, and tests around `dev` as the canonical integration branch. The current starter checkout only has `main`, but child-facing policy should consistently describe `dev`, not `develop`, before harness rails are synced into real child projects.

This is a source-of-truth workflow fix. It does not change Payload schema, application code, Cloudflare resource configuration, dependencies, or starter seed files.

## Problem

The June 30 harness audit found a mismatch:

- The child-synced CI workflow already runs on `main` and `dev`.
- The newly added Git Flow docs and branch safety script describe `develop`.
- Child harness sync guidance tells agents to create branches from `develop` and open PRs into `develop`.

If this ships to children as-is, agents may create PRs against `develop` while synced CI only watches `dev`. That creates a quiet validation gap exactly where the harness is supposed to be boring and reliable.

## Goals

- Make `dev` the single documented integration branch for routine work.
- Keep `main` as the stable release baseline.
- Block direct routine work on both `main` and `dev`.
- Preserve the existing child-synced CI behavior: trigger on `main` and `dev`, and run only child-safe `bemoat:*` scripts.
- Add or update tests so future policy edits cannot drift back to `develop` unnoticed.
- Keep the change limited to workflow rails, docs, and tests.

## Non-Goals

- Do not create or push the `dev` branch as part of this spec.
- Do not change Cloudflare `env.dev` deployment semantics.
- Do not sync into a child project in this change.
- Do not rename local or remote branches automatically.
- Do not touch Payload schema or generated Payload types.

## Proposed Approach

Use the narrow alignment approach:

1. Update branch policy docs and prompts to say `dev`.
2. Update `scripts/check-branch-safety.sh` to block `dev` for routine coding, with `ALLOW_INTEGRATION_BRANCH=1` as the controlled bypass.
3. Update branch safety tests to assert `dev` is blocked and bypassable.
4. Add or keep sync-contract coverage showing `.github/workflows/ci.yml` includes `dev` and does not require `develop`.
5. Run focused sync/branch tests, then the full starter check.

This keeps the current CI target intact and changes the new policy surfaces to match it.

## Alternatives Considered

### Support both `dev` and `develop`

This would let older or experimental repositories continue either branch name. It is more forgiving, but it weakens the contract and makes child sync review noisier because both names become valid.

### Migrate everything to `develop`

This would match the first Git Flow draft, but it contradicts the confirmed repo convention and would require changing synced CI plus likely child branch protection. It is larger than needed before syncing children.

## Files Expected To Change

Implementation should focus on:

- `AGENTS.md`
- `README.md`
- `docs/workflow/git-flow.md`
- `docs/agent-loop/README.md`
- `docs/agent-loop/checklist.md`
- `docs/agent-loop/composer-issue-workflow-prompt.md`
- `docs/agent-loop/harness-sync-workflow.md`
- `docs/agent-loop/issue-driven-branch-workflow.md`
- `docs/agent-loop/migration-draft-pr.md`
- `docs/agent-loop/operating-manual.md`
- `scripts/check-branch-safety.sh`
- `tests/int/branch-safety.int.spec.ts`
- `tests/int/boilerplate-sync.int.spec.ts` or another harness contract test covering synced CI branch targets

Other docs may be updated when they directly repeat the branch policy. Avoid unrelated wording churn.

## Data Flow And Boundaries

The branch policy flows from `bemoat-web-starter` to children through managed harness paths:

- `AGENTS.md` and `.agents` tell agents what to do.
- `docs/agent-loop` and `docs/workflow` provide durable workflow rules.
- `.github/workflows/ci.yml` defines child-safe validation on `main` and `dev`.
- `scripts/check-branch-safety.sh` enforces local branch guardrails through optional hooks.
- `tests/int/*` keeps the contract from drifting.

`package.json` remains child-owned except for missing `bemoat:*` script additions. `wrangler.jsonc`, `.env`, D1 IDs, R2 buckets, Worker names, and starter seed files remain outside this change.

## Error Handling

If a repository does not yet have a `dev` branch, docs should instruct maintainers to create it once from the safest current baseline and enable branch protection before routine work moves there. Until then, agents may use a temporary exception from `main` only when the repo has no integration branch, and must call that out in the PR.

Branch safety should fail loudly on direct `main` or `dev` work, explain why, and show a topic branch example from `dev`.

## Testing

Required local validation before PR:

- Focused branch and sync tests:
  - `pnpm exec vitest run --config ./vitest.config.mts tests/int/branch-safety.int.spec.ts tests/int/boilerplate-sync.int.spec.ts`
- Docs/workflow validation tier:
  - `pnpm run guard:safety`
- Full starter check because scripts/tests change:
  - `pnpm run check`

Expected results:

- Branch safety blocks `main`.
- Branch safety blocks `dev` unless `ALLOW_INTEGRATION_BRANCH=1`.
- Supported topic, release, and hotfix branch patterns still pass.
- Synced CI remains child-safe and includes `dev`.
- No sync manifest change is needed unless managed path lists change.

## Rollout

After the implementation PR merges:

1. Confirm `main` contains the corrected `dev` policy.
2. Re-run the harness sync audit.
3. Sync real child projects with `pnpm run boilerplate:sync -- --harness-only`.
4. Review child diffs for harness paths only.
5. Review `.bemoat/package-sync-proposal.md` manually; do not auto-apply dependency or non-namespaced script drift.

## Risks

- Existing docs may still mention `develop` in historical implementation plans or archived notes. Implementation should only update active workflow surfaces unless a stale reference could mislead an agent.
- The current starter remote does not yet expose `dev`; implementation may need to call out the bootstrap exception if opening a PR before `dev` exists.
- Child projects with an existing `develop` branch will need a human branch-policy decision before adopting this harness update.
