# Mission Control command reference

This is the canonical usage contract for the repository-owned Mission Control
transports. The scripts read GitHub live at execution time; live GitHub evidence
overrides chat, copied handoffs, local notes, or stale values.

## Command selection

| Command | Usage |
| --- | --- |
| `dispatch` | Start work on a Task Issue, claim `IN_PROGRESS` only. Dispatch does not own `AWAITING_REVIEW_1` transitions. |
| `delivery` | Owns the transition of a successful implementation to `AWAITING_REVIEW_1`. (Note: Delivery is a workflow boundary, not a standalone CLI script in this reference). |
| `review` | Submit a Full Review 1 or Delta Review verdict, update counters and target states. |
| `reconcile` | Repair state routing mismatch. Requires an existing valid managed-state block. Cannot initialize state, replay reviews, post verdicts, or increment counters. |
| `merge` | Finalize Founder-authorized merge. Uses the live PR head and an existing Founder JSON authorization comment. |
| (none) | Stop and request human review if evidence disagrees, authentication fails, or preconditions mismatch. Never mutate state YAML directly. |

## Preflight checklist

Before invoking a command, manually verify these specific values to avoid `STATE_CONFLICT` or `BLOCKED_EXTERNAL`.

### Shared checks (all commands)
- [ ] Active repository matches command target.
- [ ] Active Task Issue has a valid managed state block.
- [ ] The command's expected state matches the live Issue state.
- [ ] There are no competing superseding comments blocking this transition.

### Dispatch checks
- [ ] Read Task Issue state without requiring an existing PR or CI.
- [ ] The provided body/file matches exactly the required structural format (e.g., `## HANDOFF`).

### Review checks
- [ ] Target PR is open and bound to the Task Issue.
- [ ] Approved base branch strictly matches the PR base branch.
- [ ] Live PR `headRefOid` is exactly 40 characters and fully synced.
- [ ] Exact-head CI is fully completed and successful. CI present but pending or failed is invalid. Missing CI reads classify as `BLOCKED_EXTERNAL`.
- [ ] The provided body/file matches exactly the structural format of `## REVIEW_VERDICT`.

### Reconcile checks
- [ ] Requires an existing valid managed state.
- [ ] Requires matching evidence (active PR, exact head, existing `REVIEW_VERDICT` comments).

### Merge checks
- [ ] Requires an immutable Founder merge authority JSON comment.
- [ ] Requires the authorized reviewed head to match the live PR head.
- [ ] Exact-head CI is fully completed and successful.

## Evidence vocabulary

Keep these values distinct in every handoff and invocation:

| Value | Meaning and authoritative source |
| --- | --- |
| Task Issue | The directly managed Issue passed as the command's positional `<issue-number>`; read its live state block and body with `gh issue view <n>`. |
| Parent/campaign Issue | A campaign Issue referenced by the live Founder authorization and its projection binding; it is not the Task Issue and is not a substitute positional argument. |
| PR number | The active PR bound by the Task Issue state and verified with live `gh pr view`; it is not the Issue number. |
| Base branch | The live PR target branch (`baseRefName`), which must match the approved base in the Task Issue state. |
| Protected-base SHA | The live commit SHA of the protected base branch (`baseRefOid` / current protected ref), used for ancestry and exact-base checks; do not copy an older approved SHA from chat. |
| Exact PR head SHA | The live PR `headRefOid` at the moment of the command. Must be the complete 40-character SHA. CI and every review/merge authorization must match this exact SHA. |
| Role comment ID | The immutable GitHub Issue comment ID returned by the live API: HANDOFF for dispatch, active `REVIEW_VERDICT` for reconcile/merge, and Founder authorization for merge. |
| Verdict body / verdict file | The complete `## REVIEW_VERDICT` body supplied by `--body-file` to review, or the live role comment body selected by reconcile/merge. A file path is only transport. New verdicts must contain canonical PR/base/head/verdict evidence. Reconcile may accept only the explicitly documented bounded historical legacy `**Task:**` / `**PR:**` / `**Base:**` / `**Head:**` shape when that complete unique binding is present and the canonical line is absent. Merge transport collects every recognized PR/base/head source before selection and fails closed on duplicate fields, conflicting values, partial historical pairs, multiline, short-SHA, or malformed evidence. Recognized merge sources are one canonical `**PR / base / head:**` line (`/pull/N` or `PR #N`), `/pull/N` URL form, one historical `**PR:** PR #N`, one `**Exact head reviewed:**` and/or one `**Exact reviewed head:**`, and one `**Approved base:**`. A complete unique semantically identical binding across those permitted source forms is accepted only when each form appears at most once and all recognized values agree; first-match preference is prohibited. |

Do not infer any supplied value from a chat transcript. Re-read the Task Issue,
campaign authorization, PR, comments, protected base, and exact head live before
running a transport.

Examples of accepted bodies:
- [HANDOFF](handoff-template.md)
- `REVIEW_VERDICT`: Use a minimal structurally complete canonical template containing all required role-comment fields. Do not describe `result-template.md` as a complete accepted body unless it actually contains all required role-comment fields.

Example canonical `REVIEW_VERDICT` body (all values are fake):

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `2026-08-01T12:00:00+00:00`
- Task / Issue: #9999
- Phase: Reviewer
- Executing role: Reviewer

**PR / base / head:** https://github.com/fake/repo/pull/9999 · `main` · `1111111111111111111111111111111111111111`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder review
```

## Dispatch

Exact syntax:

```text
pnpm run bemoat:mission-control:dispatch -- <issue-number> [--repo <owner>/<repo>] [--body-file <handoff-file>] [--founder-correction] [--workflow-mode <mode>] [--planning-base-sha <commit-sha>]
```

Positional arguments and flags:

- `<issue-number>` is the positive Task Issue number.
- `--repo` is optional `owner/repo`; otherwise the current `gh` repository is used.
- `--body-file` supplies the complete `## HANDOFF`. Without it, dispatch reads stdin.
- `--founder-correction` selects the Founder-authorized correction path. Valid only when the live state is `FOUNDER_AUTHORIZED_CORRECTION`.
- `--workflow-mode` optionally records the mode in the managed state. Values must come from authoritative live authorization or plan evidence. Do not supply invented values.
- `--planning-base-sha` optionally supplies the planning authorization base SHA. Must come from authoritative evidence.

Preconditions and sources: the live Task Issue must have valid managed state.
Normal dispatch must be in a dispatchable state and must post one valid HANDOFF,
then verify the live state is `IN_PROGRESS` and bound to the returned comment ID.
Founder correction additionally requires live `FOUNDER_AUTHORIZED_CORRECTION`
state, unconsumed authorization, and a HANDOFF containing the live authorization
identity. The base SHA and mode come from the live authorization/plan evidence,
not an invented value.

Fetch Task Issue values: `gh issue view 123 --json body,state`

Structurally valid fake example:

```text
pnpm run bemoat:mission-control:dispatch -- 123 --repo user/repo --body-file payload-handoff.md --workflow-mode planning_no_pr --planning-base-sha 5555555555555555555555555555555555555555
```

Invalid inputs fail closed as `STATE_CONFLICT` for missing/invalid state,
duplicate or malformed positional arguments, or a mismatched authorization;
unavailable GitHub/comment/ref operations classify as `BLOCKED_EXTERNAL`.
Never replace dispatch with a direct `gh issue edit`, manual YAML edit, or ad hoc
transition script.

## Reconcile

Exact syntax:

```text
pnpm run bemoat:mission-control:reconcile -- <issue-number> [--repo <owner>/<repo>]
```

Positional arguments and flags:

- `<issue-number>` is the positive Task Issue number.
- `--repo` is optional `owner/repo`; otherwise the current `gh` repository is used.

Preconditions and sources: the live Task Issue must contain a valid managed
state block. Reconcile cannot create or initialize a managed task. Reconcile does not post or replay role comments and does not increment review counters.
For an eligible review state, reconcile selects exactly one active live
`REVIEW_VERDICT` for that Task Issue whose bound PR matches the managed
`active_pr` / live PR (historical transport reviews for a different PR remain
preserved but non-competing), then requires its PR number, base branch,
and exact head to match the live PR and state. New verdicts must use the
canonical `**PR / base / head:**` field. The only exception is the explicitly
documented bounded historical legacy shape: single-line
`**Task:**` / `**PR:**` / `**Base:**` / `**Head:**` fields with a full 40-character
head SHA when the canonical line is entirely absent. Incidental prose, bare
`PR #N`, pull URLs, multiline field values, or incomplete/duplicated/ambiguous
legacy fields fail closed and must not be treated as different-PR historical
authority. Same-PR competing active verdicts remain `STATE_CONFLICT`. For other
states it evaluates live Issue, PR, comment, campaign, and protected-base
evidence before proposing an allowed deterministic repair. Valid NO_OP behavior
means the state is already completely aligned. Routing-only repair behavior
repairs routing lineage while preserving domain state, review cycle, counters,
PR/head bindings, RESULT lineage, and verdict. It cannot bootstrap a missing
managed-state block.

Fetch active review verdicts: `gh issue view 123 --json comments`

Structurally valid fake example:

```text
pnpm run bemoat:mission-control:reconcile -- 123 --repo user/repo
```

Reconcile is bookkeeping repair only: it does not replay Review, post a new
`REVIEW_VERDICT`, or increment review counters. Missing evidence or unavailable
GitHub reads fail closed as `BLOCKED_EXTERNAL`; competing, stale, malformed, or
mismatched Issue/PR/base/head/comment evidence fails as `STATE_CONFLICT`.
Never replace reconcile with direct `gh issue edit`, manual YAML, or an ad hoc
transition script.

## Review

Exact syntax:

```text
pnpm run bemoat:mission-control:review -- <issue-number> --body-file <verdict-file> --expected-state <state> --review-type <full|delta> --expected-head <exact-pr-head-sha> [--repo <owner>/<repo>]
```

Positional arguments and flags:

- `<issue-number>` is the positive Task Issue number.
- `--body-file` is the complete verdict body/file; it must be a valid `## REVIEW_VERDICT`.
- `--expected-state` is the live managed-state value expected before the review write. Obtain this by running `gh issue view <n>` and inspecting the YAML block.
- `--review-type` is exactly `full` or `delta`. `full` maps to a normal Full Review 1 cycle (requiring the initial review-cycle state). `delta` maps to a bounded Delta Review (requiring an existing review cycle).
- `--expected-head` is the exact live PR head SHA being reviewed. Must be a complete 40-character live `headRefOid`.
- `--repo` is optional `owner/repo`.

Preconditions and sources: read the live Task Issue state, active PR, base
branch, exact head, and CI before creating the verdict file. The verdict body
must itself identify the live PR, base, exact head, and Core verdict enum; the file path is only transport, not the verdict evidence itself. `full` requires the initial review-cycle state;
`delta` requires an existing review cycle. The command posts the role comment,
then performs CAS/readback verification against the live Issue and PR.

Fetch PR head: `gh pr view 456 --json headRefOid`

Structurally valid fake example:

```text
pnpm run bemoat:mission-control:review -- 123 --body-file .tmp/verdict.md --expected-state AWAITING_REVIEW_1 --review-type full --expected-head 8888888888888888888888888888888888888888 --repo user/repo
```

Missing required flags, a malformed verdict, stale state, wrong review type,
or any PR/base/head mismatch fails closed as `STATE_CONFLICT`. Unavailable
GitHub or CI evidence is `BLOCKED_EXTERNAL`. Note that GitHub evidence that cannot be read is `BLOCKED_EXTERNAL`, while CI that is present but not verified is treated as a runtime validation failure (e.g., `STATE_CONFLICT` during review). Exact-head CI must match the
current PR head, not merely an earlier reviewed commit. Do not use a manually
edited Issue body, direct `gh issue edit`, manual YAML, or an ad hoc verdict
script as a substitute.

## Merge

Exact syntax:

```text
pnpm run bemoat:mission-control:merge -- <issue-number> --repo <owner>/<repo> --authorization-comment <role-comment-id>
```

Positional arguments and flags:

- `<issue-number>` is the positive Task Issue number.
- `--repo` is required and identifies the repository.
- `--authorization-comment` is the immutable live Founder authorization comment ID. Distinguish this ID from the `REVIEW_VERDICT` ID.

Preconditions and sources: read the live Task Issue state, active PR, approved
base branch, protected-base SHA, exact PR head, active review-verdict comment,
Founder authorization body, and exact-head CI. The authorization comment body must
be exactly one raw JSON object; Markdown fences, prose wrappers, strings, and arrays are prohibited. The authorization comment must
bind the Task Issue, PR number, approved base, exact reviewed head, review
verdict comment ID, policy source, and merge scope (e.g., `bundle_kind`, `scope`, `action`). The parent/campaign Issue
and any blocker/slice binding come only from that live authorization. The active
`REVIEW_VERDICT` must resolve a unique PR/base/exact-head binding by collecting
every recognized source before selection: one canonical `**PR / base / head:**`
line (`/pull/N` or `PR #N`), `/pull/N` plus `**Exact head reviewed:**`, and/or the
bounded historical merge fields `**PR:** PR #N` and `**Exact reviewed head:**` /
existing `**Exact head reviewed:**`, with `**Approved base:**` when present.
Agreeing unique cross-source forms are accepted; conflicting, duplicate, partial,
multiline, short-SHA, or malformed evidence fails closed. The PR must be
open/mergeable (or already verifiably
merged), and the authorized head must be passed to GitHub's exact-head merge
operation.

Fetch comment IDs: `gh issue view 123 --json comments`

Structurally valid fake example:

```text
pnpm run bemoat:mission-control:merge -- 123 --repo user/repo --authorization-comment 10000000000
```

Missing authorization, wrong role-comment ID, stale verdict, wrong Task Issue,
PR, base, protected-base ancestry, or exact head fails closed as
`STATE_CONFLICT`; unavailable live GitHub, CI, or protected-base evidence is
`BLOCKED_EXTERNAL`. Merge is Founder-authorized transport, not a review or
reconcile shortcut. Direct `gh issue edit`, manual YAML, and ad hoc merge or
transition scripts are prohibited substitutes.

## Partial failure and retry behavior

| Outcome | Meaning and retry handling |
| --- | --- |
| success | The operation completed fully and state was advanced. No retry needed. |
| NO_OP | The state is already correctly aligned with live evidence. No retry needed. |
| RECOVERABLE_ROUTING_DRIFT | The `REVIEW_VERDICT` comment was posted but state projection failed. Rerun the same canonical review command. Do not post another verdict manually. Do not edit Issue YAML. |
| STATE_CONFLICT | State, PR, or comment evidence disagreed. Stop, refresh live context, and require live evidence reconstruction and the approved canonical reconcile/correction path. Require Founder decision when no canonical repair path exists. Preserve the prohibition on direct `gh issue edit`, manual YAML, and ad hoc transition scripts. |
| BLOCKED_EXTERNAL | A GitHub or CI API read failed. Can safely retry after verifying external availability. |
| AUTHORIZATION_VALIDATION_FAILURE | Do not edit the immutable authorization comment. Stop merge. Require a new Founder-authored immutable authorization record when the prior record is malformed or mismatched. Record supersession where required. |

## Shared stop rule

If live GitHub evidence disagrees with chat or a copied value, stop and classify
the discrepancy fail closed. Never repair the discrepancy by editing managed
Issue YAML directly. Re-read live evidence and use the one canonical transport
whose preconditions match; otherwise stop for `STATE_CONFLICT` or
`BLOCKED_EXTERNAL`.

## Genesis managed-Task bootstrap

The starter's one-time genesis transport is an ordinary, human-reviewed
workflow. It is not a normal agent Issue-creation API and it does not create a
Task for an Issue or PR supplied by the caller.

The only supported interface is:

```bash
gh workflow run mission-control-task-bootstrap.yml \
  --repo boat1994/bemoat-web-starter \
  --ref main \
  -f founder_authorization_comment_id=<comment-id>
```

The workflow loads its implementation from protected `main`, serializes the
repository-wide creation operation with `cancel-in-progress: false`, and waits
for required Founder approval on the protected `mission-control-task-creation`
environment. The workflow grants `issues: write`; contents, pull requests,
checks, Actions evidence, statuses, metadata, and the policy source are read
only.

The caller cannot supply a PR number, head, base, Issue body, managed state,
policy identity, or Task number. The trusted operation derives the genesis
tuple from the immutable Founder authorization and live GitHub evidence:
Issue #262, Draft/Open PR #263, `main`, the approved exact head, protected base,
merged guide version/blob, and exact-head CI.

## Recovery and verification

Every request has a deterministic identity derived from the repository,
authorization comment ID and exact body hash, parent, PR/head/base, protected
base, and policy tuple. A provisional Issue records only that identity and is
not a managed Task. The same request recovers that exact Issue after an API,
registry, projection, or readback failure; it never rebinds an existing Task
or guesses an allocated Issue number.

The final Issue contains the exact initial `AWAITING_REVIEW_1` state with
`review_cycle: 0` and `full_review_count: 0`, a canonical Ed25519 attestation,
and a signed parent ownership-registry record. The payload binds repository and
GitHub identities, Founder authority and body hash, parent/Task/PR identities,
base/head, protected base, policy source/version/commit/blob, deterministic
request ID, workflow file/ref/SHA/run ID, signing-key ID, schema, and operation
version. Readers verify the public key, signature, canonical serialization,
registry, state projection, live PR/head/base/policy, and exact-head CI before
accepting the Task.

CAS/lease conflicts, ambiguous API outcomes, changed authority/head/base,
missing or failed CI, copied attestations, direct body edits, wrong keys, and
failed readback are fail-closed. A successful result is emitted only after the
durable Issue, registry, and canonical managed-task preflight all verify.

## Credential ownership and child repositories

The private Ed25519 key is an environment secret available only to the
protected workflow step. The committed public key is verification material,
not an Issue-write credential. Ordinary repository agents receive neither the
private key nor a workflow-approval capability.

Child repositories do not inherit the starter's private key or Founder
environment. Their canonical readers fail closed when their own committed
public key and protected signing configuration are absent or mismatched. A
child must not reuse the starter key; child-specific key provisioning and
environment protection are separate human-owned configuration.

Rollback is operational rather than destructive: stop the workflow, preserve
the provisional Issue and registry evidence, and diagnose or retry the same
request. Do not delete, close, edit, or rebind an allocated Task as a rollback
shortcut.
