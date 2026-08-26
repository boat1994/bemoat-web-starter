<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-430"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#430"
branch_template: "fix/430-protected-main-target-worktree"
transition_target: "FOUNDER_GATE"
planning_base_sha: "153973a591eb9672ddc201dcd21f9d9e8bbddce8"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: null
paired_plan: null
```
<!-- bemoat-task-identity:end -->

# Protected-Main Stale-Branch Bootstrap Design

Issue: [#430](https://github.com/boat1994/bemoat-web-starter/issues/430)

## Purpose

Allow the registered `bemoat:context:sync-base` implementation from the exact
current protected-main checkout to synchronize one explicitly identified stale
PR worktree whose branch predates the command. The extension closes only the
command-availability gap exposed by Issue #410 / PR #420. It does not weaken or
replace any existing stale-base eligibility check.

## Approved boundary

The public command accepts an optional absolute target path:

```bash
pnpm --dir <protected-main-worktree> run bemoat:context:sync-base -- \
  <issue-number> --target-worktree <absolute-path> --json
```

When `--target-worktree` is omitted, the command retains its current
same-worktree behavior. When it is present, the command implementation and
contract come from the invocation checkout, while all target Issue/PR/local Git
evidence and synchronization operations use the explicitly selected target
worktree.

The command does not create or remove worktrees. Preparing an exact
protected-main checkout is an external native Git setup step, not a new Bemoat
workflow or persistence mechanism.

## Source-command identity

Bootstrap mode has two independently verified roots:

1. **Command source root** — the checkout containing the registered command
   being executed.
2. **Target worktree root** — the absolute path supplied by the caller.

Before authorizing bootstrap mode, the command must prove that the source root:

- is a Git worktree for the same canonical GitHub repository as the target;
- has canonical `origin` identity;
- is clean;
- has an exact full `HEAD` SHA;
- and has `HEAD` equal to the live protected-main SHA used by context evidence.

The source root may be a detached linked worktree at that exact SHA. Source
attachment or upstream durability is not required because the source is not a
mutation target; exact protected-main identity, cleanliness, and canonical
repository identity are required.

Immediately before the first target mutation, the command re-reads the source
root's cleanliness, `HEAD`, and canonical repository identity and requires them
to remain exact.

## Target-worktree identity

The CLI accepts `--target-worktree` exactly once. Its value must be an absolute
path. The command resolves it through the filesystem to a canonical real path
before collecting evidence. A missing path, non-directory, failed
canonicalization, or target that resolves to the command source root fails
closed before synchronization.

The target must independently satisfy every existing local durability rule:

- attached to the active PR branch;
- exact local `HEAD` equals the live PR head;
- upstream is exactly `origin/<PR branch>`;
- canonical `origin` repository matches live GitHub evidence;
- clean, pushed, and durable;
- same Issue, PR, protected branch, recorded old base, current protected-main
  SHA, and approved scope.

Supplying a path is never evidence of identity or authority. It only selects
where the existing evidence collectors and Git operations run.

## Authorization and mutation flow

Bootstrap mode follows this sequence:

1. Parse and canonicalize the explicit target path without mutation.
2. Collect current protected-main, policy, Issue, PR, checks/reviews, and target
   local Git evidence using the target worktree as `cwd`.
3. Verify source-command identity against the live protected-main SHA and the
   target repository identity.
4. Run the unchanged stale-base authorization rules. Staleness must remain the
   sole evidence error, and the pre-movement route must otherwise permit
   continuation.
5. Run the existing target status, branch, head, remote, ancestry, and
   `merge-tree` conflict preflight.
6. Immediately revalidate both source-command identity and target protected
   base / PR head / local state.
7. Perform the existing one merge and push against the target worktree.
8. Require the existing clean-state and remote exact-head readback.
9. Return `SUCCESS` with fresh `bemoat:context` as the deterministic next
   command; exact-head CI and semantic review are stale.

No source or target gate may be inferred from chat, model identity, prior
Mission Control state, or the caller-provided path.

## Fail-closed behavior

Before target mutation, any invalid invocation, non-absolute or unresolvable
path, wrong source SHA/repository, dirty source, wrong target repository,
non-durable target, evidence conflict, ancestry failure, merge conflict, or
head/base drift returns a canonical `STOP` classification with
`mutation_performed: false`.

After a target mutation may have occurred, uncertain merge, push, status, or
remote readback remains `AMBIGUOUS_RESULT` with `mutation_performed: true`.
There is no blind retry.

The command must not copy files, modify the source checkout, create/remove a
worktree, edit Issue or PR metadata, merge the PR, or operate on a target other
than the canonicalized explicit worktree.

## Public contract changes

The registered Tier-A contract and JSON help add:

- optional caller input: `--target-worktree <absolute-path>`;
- read evidence: source checkout Git identity plus target-worktree Git evidence;
- a required bootstrap-mode source/target binding;
- stop conditions for invalid source identity and invalid target selection;
- an example that runs the protected-main package against an explicit stale PR
  worktree.

The existing positional Issue number, `--json`, result classifications, retry
contract, same-worktree example, and post-success route remain intact.

## Story-first verification

The first production-facing change is preceded by a failing public-boundary
story representing the real missing lifecycle transition:

> An exact protected-main command checkout invokes the registered command with
> an explicit clean stale PR target that predates the command; evidence is
> collected from the target, and the existing synchronization succeeds only
> after both roots pass their gates.

Bounded neighboring stories cover:

- unchanged same-worktree behavior without the flag;
- duplicate, relative, missing, non-directory, and aliased target paths;
- target resolving to the source root;
- source not at live protected main, dirty source, or noncanonical source;
- source and target repository mismatch;
- dirty, detached, unpushed, wrong-branch, or wrong-head target;
- protected-main or PR-head drift before mutation;
- old-base ancestry failures and merge-tree conflict;
- push/readback ambiguity after mutation;
- public help and registry/runtime agreement;
- no worktree, file-copy, Issue, or PR metadata mutation.

Focused tests are followed by `pnpm run check`, `git diff --check`, exact-head
GitHub `ci` and `starter-ci`, and independent Luna Medium semantic review.

## Delivery and resumption

The correction is implemented on Issue #430's independent topic branch and PR.
PR #420 remains unchanged throughout development, validation, review, and
Founder decision. After Founder manually merges the correction, a fresh agent
must reconstruct protected main and Issue #410. Only then may the registered
protected-main command be invoked against PR #420's explicit worktree.

## Decision ledger

| Decision | Status | Reason | Reopen only if |
| --- | --- | --- | --- |
| Use an explicit absolute `--target-worktree` flag | Closed | Discoverable caller input; no hidden environment authority | New evidence proves the public CLI cannot safely carry a path |
| Keep source and target identities independent | Closed | The target predates the command and neither root may imply the other | Native Git cannot establish one of the required identities |
| Require exact live protected-main source SHA | Closed | Prevents stale or modified command implementations from mutating a target | A stronger native immutable command-distribution mechanism is adopted |
| Preserve same-worktree behavior | Closed | The correction must not regress already-supported invocations | Existing behavior is independently proven unsafe |
| Do not create/remove worktrees in the command | Closed | Keeps setup outside the mutation rail and avoids lifecycle state | Founder explicitly authorizes a separate bounded worktree lifecycle contract |
| Keep PR #420 untouched until this PR is merged | Closed | Prevents bypassing the rail being corrected | Issue #430 is terminally merged and fresh reconstruction authorizes resumption |
