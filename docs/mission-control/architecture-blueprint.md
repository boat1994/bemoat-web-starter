# Mission Control Architecture Blueprint

**Status:** Founder-approved **architectural direction**, reconciled with the
stateless #410 cutover in merged PR #420.
**Approved target:** **Option B — Pristine Journey Hub**.  
**Current authority:** Issue [#410](https://github.com/boat1994/bemoat-web-starter/issues/410)
and merged PR [#420](https://github.com/boat1994/bemoat-web-starter/pull/420)
define the supported public protocol.
**Authority:** Founder decision on Issue [#340](https://github.com/boat1994/bemoat-web-starter/issues/340), derived from Draft PR [#341](https://github.com/boat1994/bemoat-web-starter/pull/341) design head `32944cc054b9023a1592dfb49c7d597536d15aac`.  
**Design record (non-normative):** `docs/superpowers/specs/bemoat/mission-control/architecture/design.md` at that SHA.  
**As-built evidence baseline:** protected `main@7cfd62b6197a2e95fc8dbe06e30e047550b85e2b` (PR #339 Phase-1 merge), as recorded in the approved design.  
**Policy (unchanged):** `docs/mission-control/mission-control-guide.md` remains the only long-form operating policy. This blueprint does **not** compete with the guide.

## Current supported protocol

The current supported cross-agent protocol has exactly two public commands:

```text
bemoat:context <issue-number> --json
→ one bounded objective
→ bemoat:handoff <issue-number> --body-file <strict-handoff.json>
→ fresh GitHub reconstruction
```

`bemoat:context:sync-base` remains a retained protected-main synchronization
utility. Exact repository/base/PR/head/CI/review evidence, CLI Discovery,
generic repository and child-sync safety, and fail-closed behavior remain
shared retained infrastructure. The stateful delivery/review/reconcile/
recovery/merge/task/role-comment surfaces below are migration-only historical
records and Phase 7 deletion candidates; this reconciliation does not delete
them. The Phase 7 deletion boundary remains one bounded cluster at a time.

## Historical architecture and census

Sections below preserve the earlier Option B design and as-built census for
read compatibility. Their old `KEEP` labels and stateful command names are
historical classifications, not current supported routing. Current ownership is
the stateless protocol above and the reconciled guide.

---

## 0. Authority, labels, and non-authorization

| Label | Meaning |
| --- | --- |
| **Approved: Option B — Pristine Journey Hub** | Founder-selected **architectural direction** for the target lean Mission Control harness |
| **RECOMMENDED — NOT APPROVED** | Design-record recommendation label on Option B in PR #341 — **superseded for direction** by Founder approval of Option B |
| **Direction only** | Normative target shape and dispositions; **not** authorization to change code, guards, or merge Draft PR #341 |

### Explicitly NOT authorized by this blueprint

This document does **not** authorize:

- broad or multi-cluster pruning, deletion, or retirement of runtime files
- runtime behavior repair or semantic redesign
- merge of Draft PR [#341](https://github.com/boat1994/bemoat-web-starter/pull/341)
- Issue [#333](https://github.com/boat1994/bemoat-web-starter/issues/333) Batch 6 / Cluster F
- Issue #333 closure
- deployment, production mutation, retained-data changes, or real child sync

Pruning and semantic simplification require **separate Founder authorization** after this blueprint is accepted as documentation.

### Preserve (non-negotiable under the current stateless cutover)

- Founder authority
- exact-head binding and CI
- exact repository/base/PR/head/CI/review evidence mechanics
- CLI Discovery and safe-help semantics
- generic repository, secret, toolchain, destructive-operation, and child-sync safety
- fail-closed behavior for ambiguous or unavailable evidence

## 1. Documentation roles

| Artifact | Role |
| --- | --- |
| `mission-control-guide.md` | **POLICY** — authority, governance, state/review invariants |
| `architecture-blueprint.md` (this file) | **ARCHITECTURE** — what Mission Control is, supported journeys/capabilities, boundaries, trust/recovery model, legacy status, target lean shape |
| `command-reference.md` | **USAGE** — how supported commands are invoked and public contracts |
| Superpowers design under `docs/superpowers/specs/.../architecture/design.md` | **DESIGN RECORD** — alternatives, rationale, correction history; not competing architectural authority after Founder direction approval |
| TypeScript / runtime code | **IMPLEMENTATION** of the approved architecture (only after separately authorized work) |

---

## 2. Design rule (journey-first)

Primary question (Founder amendment on #340):

> For each supported Mission Control case, what starts the journey, which canonical command is called, which validations and internal capabilities are required, what durable mutations occur, what failures are legitimate, and what exact terminal state / next permitted action ends the journey?

Retention in the target architecture requires at least one of:

1. participation in a supported canonical journey;
2. enforcement of a required invariant for one or more journeys;
3. real-world failure recovery still possible under correct canonical operation; or
4. an explicitly identified live temporary consumer.

Static reachability alone is insufficient for deletion authority. Deletion remains unauthorized until a separate Founder prune gate.

---

## 3. Supported execution architecture (target)

```mermaid
flowchart LR
    A[Agent or Founder intent] --> B[bemoat:context]
    B --> C[One bounded objective]
    C --> D[bemoat:handoff]
    D --> E[GitHub durable evidence]
    E --> B
    S[bemoat:context:sync-base] -.->|retained bounded utility| E
```

Option B refuses unsupported mimicry: agents must not reconstruct lifecycle by reading implementation source or mutating managed state ad hoc.

---

## 4. Historical stateful journey map

```mermaid
flowchart LR
    A[Founder / Agent intent] --> B[Reconstruct live policy + durable state]
    B --> C{Selected canonical journey}

    C --> D[Dispatch]
    D --> E[HANDOFF]
    E --> F[Dev execution]
    F --> G[Delivery]
    G --> H[RESULT + AWAITING_REVIEW_1]
    H --> I[Review]

    I --> J{Review verdict}
    J -->|Correction required| K[Correction HANDOFF]
    K --> F
    J -->|Eligible / Founder gate| L[Founder decision]
    L --> M[Merge completion]
    M --> N[DONE]

    B --> R[Reconciliation / Recovery only when required]
    R --> C
```

Normal-success paths and exceptional recovery paths remain visibly distinct.

---

## 5. Historical Journey Atlas (migration-only dispositions)

Journey dispositions below are **architectural direction** for Option B. They do **not** authorize pruning of implementing files.

### Capability disposition (normative lens)

```mermaid
flowchart LR
    A[Existing capability/module] --> B{Belongs in Option B target?}
    B -->|Core / Safety| C[KEEP + PORT]
    B -->|Temporary active legacy| D[KEEP UNTIL CONSUMER CLOSED]
    B -->|Historical bypass compatibility| E[PRUNE — after separate Founder auth]
    B -->|Duplicate / superseded| E
    B -->|Unknown| F[INVESTIGATE / FAIL CLOSED]
```

### J1 — Repository / policy / durable-state reconstruction

| Field | Content |
| --- | --- |
| Purpose | Reconstruct authoritative policy, live GitHub evidence, and local durability before one bounded objective |
| Canonical commands | `pnpm run bemoat:context <n> --json` (read-only); policy load from protected `main` guide; raw GitHub reads for verification |
| Durable writes | **None** |
| Unsupported | Reconstructing transitions by reading/mimicking implementation source; manual YAML edits |
| Disposition | **RETAINED STATELESS** (CORE) |

### J2 — Task bootstrap / start

| Field | Content |
| --- | --- |
| Purpose | Founder-authorized managed-Task genesis (exceptional) |
| Canonical entrypoint | Retired; no executable Task Bootstrap transport remains |
| Ordinary start | Existing managed Task evidence is read by retained Context and generic task-state parsing |
| Disposition | **RETIRED / READ-ONLY COMPATIBILITY** |

### J3 — Dispatch → HANDOFF

| Field | Content |
| --- | --- |
| Canonical command | Retired; no executable migration command remains |
| State | Historical dispatch state is read-only and stops at the Founder gate |
| Disposition | **RETIRED / READ-ONLY COMPATIBILITY** |

### J4 — Delivery → RESULT → `AWAITING_REVIEW_1`

| Field | Content |
| --- | --- |
| Canonical command | `pnpm run bemoat:agent:delivery` |
| Trust | Exact head; required CI; single PR binding |
| Disposition | **MIGRATION-ONLY HISTORICAL / PHASE-7 DELETE CANDIDATE** |

### J5 — Review → `REVIEW_VERDICT`

| Field | Content |
| --- | --- |
| Canonical command | Retired; no executable managed-review command remains |
| Note | Historical verdict evidence remains readable where required; no executable managed-review writer remains |
| Disposition | **RETIRED / READ-ONLY COMPATIBILITY** |

### J6 — Correction → bounded Delta Review

| Field | Content |
| --- | --- |
| Commands | correction preflight → delivery → delta review; optional `adopt-finding` |
| Disposition | **MIGRATION-ONLY HISTORICAL / PHASE-7 DELETE CANDIDATE** |

### J7 — Founder merge → `DONE`

| Field | Content |
| --- | --- |
| Canonical command | Retired; no executable custom merge command remains |
| Trust | Native GitHub authority and evidence reconstructed by Context |
| Disposition | **RETIRED / READ-ONLY COMPATIBILITY** |

### J8 — Deterministic reconciliation

| Field | Content |
| --- | --- |
| Scope | Routing-only projection repair; cannot initialize state, replay reviews, or invent verdicts |
| Disposition | **MIGRATION-ONLY HISTORICAL / PHASE-7 DELETE CANDIDATE** |

### J9 — Real-world recovery

#### J9b — `recover-state`

| Field | Content |
| --- | --- |
| Purpose | Recreate one wholly absent managed-state block from uniquely reconstructable immutable evidence |
| Disposition | **MIGRATION-ONLY HISTORICAL / PHASE-7 DELETE CANDIDATE** |

#### J9c — `reopen`

| Field | Content |
| --- | --- |
| Purpose | Project Founder-authorized PR head drift to `FOUNDER_AUTHORIZED_CORRECTION` |
| Disposition | **MIGRATION-ONLY HISTORICAL / PHASE-7 DELETE CANDIDATE** |

### J10 — Canonical role-comment publication / readback

| Field | Content |
| --- | --- |
| Canonical command | `pnpm run bemoat:issue:comment` |
| Active dependency | `diagnostics/github-comment-projection` used by role-comment + agent-issue evidence paths |
| Disposition | **MIGRATION-ONLY HISTORICAL / PHASE-7 DELETE CANDIDATE**; shared comment projection remains retained until current consumers are closed or consolidated |

### J11 — Child / harness sync (PLATFORM-adjacent)

| Field | Content |
| --- | --- |
| Commands | `pnpm run bemoat:boilerplate:check|sync -- --harness-only` (or `--full`) |
| Ownership | Platform / harness-sync (`docs/harness-sync-contract.md`); not an MC state-machine journey |
| Disposition | **SPLIT ownership:** PLATFORM capability MC policy depends on; retain commands; do not fold into J1–J10 |

---

## 6. Protection model

```mermaid
flowchart TD
    I[Required invariant] --> P{Best enforcement layer}
    P --> T[TypeScript domain model]
    P --> Z[Zod runtime validation]
    P --> X[Behavioral test / oracle]
    P --> G[Repository guard]
    P --> F[Founder / authority gate]
```

Option B minimizes duplicate independent implementations of the same invariant while preserving deliberate defense-in-depth where justified. Prefer typed domain + Zod at trust boundaries; keep independent guards where they protect platform/safety or Founder-gated integrity.

---

## 7. HISTORICAL AS-BUILT map (descriptive)

Evidence root for the census that informed Option B: `main@7cfd62b6197a2e95fc8dbe06e30e047550b85e2b`. Live refs must be reverified before any later prune authorization.

### 7.1 Historical public command surface

| Command | Role |
| --- | --- |
| `bemoat:agent:issue` | Read-only reconstruction / preflight (J1) |
| `bemoat:agent:delivery` | Delivery (J4) |
| `bemoat:mission-control:merge` | Merge (J7) |
| `bemoat:issue:comment` | J10 |
| `bemoat:boilerplate:check|sync` | J11 PLATFORM |
| `bemoat:guard:*` / validation scripts | Guards & validation |

**Unsupported agent behavior (explicit):** reconstructing lifecycle by reading implementation source; ad-hoc managed-state mutation; replacing canonical commands with raw `gh issue edit`.

### 7.2 Historical domain / state / authority ownership (as-built)

| Concern | Owner (as-built) |
| --- | --- |
| Managed Task state parse/render | `domain/task-state.*` (+ authorization helper) |
| Review verdict projection/transition | review-verdict modules + `workflows/review` |
| Merge authority / terminal bundle | merge domain + `workflows/merge` + Founder allowlist |
| Campaign parse/validate/normalize | `domain/campaign-*` (Zod boundary in validator) |
| Correction contract | correction-contract modules |
| Reconciliation analysis | bounded-reconciliation / reconciliation modules + `workflows/reconcile` |
| Recover-state | dedicated workflow + adapter + domain evidence modules |

Durable SoT: Issue managed-state markers + immutable role comments + PR head/CI; Founder auth comments for merge/reopen/adoption/recovery.

### 7.3 Runtime trust / Zod boundaries (retained boundary)

| Boundary | As-built |
| --- | --- |
| CLI invocation / help / result envelopes | CLI command schemas + Zod |
| Campaign external evidence | campaign validator boundary / schemas |
| Native TS execution | Node type-stripping; `typescript-runtime-contract.md`; `bemoat:typecheck` |
| Remaining `.mjs` production | Still authoritative for many workflows/entrypoints |

Principle: unknown external runtime values → Zod (or equivalent fail-closed parse) at adapter/CLI boundary; domain prefers typed modules.

### 7.4 Historical reconciliation / recovery classes

| Mechanism | Class |
| --- | --- |
| `reconcile` | Real-world routing repair (**KEEP**) |
| `recover-state` | Exceptional absent-state reconstruction (**KEEP**) |
| `reopen` | Founder-authorized correction path (**KEEP**) |
| Agent-bypass compatibility shims | Candidates for semantic simplification **only after separate Founder prune auth** — not “recovery” |

### 7.5 Compatibility facades (Phase 7 candidates — not deletion authority in this change)

| Path | Tentative class |
| --- | --- |
| `domain/brainstorming.mjs` | Low-risk facade cleanup candidate (Class A) |
| `domain/task-state-authorization.mjs` | Low-risk facade cleanup candidate (Class A) |
| `domain/merge-head-bindings.mjs` | Low-risk facade cleanup candidate (Class A) |
| `workflows/campaign-projection.mjs` | Investigate / possibly KEEP as workflow helper |
| `diagnostics/github-comment-projection.mjs` | **KEEP** (active imports) |

Inventory counts on baseline (design evidence): **87** `scripts/mission-control/**/*.mjs`, **68** `*.ts`; of `.mjs`, ~**34** paired re-export facades and ~**53** mjs-only implementation files.

### 7.6 Tests / protected oracles

| Item | Note |
| --- | --- |
| Protected oracles (SHA-256) | Tracked in structural-protection manifest; anti-tampering retained under Option B |
| Grandfathered line ceilings | Migration ratchet; Option B targets **SPLIT** from oracle integrity (retirement still requires separate auth) |
| Int suite | `pnpm run bemoat:test:int` / vitest Mission Control specs |

### 7.7 Live temporary consumers

| Consumer | Implication |
| --- | --- |
| Issue #333 | Migration frozen pending architecture checkpoint; Batch 6 **not** authorized by this blueprint |

---

## 8. Guard-pack audit (exact 13 IDs) — Option B target dispositions

Source: `GUARD_PACK` in `scripts/guards/pack.mjs` on protected main. Aggregator `pack.mjs` is **not** one of the 13 IDs.

| # | Guard ID | Option B disposition (direction) |
| --- | --- | --- |
| 1 | `repo-safety` | **RETAIN** (PLATFORM/SAFETY) |
| 2 | `harness-contract` | **RETAIN** (PLATFORM) |
| 3 | `build-script-contract` | **RETAIN** platform; alias subset may be semantic-simplification candidate later |
| 4 | `package-manager` | **RETAIN** |
| 5 | `toolchain-contract` | **RETAIN** |
| 6 | `env-placeholder` | **RETAIN** |
| 7 | `cloudflare-config` | **RETAIN** (pack id name must stay `cloudflare-config`) |
| 8 | `frontend-seo` | **RETAIN as PLATFORM** or **SPLIT** out of “MC lean pack” (Founder may decide pack membership later) |
| 9 | `mission-control-contract` | **RETAIN**; rule-level audit later under separate prune auth |
| 10 | `planning-contract` | **RETAIN** |
| 11 | `mission-control-drift` | **RETAIN now**; optional later **MERGE** into typed-domain/tests once TS owns matrices |
| 12 | `structural-protection` | **RETAIN**; **SPLIT** oracle integrity vs line-count ratchet (oracle hashes keep; ratchet rebaseline/retire only after separate auth) |
| 13 | `scripts-architecture` | **RETAIN concept**; **rebaseline** contract to this approved blueprint only after separately authorized update |

---

## 9. TARGET LEAN ARCHITECTURE — Option B Pristine Journey Hub

**Founder-approved architectural direction.** Design-record label `RECOMMENDED — NOT APPROVED` is superseded for **direction** only.

| Dimension | Option B target |
| --- | --- |
| Supported journeys | Stateless context reconstruction → one bounded objective → HANDOFF; J11 remains PLATFORM-adjacent; refuse unsupported mimicry |
| Public command surface | `bemoat:context` and `bemoat:handoff`, plus retained generic safety/discovery/sync utilities; legacy facades remain only for migration compatibility until separately pruned |
| Recovery posture | Preserve exact evidence and generic fail-closed/child-sync safety; stateful recovery commands are historical compatibility, not a supported future API |
| Compatibility posture | Least tolerance for agent-bypass; fail closed on non-canonical entry |
| Guard strategy | Retain PLATFORM guards (1–8, 10); keep MC contract + drift initially; SPLIT structural-protection concerns; rebaseline `scripts-architecture` to this blueprint under later auth; optional drift MERGE once TS owns matrices |
| TS/Zod ownership | Port only journey-justified modules; do not TypeScript-port prune candidates |
| Estimated surviving TS migration surface (after future authorized prune) | ~**35–45** semantic MC files after Class A + evidence-backed Class B (excludes TEMPORARY incident modules until retired) — planning estimate only |
| Risks if pruning is later authorized carelessly | Over-pruning if live consumers missed; short-term breakage for out-of-contract agent habits |

### Pruning / simplification classes (separately bounded by Issue #410)

| Class | Meaning | Authorization |
| --- | --- | --- |
| **A. Low-risk dead/facade cleanup** | Collapse re-export-only `.mjs` after importers/tests updated | Issue #410 Phase 7, one approved cluster at a time |
| **B. Intentional semantic simplification** | Retire bypass-tolerance or duplicate SoT | Requires a separately bounded objective and proof |
| **C. Temporary incident-specific** | Keep until live consumer closed | Keep posture only |
| **D. Permanent real-world recovery** | Keep under correct canonical operation | Preserve |

---

## 10. Options disposition (historical)

| Option | Design status | Founder direction |
| --- | --- | --- |
| A — Journey Hub + thin compatibility | Proposed | Not selected |
| **B — Pristine Journey Hub** | Was `RECOMMENDED — NOT APPROVED` in design record | **Approved as architectural direction** |
| C — Dual-track incident island | Proposed | Not selected |

Draft PR #341 remains a design PR. It is **not** merged by this blueprint step.

---

## 11. Remaining Founder decisions (after this documentation step)

1. Execute the already-authorized Issue #410 Phase 7 deletion slices one coherent cluster at a time; this reconciliation is a prerequisite and does not execute Slice 1.
2. Whether **`frontend-seo`** remains in the central pack vs platform-only optional pack.
3. Whether **`structural-protection` line-count ratchet** is retired/split after decomposition goals, while retaining oracle hashes.
4. Sequencing of later Class B semantic simplification after the Phase 7 deletion slices.
5. Whether Draft PR #341 should remain open as historical design evidence, be closed without merge, or be superseded by other docs PRs.

---

## 12. Stop / non-claims

This blueprint publishes Founder-approved **Option B architectural direction** as
reconciled by Issue #410 and merged PR #420.

It does **not**:

- delete the Phase 7 facade cluster
- repair or redesign the legacy Stateful Mission Control runtime
- merge PR #341
- start Issue #333 Batch 6 / Cluster F
- close Issue #333 or Issue #340 by itself
- deploy or mutate production / retained data
