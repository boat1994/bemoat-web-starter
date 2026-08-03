# Mission Control command reference

This is the canonical usage contract for the repository-owned Mission Control
transports. The scripts read GitHub live at execution time; live GitHub evidence
overrides chat, copied handoffs, local notes, or stale values.

## Evidence vocabulary

Keep these values distinct in every handoff and invocation:

| Value | Meaning and authoritative source |
| --- | --- |
| Task Issue | The directly managed Issue passed as the command's positional `<issue-number>`; read its live state block and body with `gh issue view`. |
| Parent/campaign Issue | A campaign Issue referenced by the live Founder authorization and its projection binding; it is not the Task Issue and is not a substitute positional argument. |
| PR number | The active PR bound by the Task Issue state and verified with live `gh pr view`; it is not the Issue number. |
| Base branch | The live PR target branch (`baseRefName`), which must match the approved base in the Task Issue state. |
| Protected-base SHA | The live commit SHA of the protected base branch (`baseRefOid` / current protected ref), used for ancestry and exact-base checks; do not copy an older approved SHA from chat. |
| Exact PR head SHA | The live PR `headRefOid` at the moment of the command. CI and every review/merge authorization must match this exact SHA. |
| Role comment ID | The immutable GitHub Issue comment ID returned by the live API: HANDOFF for dispatch, active `REVIEW_VERDICT` for reconcile/merge, and Founder authorization for merge. |
| Verdict body / verdict file | The complete `## REVIEW_VERDICT` body supplied by `--body-file` to review, or the live role comment body selected by reconcile/merge. A file path is only transport; the body must contain canonical PR/base/head/verdict evidence. |

Do not infer any supplied value from a chat transcript. Re-read the Task Issue,
campaign authorization, PR, comments, protected base, and exact head live before
running a transport.

## Dispatch

Exact syntax:

```text
pnpm run bemoat:mission-control:dispatch -- <issue-number> [--repo <owner>/<repo>] [--body-file <handoff-file>] [--founder-correction] [--workflow-mode <mode>] [--planning-base-sha <commit-sha>]
```

Positional arguments and flags:

- `<issue-number>` is the positive Task Issue number.
- `--repo` is optional `owner/repo`; otherwise the current `gh` repository is used.
- `--body-file` supplies the complete `## HANDOFF`; without it, dispatch reads stdin.
- `--founder-correction` selects the Founder-authorized correction path.
- `--workflow-mode` optionally records the mode in the managed state.
- `--planning-base-sha` optionally supplies the planning authorization base SHA.

Preconditions and sources: the live Task Issue must have valid managed state.
Normal dispatch must be in a dispatchable state and must post one valid HANDOFF,
then verify the live state is `IN_PROGRESS` and bound to the returned comment ID.
Founder correction additionally requires live `FOUNDER_AUTHORIZED_CORRECTION`
state, unconsumed authorization, and a HANDOFF containing the live authorization
identity. The base SHA and mode come from the live authorization/plan evidence,
not an invented value.

Valid example (placeholders are intentionally non-literal):

```text
pnpm run bemoat:mission-control:dispatch -- <TASK_ISSUE_NUMBER> --repo <OWNER>/<REPO> --body-file <HANDOFF_FILE>
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
state. For an eligible review state, reconcile selects exactly one active live
`REVIEW_VERDICT` for that Task Issue, then requires its PR number, base branch,
and exact head to match the live PR and state. For other states it evaluates
live Issue, PR, comment, campaign, and protected-base evidence before proposing
an allowed deterministic repair.

Valid example (placeholder):

```text
pnpm run bemoat:mission-control:reconcile -- <TASK_ISSUE_NUMBER> --repo <OWNER>/<REPO>
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
- `--expected-state` is the live managed-state value expected before the review write.
- `--review-type` is exactly `full` or `delta`.
- `--expected-head` is the exact live PR head SHA being reviewed.
- `--repo` is optional `owner/repo`.

Preconditions and sources: read the live Task Issue state, active PR, base
branch, exact head, and CI before creating the verdict file. The verdict body
must itself identify the live PR, base, exact head, and Core verdict enum; the
file path is not evidence. `full` requires the initial review-cycle state;
`delta` requires an existing review cycle. The command posts the role comment,
then performs CAS/readback verification against the live Issue and PR.

Valid example (placeholders):

```text
pnpm run bemoat:mission-control:review -- <TASK_ISSUE_NUMBER> --body-file <VERDICT_FILE> --expected-state <EXPECTED_MANAGED_STATE> --review-type <full|delta> --expected-head <EXACT_PR_HEAD_SHA> --repo <OWNER>/<REPO>
```

Missing required flags, a malformed verdict, stale state, wrong review type,
or any PR/base/head mismatch fails closed as `STATE_CONFLICT`. Unavailable
GitHub or CI evidence is `BLOCKED_EXTERNAL`. Exact-head CI must match the
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
- `--authorization-comment` is the immutable live Founder authorization comment ID.

Preconditions and sources: read the live Task Issue state, active PR, approved
base branch, protected-base SHA, exact PR head, active review-verdict comment,
Founder authorization body, and exact-head CI. The authorization comment must
bind the Task Issue, PR number, approved base, exact reviewed head, review
verdict comment ID, policy source, and merge scope. The parent/campaign Issue
and any blocker/slice binding come only from that live authorization. The PR
must be open/mergeable (or already verifiably merged), and the authorized head
must be passed to GitHub's exact-head merge operation.

Valid example (placeholders):

```text
pnpm run bemoat:mission-control:merge -- <TASK_ISSUE_NUMBER> --repo <OWNER>/<REPO> --authorization-comment <FOUNDER_AUTHORIZATION_COMMENT_ID>
```

Missing authorization, wrong role-comment ID, stale verdict, wrong Task Issue,
PR, base, protected-base ancestry, or exact head fails closed as
`STATE_CONFLICT`; unavailable live GitHub, CI, or protected-base evidence is
`BLOCKED_EXTERNAL`. Merge is Founder-authorized transport, not a review or
reconcile shortcut. Direct `gh issue edit`, manual YAML, and ad hoc merge or
transition scripts are prohibited substitutes.

## Shared stop rule

If live GitHub evidence disagrees with chat or a copied value, stop and classify
the discrepancy fail closed. Never repair the discrepancy by editing managed
Issue YAML directly. Re-read live evidence and use the one canonical transport
whose preconditions match; otherwise stop for `STATE_CONFLICT` or
`BLOCKED_EXTERNAL`.
