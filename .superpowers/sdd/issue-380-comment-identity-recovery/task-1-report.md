# Task 1 report — comment identity characterization

## Status

Complete as a bounded RED characterization task. No production code was changed and no GitHub command, API mutation, comment post, comment edit, issue, or pull request operation was performed.

## Scope inspected

- `scripts/mission-control/domain/founder-authorization-recording.ts`
- `scripts/mission-control/workflows/authorize-founder.mjs`
- `scripts/mission-control/adapters/task-bootstrap-github.mjs`
- `tests/int/mission-control-authorization-recording.int.spec.ts`
- `tests/int/cli-mission-control-authorize-founder-regression.int.spec.ts`
- `.superpowers/sdd/plan/issue-380-comment-identity-recovery.md`

The current boundary classifies existing authorization comments using only `issue_number` and Founder identity. The new characterization supplies repository-bound `issue_url` evidence while preserving the historical normalized `issue_number: null` shape.

## Coverage added

`tests/int/mission-control-authorization-identity.int.spec.ts` covers:

- correct repository and Issue URL, expecting recovery of comment `5365740285` by posting only its missing receipt;
- correct repository with the wrong Issue URL;
- wrong repository with the same Issue number;
- missing issue identity;
- malformed Issue URL;
- conflicting `issue_url` and `issue_number` sources.

The historical body is reconstructed through the existing body builder and pinned to SHA-256 `67c6349033062b03a430e856c6f07a0fc41537c560a32bd417212714f10b77b9`. The historical comment object is snapshotted before each invalid-identity case and asserted unchanged afterward. All POST/read callbacks are in-memory test doubles; no GitHub transport is reachable from this suite.

## RED command and result

Command:

```text
pnpm exec vitest run --config ./vitest.config.mts tests/int/mission-control-authorization-identity.int.spec.ts --no-file-parallelism
```

Result: exit code `1`.

```text
❯ tests/int/mission-control-authorization-identity.int.spec.ts (6 tests | 6 failed) 7ms
     × recovers the immutable partial authorization from a correct repository and Issue URL 2ms
     × fails closed for correct repository, wrong Issue without posting a receipt 2ms
     × fails closed for wrong repository, same Issue number without posting a receipt 0ms
     × fails closed for missing issue identity without posting a receipt 1ms
     × fails closed for malformed issue URL without posting a receipt 0ms
     × fails closed for conflicting identity sources without posting a receipt 0ms

Test Files  1 failed (1)
Tests  6 failed (6)
```

Failure evidence at the current boundary:

- the valid URL-backed historical comment fails with `authorization evidence has an invalid identity or Issue binding`;
- wrong-repository, wrong-Issue, and malformed-URL cases currently resolve `SUCCESS` and would post a receipt;
- missing-identity and conflicting-source cases fail as the old generic `STATE_CONFLICT`, rather than the required authoritative identity `EVIDENCE_CONFLICT`.

## Self-review and validation

```text
pnpm exec eslint tests/int/mission-control-authorization-identity.int.spec.ts --max-warnings 0  # exit 0
git diff --check                                                                               # exit 0
```

The change is limited to the requested characterization test and this report. No implementation or unrelated refactor is included.

## Commit

`test: characterize issue comment identity recovery`

The final commit hash is supplied in the task handoff; it is not embedded here because changing this report changes the commit hash.

## Fix round 1 — review findings addressed

Applied one bounded test-only fix round in the same worktree:

- `recordingOptions` now returns the supplied historical comment object unchanged from `readComment`, preserving its authoritative `issue_url` and `issue_number: null`; receipt POST/readback fixtures also carry URL-backed raw identity and do not inject `context.issueNumber`.
- Correct-repository/wrong-Issue, wrong-repository/same-number, and malformed-URL fixtures now have no conflicting numeric second source (`issue_number: null`). Only the explicit conflicting-source case supplies a mismatched `issue_number`.
- Invalid-identity assertions require rejection and zero posts, without asserting a specific error taxonomy, preserving current fail-closed semantics.
- Valid recovery now asserts exactly one posted body, exact receipt body construction, receipt repository/Issue/Founder/comment-ID/body-hash bindings, and immutability of the historical comment object.

## Fix-round RED command and result

Command:

```text
pnpm exec vitest run --config ./vitest.config.mts tests/int/mission-control-authorization-identity.int.spec.ts --no-file-parallelism
```

Result: exit code `1`; `1` test failed and `5` passed.

```text
❯ tests/int/mission-control-authorization-identity.int.spec.ts (6 tests | 1 failed) 3ms
     × recovers the immutable partial authorization from a correct repository and Issue URL 2ms

Test Files  1 failed (1)
Tests  1 failed | 5 passed (6)
```

The remaining RED failure is the intended current-boundary failure: the valid URL-backed historical comment is rejected with `authorization evidence has an invalid identity or Issue binding`. The five invalid-identity cases pass their required fail-closed/no-mutation characterization, including preserved existing behavior for missing and conflicting identity.

Fix-round self-review:

```text
pnpm exec eslint tests/int/mission-control-authorization-identity.int.spec.ts --max-warnings 0  # exit 0
git diff --check                                                                               # exit 0
```

This round changes only `tests/int/mission-control-authorization-identity.int.spec.ts` before the report append; no production files or GitHub state were touched.
