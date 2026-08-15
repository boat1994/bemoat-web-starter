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
| `recover-review` | Exceptional, exact-incident transport for the approved #274/#275 raw-review quarantine; it is not ordinary review. |
| `rebind-review-lineage` | Exceptional, exact-tuple transport that rebinds already-proven Review 1 provenance into canonical `**PR / base / head:**` form. It is not a new semantic review. |
| `reconcile` | Repair state routing mismatch. Requires an existing valid managed-state block. Cannot initialize state, replay reviews, post verdicts, or increment counters. |
| `reopen` | Project Founder-authorized PR head drift to `FOUNDER_AUTHORIZED_CORRECTION`. |
| `adopt-finding` | Append exactly one Founder-authorized finding to the active correction contract while preserving `CORRECTION_REQUIRED_1\|2` and review counters. |
| `recover-state` | Exceptional recovery for one completely absent managed-state block when immutable evidence uniquely reconstructs the prior canonical state. It cannot repair malformed state, replay review, or invoke finding adoption. |
| `merge` | Finalize Founder-authorized merge. Uses the live PR head and an existing Founder JSON authorization comment. |
| (none) | Stop and request human review if evidence disagrees, authentication fails, or preconditions mismatch. Never mutate state YAML directly. |

## Preflight checklist

Before invoking a command, manually verify these specific values to avoid `STATE_CONFLICT` or `BLOCKED_EXTERNAL`.
Consult the machine-readable `scripts/mission-control/transport-registry.mjs`
before any durable write. It is the ownership map: ordinary
`REVIEW_VERDICT` publication belongs only to `review`; `recover-review` is an
exceptional quarantine/projector for its pinned incident and cannot be used as
a generic comment-repair API. `rebind-review-lineage` is a separate exceptional
lineage-transport quarantine for registered legacy REVIEW_VERDICT bindings; it
cannot broaden recover-review and cannot perform a new semantic review.

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

## Review recovery

Exact syntax:

```text
pnpm run bemoat:mission-control:recover-review -- 274 \
  --repo boat1994/bemoat-web-starter \
  --expected-pr 275 --expected-base main \
  --expected-state AWAITING_REVIEW_2 \
  --expected-head <full-40-character-sha> \
  --expected-review-cycle 1 --expected-full-review-count 1 \
  --review-type delta \
  --issue-source-comment 5187836238 \
  --pr-source-comment 5187837555 \
  --original-review-comment <immutable-comment-id> \
  --correction-result-comment <immutable-comment-id> \
  --body-file <canonical-recovery-verdict.md>
```

This command is restricted to the approved Issue #274 / PR #275 incident. It
re-reads the live Task state, PR/base/head, protected base, merged policy,
exact-head `CI` and `CI (starter strict)`, source-comment locations and hashes,
reviewer identity, original finding contract, correction RESULT evidence, and
later role evidence. The two raw source comments remain unchanged.

### Recovery identity contract

The recovery receipt carries three distinct identities:

- `incident_base_sha` is the historical incident binding: PR #275
  `baseRefOid`, preserved as immutable managed-state/incident lineage. It is
  history only and is **not** the current policy source.
- `execution_policy_sha` is the live protected `main` tip used for this
  trusted recovery transport and for canonical Mission Control policy/guide
  loading. It is included in the typed receipt and transition identity, and
  must be re-read and verified immediately before any mutation.
- `policy_source_sha` remains the separate merged-guide content/blob identity.
  It does not replace either base commit, and a content/blob SHA must not be
  treated as the policy execution ref.

`incident_base_sha` and `execution_policy_sha` are independent bindings.
`incident_base_sha === execution_policy_sha` is neither required nor a
validation condition. Policy is loaded from `execution_policy_sha` only—not
from the historical incident base and not from a moving `main` ref after the
execution SHA has been established.

The body must contain exactly one v2 typed recovery receipt marker pair. Its
canonical serialized record includes both base bindings and
`policy_source_sha`; changing either base changes the transition identity. A
legacy v1 receipt or record with the ambiguous single field
`protected_base_sha` is rejected fail-closed rather than silently
reinterpreted.

The body must contain one canonical `REVIEW_VERDICT` plus exactly one typed
recovery receipt. Recovery consumes the exact `AWAITING_REVIEW_2` `1/1`
pre-state and projects `ELIGIBLE_FOR_FOUNDER_REVIEW`; resulting counters `2/1`, preserving
the original Review 1 and correction RESULT lineage. It posts only to the
Task Issue, uses the repository-wide fenced lease and expected-body CAS, and
returns `NO_OP` for an identical retry. An uncertain comment POST is resumed
by matching the same typed receipt; it never creates a duplicate.

Before recovery, review, reconcile, and merge fail closed with
`NONCANONICAL_ROLE_EVIDENCE` while relevant raw evidence is unaccounted for.
After recovery, only the matching receipt's exact source IDs and hashes are
quarantined. Any later, competing, or malformed role evidence remains a
stop condition. This is the exceptional #274/#275 incident-class transport
only; it is not a generic recovery API or arbitrary comment-repair transport.
Do not run it during implementation of another task or against live historical
artifacts in the hotfix setup.

## Review lineage rebind

Exact syntax:

```text
pnpm run bemoat:mission-control:rebind-review-lineage -- 259 \
  --repo boat1994/bemoat-web-starter \
  --expected-pr 260 --expected-base main \
  --expected-state ELIGIBLE_FOR_FOUNDER_REVIEW \
  --expected-head <full-40-character-sha> \
  --expected-review-cycle 1 --expected-full-review-count 1 \
  --source-comment 5163387315 \
  --authorization-comment <immutable-comment-id> \
  --body-file <canonical-review-verdict.md>
```

This command is quarantined to the registered Issue #259 / PR #260 legacy
`REVIEW_VERDICT` lineage. The only registered source comment is `5163387315`,
and the registered exact head is
`b1ce5f58e7ffd0178d955ef7e93395209a7c4d28`. Any other repository, Issue, PR,
base, head, source comment, or counter tuple fails closed.

It preserves already-proven Review 1 semantic provenance and rewrites only the
transport into canonical `**PR / base / head:**` form. It does not perform a
new semantic review, does not increment or reset `review_cycle` /
`full_review_count`, and does not broaden `recover-review`.

The Founder authorization comment must be one raw JSON object bound to that
exact tuple with `bundle_kind: review-lineage-rebind` and
`scope: transport-correction-only`. Missing or unbound Founder authorization
fails closed.

Mutation order is post canonical `REVIEW_VERDICT` → demote the source comment
in-body → CAS-update only `latest_review_verdict_comment_id` and
`latest_transition_identity`. Identical completed retries return
`NO_OP_IDENTICAL_RETRY`. Partial or competing undemoted verdicts fail closed
as `AMBIGUOUS_RESULT`. Exact live readback must prove one authoritative
canonical `REVIEW_VERDICT`.

Retirement: this command retires after required legacy lineage migrations complete.
After the registered #259/#260 case is migrated, remove the command rather than
broadening it. Do not treat it as generic comment repair.

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

## Adopt finding

Exact syntax:

```text
pnpm run bemoat:mission-control:adopt-finding -- <issue-number> --repo <owner>/<repo> --expected-pr <number> --expected-base <branch> --expected-base-sha <full-sha> --expected-state <CORRECTION_REQUIRED_1|CORRECTION_REQUIRED_2> --expected-reviewed-head <full-sha> --expected-adoption-head <full-sha> --predecessor-comment <id> --authorization-comment <id> [--check] [--json]
```

Positional arguments and flags:

- `<issue-number>` is the positive Task Issue number.
- `--repo` is required `owner/repo`.
- `--expected-pr` is the exact active Pull Request number.
- `--expected-base` / `--expected-base-sha` bind the protected base name and SHA.
- `--expected-state` must be `CORRECTION_REQUIRED_1` or `CORRECTION_REQUIRED_2`.
- `--expected-reviewed-head` is the predecessor reviewed head preserved by adoption.
- `--expected-adoption-head` is the live adoption head bound by Founder authorization.
- `--predecessor-comment` is the immutable predecessor correction-contract comment ID.
- `--authorization-comment` is the immutable Founder authorization comment ID.
- `--check` validates without mutating managed state.
- Finding ID, canonical summary, scope, and evidence requirements are trusted-derived from the Founder authorization and must never be caller-supplied.

Preconditions and sources: authenticate one Founder adopt-finding authorization,
verify the predecessor contract findings remain unchanged, append exactly one
authorized finding into a new active correction-contract identity, and CAS-update
only that identity. Leave the original `REVIEW_VERDICT`, review counters, and
`CORRECTION_REQUIRED_*` state unchanged.

Structurally valid fake example:

```text
pnpm run bemoat:mission-control:adopt-finding -- 276 --repo boat1994/bemoat-web-starter --expected-pr 292 --expected-base main --expected-base-sha 7cf51129144a355172a32d57a73b5fda9eae5504 --expected-state CORRECTION_REQUIRED_1 --expected-reviewed-head 24497c9891b03e4042ac34770a1dfd3b225be1e1 --expected-adoption-head 917f879bea53ced5bc9622bd28f46d45046973c4 --predecessor-comment 5213944977 --authorization-comment 5215031090 --check --json
```

Success routes exclusively to:

```text
pnpm run bemoat:agent:issue -- 276 --phase correction
```

## Missing managed-state recovery

Exact syntax:

```text
pnpm run bemoat:mission-control:recover-state -- <issue-number> --repo <owner>/<repo> --expected-pr <number> --expected-base <branch> --expected-base-sha <full-sha> --expected-head <full-sha> --expected-branch <branch> --predecessor-comment <id> --adoption-authorization-comment <id> --implementation-result-comment <id> --implementation-review-comment <id> --recovery-authorization-comment <id> --lineage-correction-authorization-comment <id> --correction-result-comment <id> --correction-review-comment <id> [--check]
```

The command accepts only a wholly absent canonical managed-state marker pair.
It derives the state, review counters, active PR/head, last reviewed head,
finding set, policy identity, and authority-bearing fields from the live PR,
protected `main`, and the selected immutable predecessor, Founder
authorization, historical adopt-finding RESULT/review, original recovery
authorization, current recovery RESULT/review, and lineage-correction
authorization comments. The historical adopt-finding head remains the exact
 head bound by its original evidence. The recovery authorization-bound head,
recovery implementation anchor head, correction-reviewed head, and live PR exact
head are separate roles. The recovery anchor is independently bound by its
RESULT/review and lineage authorization; the correction-reviewed head is bound
by the explicit correction RESULT/review selectors and must equal the live PR
exact head. Required ancestry relationships are proven by trusted Git evidence.
No resulting state, counter, head, finding, or authority lineage is caller-supplied.

Positional arguments and flags:

- `<issue-number>` is the managed Task Issue number.
- `--repo`, `--expected-pr`, `--expected-base`, `--expected-base-sha`, `--expected-head`, and `--expected-branch` bind the live repository, PR, protected base commit, exact current head, and branch. `--expected-base-sha` is the protected commit binding; the guide's separate blob SHA is fetched and derived by the transport.
- `--predecessor-comment` selects the immutable predecessor correction contract.
- `--adoption-authorization-comment` selects the existing Founder finding-adoption authorization.
- `--implementation-result-comment` selects the RESULT proving adoption was not executed.
- `--implementation-review-comment` selects the reviewed adopt-finding eligibility verdict.
- `--recovery-authorization-comment` selects the Founder authorization for this exceptional recovery.
- `--lineage-correction-authorization-comment` selects the immutable Founder authorization for `RECOVER-STATE-LINEAGE-001`; it binds the recovery-anchor RESULT/review selectors and the historical/recovery head roles.
- `--correction-result-comment` explicitly selects the immutable correction RESULT that binds the correction-reviewed head.
- `--correction-review-comment` explicitly selects the immutable bounded REVIEW_VERDICT that validates the correction-reviewed head.
- `--check` performs the complete validation without writing the Issue body.

The only successful mutation appends exactly one canonical state block through
the existing leased/CAS Issue-body writer. It preserves the surrounding Issue
body and all historical comments, never creates or alters an active correction
contract identity, and never posts a review or RESULT. A valid existing state,
malformed or partial markers, ambiguous or conflicting history, superseded or
competing authority, unsupported or unproven ancestry, head/base drift,
lease/CAS conflict, or ambiguous readback is a stop condition. An identical completed projection
returns `NO_OP_IDENTICAL_RETRY` without writing. The appended projection carries
one trusted-derived recovery-evidence fingerprint solely to prove that a retry
uses the same immutable evidence; it is never a caller input.

Success routes only to the already authorized command after fresh live
verification:

```text
pnpm run bemoat:mission-control:adopt-finding
```

Recovery does not invoke that command automatically, and it is not a general
replacement for `reconcile` or `recover-review`.

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
