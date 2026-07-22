---
artifact_id: planning-no-pr-correction-v1
issue: 145
predecessor_pr: 148
policy_guide_version: 1.2.0
approved_base: main
workflow_status: DOGFOOD_PASSED
---

# Planning no-PR correction dogfood evidence — v1

Upstream-only starter dogfood for Issue #145 Review 1 correction (`MC-R1-001`
through `MC-R1-005`). No child repository sync or mutation was performed.

Canonical references:

- Issue #145: https://github.com/boat1994/bemoat-web-starter/issues/145
- Review 1 verdict: https://github.com/boat1994/bemoat-web-starter/pull/148#issuecomment-5048290674
- Correction HANDOFF: https://github.com/boat1994/bemoat-web-starter/issues/145#issuecomment-5048312856
- Policy: `docs/mission-control/mission-control-guide.md` · version `1.2.0`

## Delivery record

| Field | Value |
| --- | --- |
| PR | https://github.com/boat1994/bemoat-web-starter/pull/148 |
| Baseline reviewed head (Before) | `502999d29afc2142604b9f250bfa0c31c2285aff` |
| Corrected head (After) | `093703a41e42663d8c205b2f81e71d540169ecdc` |
| Node runtime | `>=24.15` (`v24.16.0` used locally) |
| Repository | `boat1994/bemoat-web-starter` only |

## Reproducible command matrix

| ID | Scenario | Exact command / input | Before (`502999d`) | After (corrected head) |
| --- | --- | --- | --- | --- |
| D-01 | Valid planning-only no-PR authorization | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "TEST-PLAN-01"` on baseline scripts+tests | **PASS** · exit `0` · `Edit authorization: granted` without durable managed-state proofs | **PASS** · exit `0` · authorization granted only after durable proofs + narrow allowlist |
| D-02 | Missing/conflicting managed `active_pr` (`MC-R1-001`) | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "MC-R1-001: fails closed when managed state active_pr"` | **N/A** (control absent) | **PASS** · exit `0` test · preflight exit `1` · `active_pr: null` required |
| D-03 | Stale `last_reviewed_head` (`MC-R1-001`) | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "MC-R1-001: fails closed when managed state last_reviewed_head is stale"` | **N/A** | **PASS** · exit `0` test · preflight exit `1` |
| D-04 | Unrelated `docs/**` path (`MC-R1-002`) | `pnpm exec vitest run tests/int/correction-contract.int.spec.ts -t "rejects unrelated docs paths"` | **FAIL open** · generic `docs/**` allowed | **PASS** · exit `0` test · `outside canonical planning-artifact allowlist` |
| D-05 | Out-of-scope `src/**` diff (`MC-R1-002`) | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "TEST-PLAN-04"` | **PASS** · blocks `src/` only | **PASS** · blocks any path outside `expected_areas` allowlist |
| D-06 | Malformed PR list evidence (`MC-R1-003`) | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "MC-R1-003: fails closed when malformed GitHub PR list"` | **FAIL open** · malformed JSON treated as success | **PASS** · exit `0` test · `malformed GitHub PR list JSON` |
| D-07 | Issue-linked ghost PR (`MC-R1-003`) | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "TEST-PLAN-03"` | **PASS** only when PR number equals issue number | **PASS** · detects branch-linked and closing-issue PRs |
| D-08 | Unrelated open PR allowed (`MC-R1-003`) | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "MC-R1-003: allows unrelated open PRs"` | **N/A** | **PASS** · unrelated PR does not block authorization |
| D-09 | Unrelated same-repo discussion URL (`MC-R1-004`) | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "MC-R1-004: rejects unrelated same-repository discussion URLs"` | **FAIL open** · unrelated `#discussion_rN` accepted | **PASS** · exit `0` test · PR identity conflict |
| D-10 | Declared finding `source_thread` pointer (`MC-R1-004`) | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "MC-R1-004: accepts only declared finding source_thread"` | **PASS** (over-broad acceptance) | **PASS** · only declared `source_thread` values accepted |
| D-11 | Implementation correction without PR remains fail-closed | `pnpm exec vitest run tests/int/agent-issue.int.spec.ts -t "TEST-PR-01"` | **PASS** | **PASS** · `implementation_pr` path unchanged |
| D-12 | Full required validation tier | `pnpm run check` | **PASS** on baseline head | **PASS** · `411/411` tests, zero lint warnings |

## Evidence inputs

- Managed state block (planning correction): `active_pr: null`, `approved_base: main`,
  `last_reviewed_head` equals immutable contract `reviewed_head`, issue `#145`.
- `REVIEW_VERDICT` planning contract: `PR / base / head: none · base main · head <sha>`.
- Immutable finding `expected_areas`:
  `docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md`.
- Declared `source_thread`:
  `https://github.com/boat1994/bemoat-web-starter/pull/12#discussion_r1`.

## Executed After validation (corrected head, local)

```text
$ node --version
v24.16.0

$ pnpm run check
Test Files  22 passed (22)
Tests  411 passed (411)

$ pnpm exec vitest run tests/int/agent-issue.int.spec.ts tests/int/correction-contract.int.spec.ts -t "planning_no_pr|MC-R1-00"
Test Files  2 passed (2)
Tests  101 passed | 61 skipped (162)
```

## Finding resolution map

| Finding | Before defect | After evidence |
| --- | --- | --- |
| MC-R1-001 | `planning_no_pr` granted without durable state / ancestry proofs | D-01/D-02/D-03 |
| MC-R1-002 | Generic `docs/**` / `.bemoat/**` bypass | D-04/D-05 |
| MC-R1-003 | Malformed / incomplete conflicting-PR evidence treated as success | D-06/D-07/D-08 |
| MC-R1-004 | Foreign / unrelated discussion URLs accepted under `none` mode | D-09/D-10 |
| MC-R1-005 | No reproducible upstream starter dogfood table | This artifact + D-01–D-12 |

## Non-goals confirmed

- No child harness sync (`pnpm run bemoat:boilerplate:sync`) was executed.
- `boat1994/bogus-jewelry#92` was not modified.
- Issue #149 was not started.
