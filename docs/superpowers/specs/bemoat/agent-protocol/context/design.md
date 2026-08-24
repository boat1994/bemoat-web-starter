<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-410-context"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#410"
branch_template: "feature/410-refactor-agent-protocol-replace-stateful-mission"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "2d9ee92d171097042eed0caa32a2057139233e0d"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/bemoat/agent-protocol/context/design.md"
paired_plan: "docs/superpowers/plans/bemoat/agent-protocol/context/plan.md"
```
<!-- bemoat-task-identity:end -->

# Bemoat Context Protocol Design

## Status

Approved for implementation under Issue #410. This design covers only
`bemoat:context`; `bemoat:handoff`, legacy Mission Control removal, and
unrelated repository or GitHub mutations remain out of scope.

## Goal

Provide a deterministic, read-only reconstruction command:

```text
pnpm run bemoat:context -- <issue-number> [--json]
```

The command computes one route from current normalized GitHub evidence and
current local Git safety evidence. It never reads or writes a previous
Mission Control state, route cache, receipt, counter, lease, or journal.

## Architecture

The runtime is split into four neutral boundaries:

1. `context-cli` parses the public invocation, exposes the registered help
   contract, and serializes the result.
2. `context-evidence` reads Git, GitHub, the protected base, and the canonical
   policy through injected command runners. It normalizes all external payloads
   into a stable evidence model and returns explicit unavailable/conflict
   reasons rather than guessing.
3. `context-parser` extracts the bounded Issue objective, scope, acceptance
   criteria, dependencies, and durable HANDOFF/legacy RESULT evidence without
   projecting any state.
4. `context-router` is a pure function. Given normalized evidence, it returns
   exactly one route from the closed enum and a deterministic reason, next
   action, and evidence URL set.

The context domain must not import `scripts/mission-control/**`. Existing
low-level Git/GitHub mechanics may be reimplemented or extracted only behind
the neutral adapter boundary. The entrypoint performs reads only; no write-capable
adapter is passed to it.

## Normalized evidence

The result contains:

- repository owner/name and canonical URL;
- protected base branch, exact live SHA, and source URL;
- canonical policy path, frontmatter policy ID/version, content/blob SHA, and
  source URL;
- Issue identity, title, state, parsed objective, scope, acceptance criteria,
  explicit dependencies, and evidence URL;
- local branch, HEAD, upstream, origin identity, cleanliness, detached state,
  GitHub visibility/durability, and precise local failure reasons;
- zero or one uniquely resolved active PR, with state, draft status, base/head
  branch and SHA, merge evidence, and URL;
- exact-head checks, review evidence, and native protection evidence;
- latest valid HANDOFF and historical RESULT records as evidence only;
- route, reasons, one next permitted bounded action, and all supporting URLs.

Missing, malformed, contradictory, or unauthoritative required evidence is
represented explicitly and causes `STOP`. Local dirty, detached, uncommitted,
unpushed, branch-mismatched, or local-only work uses a
`LOCAL_STATE_NOT_DURABLE`-style reason.

## Routing

The pure router applies these ordered rules:

1. Any repository identity, protected-base, policy, Issue, PR uniqueness, or
   required local durability contradiction returns `STOP`.
2. A merged PR with a consistent Issue returns `COMPLETE`.
3. A failed exact-head required check returns `FIX`.
4. A durable open PR whose exact-head checks are pending or incomplete returns
   `VERIFY`.
5. A durable open PR with successful exact-head checks but no required exact-head
   review returns `REVIEW`.
6. A durable open PR with successful checks and required exact-head approval
   returns `FOUNDER_GATE`.
7. A clean durable topic branch with no active PR returns `IMPLEMENT`.

The router never infers review counts, previous routes, state transitions, or
authority from historical RESULT comments. Historical RESULT comments are
included only as migration evidence; HANDOFF is the only durable continuation
record recognized as current protocol evidence.

## CLI contract

The command is a read-only Tier B repository command with one required positive
Issue number and one optional `--json` output flag. Its machine-readable help
must declare no writes and must be discoverable through the command registry.
JSON output is deterministic: object keys are emitted in the fixed model order,
arrays are normalized and sorted where evidence order is not authoritative,
and route selection does not depend on timestamps, process memory, or model
identity.

## Failure handling

The command exits successfully only when it has reconstructed a complete
context, including a `STOP` route when evidence proves a fail-closed stop.
Invalid invocation remains the repository-standard `INVALID_INVOCATION` path.
Unavailable Git/GitHub/policy evidence is reported as `STOP` with a precise
`BLOCKED_EXTERNAL` or `EVIDENCE_CONFLICT` reason in the context result; it is
never silently converted to an implementation route.

## Verification

Tests cover pure routing, Issue/hand-off parsing, exact-head check binding,
ambiguous and missing evidence, dirty/detached/unpushed/local-only states,
machine-readable help, and CLI no-mutation snapshots. The context entrypoint
is run with poisoned write commands to prove it performs no GitHub, Git,
branch, PR, Issue, filesystem protocol-state, cache, or database mutation.
