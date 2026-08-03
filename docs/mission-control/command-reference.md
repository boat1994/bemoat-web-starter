# Mission Control command reference

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

## Unmanaged-genesis Full/Delta Review transport

Issue #262 remains unmanaged while Draft PR #266 is the one-time genesis
implementation under review. The repository therefore exposes a dedicated
`UNMANAGED_GENESIS_REVIEW` transport that records signed Full and Delta review
evidence without creating a managed-state block, `review_cycle`, or
`full_review_count`.

The only supported caller interface is:

```bash
pnpm run bemoat:mission-control:unmanaged-genesis-review -- \
  --founder-authorization-comment-id=<comment-id>
```

The caller may supply only that immutable Founder authorization comment ID.
Evidence class (`full` or `delta`), Issue/PR/base/head, source-review binding,
policy tuple, CI, correction range, and predecessor links are derived from the
authorization comment and live GitHub evidence. Raw `gh issue comment` bodies,
generic role comments, Issue-body edits, copied JSON records, and unsigned
comments remain non-authoritative.

A Full record alone cannot authorize the corrected head. A Delta record alone
cannot authorize it. Merge review eligibility requires one valid Full root for
the historical reviewed head, exactly one non-forked Delta tip rooted in that
Full, exact-current-head CI on that tip, and `ELIGIBLE FOR FOUNDER REVIEW` with
no unresolved Critical/Important findings. Head drift fails closed. Identical
retry returns `NO_OP`. Competing, forked, edited, superseded, or ambiguous
records return `STATE CONFLICT`.
