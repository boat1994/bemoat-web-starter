# Context Story Matrix

Issue [#427](https://github.com/boat1994/bemoat-web-starter/issues/427)
commissions story-first semantic coverage for the stateless `bemoat:context`
router before the Issue #410 cutover continues. This matrix is a bounded test
map, not a new state machine, routing configuration, or test DSL.

## Canonical invariants

| Invariant | Authority | Protected behavior |
| --- | --- | --- |
| Routing is a pure function of current native GitHub/Git evidence. | Issue #410 deterministic route contract | No prior Mission Control state, receipt, counter, or session memory selects a route. |
| Required evidence is exact and fail-closed. | Issue #410 generic safety contract | Missing, malformed, stale, conflicting, unavailable, or ambiguous evidence routes `STOP` or keeps an unsatisfied review gate. |
| Non-terminal continuation requires durable local work. | Issue #410 portability contract | Dirty, detached, unpushed, local-only, or wrong-repository work routes `STOP`. |
| Terminal merge evidence is authoritative. | Issue #410 plus merged Issue #423 / PR #424 behavior | A valid `MERGED` PR with a valid merge commit can route `COMPLETE` despite a historical base or irrelevant local checkout. |
| Active PR evidence uses the live protected base and exact head. | Issue #410 exact-identity contract | An open PR with a stale/wrong base or stale head evidence cannot continue silently. |
| CI and semantic review bind to the exact current PR head. | Issue #410 verification contract and merged policy v1.3.0 | A new commit invalidates old CI/review satisfaction. |
| Native evidence must agree with itself. | Issue #427 and CTX-423-001 | `OPEN` plus a merge commit, malformed merge identity, or competing PR/review evidence fails closed. |

## Invariant and pairwise stories

| Story | Risk interaction | Expected route | Baseline class | Coverage |
| --- | --- | --- | --- | --- |
| Open Issue, no PR, durable topic branch | PR absence × local durability | `IMPLEMENT` | B | `context-router.int.spec.ts`: clean durable work without a PR |
| Open active PR, pending exact-head CI | current base/head × CI pending | `VERIFY` | B | `context-router.int.spec.ts`: incomplete exact-head checks |
| Open active PR, failed exact-head CI | current base/head × CI failure | `FIX` | B | `context-router.int.spec.ts`: failed exact-head checks |
| Open active PR, green CI, missing semantic review | STANDARD profile × review absence | `REVIEW` | B | semantic review policy cases |
| Exact-head blocking semantic review with usable immutable finding | current head × blocking review | `FIX` | B | native `CORRECTION REQUIRED` case |
| Exact-head clean semantic review and satisfied native requirements | current head × clean review | `FOUNDER_GATE` | B | clean native review case |
| Stale active PR base with failed, pending, or fully satisfied downstream gates | base drift × CI/review state | `STOP` before downstream routing | B | story-first stale-base precedence table |
| New PR head with old CI verification | head movement × stale CI | `STOP` | B | head-transition story and stale verification case |
| New PR head with fresh CI but old semantic review | head movement × stale review | `REVIEW` | B | head-transition story and stale-review cases |
| Valid merged PR with historical base and detached checkout | terminal merge × stale base × local non-durability | `COMPLETE` | B | terminal reconstruction transition |
| `OPEN` PR plus valid-looking merge commit | native state × merge evidence conflict | `STOP` | A fixed by PR #424; now B regression coverage | evidence and router contradiction cases |
| Claimed merged PR with missing/malformed merge commit | terminal state × malformed merge evidence | `STOP` | B | merged-PR negative cases |
| Multiple active PRs or ambiguous/competing exact-head reviews | candidate cardinality × evidence ambiguity | `STOP` or unsatisfied `REVIEW` gate | B | competing PR/review cases |
| Closed Issue without a uniquely resolved merged PR | terminal Issue × absent terminal PR evidence | `STOP` | B | pure-router closed-Issue guard |

`A`, `B`, and `C` mean implementation defect, missing coverage, and
protocol/spec gap respectively. A B-class row may be a passing
characterization: it protects already-correct behavior and requires no
production change.

## Lifecycle transitions

1. No PR → durable topic work → `IMPLEMENT`.
2. Active current-base PR → pending CI `VERIFY` → failed CI `FIX`, or green CI
   with missing review `REVIEW` → clean exact-head review `FOUNDER_GATE`.
3. Exact-head blocking review → bounded `FIX`.
4. PR head changes → old CI is rejected with `STOP`; after fresh CI, old review
   remains stale and the route is `REVIEW`.
5. Sibling/dependency merge advances protected `main` while the active PR
   still records the old base → `STOP` before CI/review routing. File overlap
   does not authorize a different route because the normalized context model
   has no authoritative dependency/overlap evidence.
6. Founder manually merges the active PR → fresh reconstruction accepts valid
   native `MERGED` plus merge-commit evidence → `COMPLETE`, even though the PR
   retains its historical base and the local checkout is detached or irrelevant.
7. Contradictory, malformed, missing, or competing native evidence interrupts
   the transition and fails closed.

## Gap classification

The active stale-base route is canonically `STOP`: Issue #410 requires stale
protected-base evidence to fail closed, and `FIX`/`FOUNDER_GATE` require valid
downstream evidence that a stale base cannot satisfy.

What happens *after* that STOP is not uniquely defined. Canonical sources do
not say whether updating/rebasing the PR is a bounded `FIX`, requires a
`FOUNDER_GATE`, or needs another authorized continuation. That is a C-class
protocol/spec gap. Tests in this Issue protect the fail-closed STOP and must not
encode post-STOP remediation semantics until Founder/architecture authority
resolves this exact decision.
