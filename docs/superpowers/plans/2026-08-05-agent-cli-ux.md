# Deterministic Agent CLI and Routing Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an incoming agent one test-enforced command and routing contract that selects exactly one supported command or an explicit non-mutation gate, exposes deterministic local help, and returns stable machine-readable Tier A results without changing Mission Control semantics.

**Architecture:** Preserve the selected hybrid approach. Add one repository-owned command-contract registry, a minimal shared invocation/result formatter, and a pure routing-table reader. Existing entrypoints keep their domain services, CAS/lease behavior, GitHub adapters, and positional forms; each facade performs the shared syntax/help preflight before constructing adapters or entering existing workflow code. `scripts/mission-control/transport-registry.mjs` remains the sole authority for Mission Control role ownership.

**Tech Stack:** Node.js 24 ESM, pnpm 9/10, Vitest 4, existing shell facades, existing GitHub CLI/adapters, Markdown generated or structurally verified from repository-owned data.

**Required inputs:**

- GitHub Issue: `https://github.com/boat1994/bemoat-web-starter/issues/276`
- Protected-base policy: `docs/mission-control/mission-control-guide.md` at commit `218f31417ca241375ba3b8f877ab40a00bd4e64b`
- Existing transport authority: `scripts/mission-control/transport-registry.mjs`
- Existing command reference: `docs/mission-control/command-reference.md`

<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-276"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#276"
branch_template: "chore/276-deterministic-agent-cli"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "218f31417ca241375ba3b8f877ab40a00bd4e64b"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: null
paired_plan: "docs/superpowers/plans/2026-08-05-agent-cli-ux.md"
```
<!-- bemoat-task-identity:end -->

## Global Constraints

- Implement only Issue #276. Do not insert another harness feature.
- Preserve Mission Control state names, transitions, review counters, role ownership, exact-head checks, Founder authority, CAS, leases, readback, retry, durable-winner behavior, and the #285 reopen contract.
- Do not create a broad CLI framework, generic executor, `next` mutation command, facade-wide refactor, state-machine redesign, transport-ownership duplicate, CAS/lease redesign, bootstrap redesign, or generalized incident recovery.
- Do not modify Campaign #215, PR #275 semantics or branch, child repositories, deployments, migrations, production, or retained data. Updating starter-owned managed-path/package-script manifests is allowed; executing child sync is not.
- Do not alter the quarantined scope of `bemoat:mission-control:recover-review` or broaden `bemoat:mission-control:reopen` beyond its merged #285 authorization tuple.
- Existing valid plain-text positional invocations remain accepted. Do not add named aliases for existing positional arguments. Duplicate singleton flags and any future positional/named conflict fail closed.
- The only compatibility tightening is the Issue #276 exact-head rule: authority-bearing SHA inputs normalize to a full 40-character lowercase SHA. Founder approval of this plan explicitly approves that bounded parser tightening; no other valid form may break.
- Help and invalid syntax complete before network access, mutation-capable adapter construction, durable reads not needed for syntax, or filesystem/GitHub mutation.
- JSON stdout contains exactly one JSON object. Diagnostics and legacy narrative go to stderr or `details`; no log line may precede/follow the JSON object on stdout.

---

## 1. Verified Protected-Base Evidence

Verified on 2026-08-06 (Asia/Bangkok) after `git fetch origin main`:

| Evidence | Verified value |
| --- | --- |
| Repository | `boat1994/bemoat-web-starter` |
| Protected base | `main` |
| `origin/main` / fetched protected-base SHA | `218f31417ca241375ba3b8f877ab40a00bd4e64b` |
| Protected-base commit subject | `Merge pull request #285 from boat1994/feature/284-founder-reopen-transport` |
| PR #285 | `MERGED`, merge commit `218f31417ca241375ba3b8f877ab40a00bd4e64b` |
| Policy source | `218f31417ca241375ba3b8f877ab40a00bd4e64b:docs/mission-control/mission-control-guide.md` |
| Policy ID/version | `bemoat-mission-control` / `1.3.0` |
| Child override at protected base | Absent: `.bemoat/mission-control-overrides.md` does not exist at the verified SHA |
| Issue #276 | `OPEN`; full body read; 49 acceptance criteria |
| PR #275 | `OPEN`, base `main`, head `feature/274-campaign-slice-task-bootstrap`; excluded from all writes |

The implementation branch must be created from this SHA only after Founder approval. Re-fetch before branch creation; if `origin/main` advances, reload policy from the new exact protected-base commit and update this evidence block before implementation.

## 2. Bounded File and Interface Map

### Create

| File | One responsibility |
| --- | --- |
| `scripts/cli/command-contract-registry.mjs` | The only authoritative command metadata and routing dataset (`schema_version: 1`). |
| `scripts/cli/command-contract.mjs` | Validate and read registry records; compare them with package scripts, state schema, and canonical transports. No process or network I/O. |
| `scripts/cli/command-invocation.mjs` | Normalize argv, short-circuit help, and return validated values or `INVALID_INVOCATION`. No domain execution. |
| `scripts/cli/command-help.mjs` | Direct no-side-effect help renderer used by the shell facade; it accepts only a registry command plus `--json` and never loads domain code. |
| `scripts/cli/command-result.mjs` | Build/validate the schema-version-1 help/result payload and map classifications to exit codes. |
| `scripts/cli/command-routing.mjs` | Resolve one pre-normalized `(observed_state, evidence_case)` route to one command/gate/stop. It never executes a command. |
| `scripts/cli/render-command-docs.mjs` | Deterministically render the command reference and agent quick-start from the registry. |
| `scripts/guard-cli-contract.mjs` | One read-only guard composing registry/package/transport/state/docs checks. |
| `docs/mission-control/agent-quick-start.md` | Generated task-oriented command selection and decision table. |
| `docs/mission-control/command-contract-maintainers.md` | Structurally checked maintainer procedure for adding/changing commands. |
| `tests/helpers/cli-boundary-harness.ts` | Child-process harness with poison executables, isolated cwd, stdout parsing, exit-code capture, and before/after filesystem snapshots. |
| `tests/int/cli-command-registry.int.spec.ts` | Inventory, Tier C exclusion, package binding, entrypoint, and transport-binding contract. |
| `tests/int/cli-invocation-contract.int.spec.ts` | Argument normalization, help permutations, envelopes, classification, and exit-code contract. |
| `tests/int/cli-tier-a-boundaries.int.spec.ts` | Child-process help/runtime JSON, adapter-construction, invalid-invocation, and mutation-boundary matrix for all Tier A commands. |
| `tests/int/cli-tier-b-boundaries.int.spec.ts` | Child-process help/invalid syntax and zero-durable-write matrix for all Tier B commands. |
| `tests/int/cli-routing-contract.int.spec.ts` | State coverage, exact-one route, STOP behavior, operation coverage, and routing semantics. |
| `tests/int/cli-documentation-contract.int.spec.ts` | Registry-to-reference/quick-start/maintainer/loader/example drift checks. |

### Modify

| File/area | Exact change |
| --- | --- |
| `scripts/mission-control-state.mjs` | Export the existing state set as immutable `MISSION_CONTROL_STATES`; do not change members. |
| Tier A facades/workflows listed in Section 4 | Add shared preflight/result adaptation while retaining domain services and side-effect order. |
| Tier B facades listed in Section 4 | Add early help/invalid-invocation handling; retain read-only runtime behavior. |
| `scripts/boilerplate/config.mjs` | Route sync/check flags through normalized values; preserve environment defaults as documented trusted-derived inputs. |
| `docs/mission-control/command-reference.md` | Replace independent prose tables with deterministic renderer output while retaining exact operational content. |
| `prompts/mission-control/chatgpt-project-loader.md` | Require route lookup, `--help --json`, Tier A `--json`, returned `next_action`, and fail-closed schema handling. |
| `scripts/boilerplate/inventory.mjs` | Add the merged reopen facade/package command and new reusable contract/docs/test paths to starter-managed rails. |
| `.bemoat/boilerplate-sync-manifest.json` | Mirror the starter inventory additions; do not run sync. |
| `scripts/guard-pack.mjs` | Run `guard-cli-contract` as a read-only guard. |
| `package.json` | Add only non-namespaced `guard:cli-contract`; do not add another `bemoat:*` command. |
| Existing focused integration tests | Add backward-compatibility and domain-classification assertions adjacent to their existing fixtures; do not replace them with one snapshot. |

### Producer/consumer order

```text
Task 1 registry + exported state enumeration
  -> Task 2 invocation/result utilities + process harness
  -> Tasks 3-7 thin entrypoint integrations
  -> Task 8 routing resolver and coverage
  -> Task 9 generated/checked docs and guard wiring
  -> Task 10 full regression, delivery, CI, independent review
```

Every task consumes only symbols created by an earlier task or in the same task.

## 3. Exact Registry, Invocation, Result, and Routing Contracts

### 3.1 Authoritative registry export

`scripts/cli/command-contract-registry.mjs` exports exactly:

```js
export const COMMAND_CONTRACT_SCHEMA_VERSION = 1
export const COMMAND_CONTRACT_REGISTRY = Object.freeze({
  schema_version: 1,
  commands: Object.freeze({ /* keyed by exact package command */ }),
  routes: Object.freeze([ /* RouteRow records */ ]),
})
```

No entrypoint may define a second help schema. It may retain a domain parser only as the consumer of `parseCommandInvocation(...).values` during migration. Help, examples, classifications, and routing copy come only from this registry.

Each command value has this exact shape:

```ts
type CommandContract = {
  schema_version: 1
  command: `bemoat:${string}`
  tier: 'A' | 'B' | 'C'
  entrypoint: string
  purpose: string
  operation: string
  accepted_pre_states: string[]
  required_inputs: InputSpec[]
  optional_flags: InputSpec[]
  caller_supplied_values: string[]
  trusted_derived_values: string[]
  required_evidence: string[]
  reads: string[]
  writes: string[]
  success_classifications: CanonicalClassification[]
  stop_classifications: CanonicalClassification[]
  stop_conditions: string[]
  retry_contract: {
    identical_retry: 'allowed' | 'forbidden' | 'conditional'
    classification: 'NO_OP_IDENTICAL_RETRY' | null
    condition: string
  }
  next_action_rules: Array<{
    classification: CanonicalClassification
    next_action: NextAction
  }>
  examples: Array<{
    description: string
    argv: string[]
  }>
  exceptional: boolean
  transport_role: string | null
  parser_owner: string | null
  delegated_executable: string | null
  help_meaningful: boolean
  safe_help_invocation: string | null
  exclusion_reason: string | null
  last_validation_before_mutation: string | null
  post_write_readback: string | null
  legacy_classification_map: Record<string, CanonicalClassification>
}

type InputSpec = {
  name: string
  syntax: string
  kind: 'positional' | 'flag' | 'environment' | 'stdin'
  value_type:
    | 'boolean'
    | 'positive_integer'
    | 'repository'
    | 'full_sha'
    | 'path'
    | 'enum'
    | 'string'
  required: boolean
  source: 'caller' | 'trusted_derived'
  multiple: false
  values: string[]
  description: string
}

type CanonicalClassification =
  | 'HELP'
  | 'SUCCESS'
  | 'NO_OP_IDENTICAL_RETRY'
  | 'INVALID_INVOCATION'
  | 'UNSUPPORTED_PRE_STATE'
  | 'STATE_CONFLICT'
  | 'AUTHORITY_CONFLICT'
  | 'HEAD_DRIFT'
  | 'BLOCKED_EXTERNAL'
  | 'EVIDENCE_CONFLICT'
  | 'AMBIGUOUS_RESULT'
  | 'INTERNAL_ERROR'
```

Registry validation rejects an absent field, extra command key, duplicate command, duplicate singleton syntax, non-v1 schema, missing entrypoint, stale `package.json` binding, unclassified `bemoat:*` script, Tier C custom parser, missing Tier C delegation rationale, inconsistent transport role/exceptional flag, or Tier A command without a route/manual-only exceptional record.

### 3.2 Invocation interface and normalization

```ts
parseCommandInvocation(
  command: string,
  argv: string[],
):
  | { mode: 'help'; format: 'text' | 'json'; contract: CommandContract }
  | { mode: 'run'; format: 'text' | 'json'; values: Record<string, string | boolean> }

class CliInvocationError extends Error {
  classification: 'INVALID_INVOCATION'
  exit_code: 2
  details: { argument: string | null; reason: string }
}
```

`resolveCommandIdentity({ fallback, env, entrypoint })` uses the explicit facade fallback for direct Node execution. When pnpm supplies `npm_lifecycle_event`, it accepts that value only if it is a registered command whose `entrypoint` equals the running facade. This is required for the shared `scripts/guard-pack.mjs` facade to distinguish `bemoat:guard:pack` from `bemoat:guard:safety`; a mismatched lifecycle value is `INVALID_INVOCATION`, not trusted input.

Normalization rules:

- Strip only pnpm's separator token `--`; never discard any other token.
- Detect `--help`/`-h` and `--json` order-independently before required-input validation. The four Tier A JSON-help permutations return byte-identical parsed JSON.
- Help wins over every normal validation path but still rejects duplicate help or duplicate `--json` flags as `INVALID_INVOCATION`.
- Unknown flags, missing values, duplicate singleton flags, multiple positional values, and documented mutually exclusive sources fail with exit 2 before adapter creation.
- Positive integers match `^[1-9]\d*$`; reject zero, signs, decimals, whitespace-only values, suffixes, and coercion outside JavaScript's safe integer range. Preserve comment IDs as canonical decimal strings.
- Repository values match one `owner/repo` form and normalize to lowercase `owner/repo` without accepting URLs or inferred current-repository prose. A documented trusted-derived current repository remains allowed only for commands that already support it.
- Authority-bearing SHAs match `^[0-9a-f]{40}$`. No short or uppercase JSON value is emitted.
- Existing issue-number positionals remain positional. Do not add `--issue`; therefore no ambiguous precedence is introduced.
- `--body-file` and stdin remain mutually exclusive. Environment defaults for boilerplate repo/ref/mode and GitHub Actions bootstrap identity are recorded as trusted-derived; caller values are never reclassified as trusted-derived.

Tier A text help contains these sections in this exact order: `NAME`, `PURPOSE`, `USAGE`, `ACCEPTED PRE-STATE`, `REQUIRED INPUTS`, `OPTIONAL FLAGS`, `AUTHORITY AND TRUST BOUNDARY`, `READS`, `WRITES`, `RESULT CLASSIFICATIONS`, `EXIT CODES`, `RETRY CONTRACT`, `NEXT ACTIONS`, `STOP CONDITIONS`, `EXAMPLES`, `SAFE RECOVERY`. Tier B uses this exact order: `NAME`, `PURPOSE`, `USAGE`, `PRECONDITIONS`, `REQUIRED INPUTS`, `OPTIONAL FLAGS`, `READS`, `WRITES`, `RESULT CLASSIFICATIONS`, `EXIT CODES`, `RETRY CONTRACT`, `NEXT ACTIONS`, `STOP CONDITIONS`, `EXAMPLES`, `SAFE RECOVERY`; it always renders `WRITES: none`. Every help payload names the exact package command and direct entrypoint.

### 3.3 Canonical classifications and exit codes

```js
export const CLI_EXIT_CODES = Object.freeze({
  HELP: 0,
  SUCCESS: 0,
  NO_OP_IDENTICAL_RETRY: 0,
  INTERNAL_ERROR: 1,
  INVALID_INVOCATION: 2,
  UNSUPPORTED_PRE_STATE: 3,
  STATE_CONFLICT: 3,
  AUTHORITY_CONFLICT: 3,
  HEAD_DRIFT: 3,
  BLOCKED_EXTERNAL: 3,
  EVIDENCE_CONFLICT: 3,
  AMBIGUOUS_RESULT: 4,
})
```

Legacy domain outcomes are retained under `details.legacy_classification` and deliberately mapped as follows: successful mutation outcomes (`DISPATCHED*`, `REVIEWED`, `REOPENED`, `RECOVERED`, `RECONCILED`, `BOOKKEEPING_REPAIR`, `TERMINAL_REPAIR`, `DETERMINISTIC_MIGRATION`, `DONE`, `CREATED`, `POSTED`, `SYNCED`, `INSTALLED`) -> `SUCCESS`; proven identical winners (`NO_OP`, `ALREADY_*`) -> `NO_OP_IDENTICAL_RETRY`; parser/usage failures -> `INVALID_INVOCATION`; pre-state mismatch -> `UNSUPPORTED_PRE_STATE`; authority/head/evidence conflicts -> their named code; `RECOVERABLE_ROUTING_DRIFT` or an unproved partial write -> `AMBIGUOUS_RESULT`; unexpected exceptions only -> `INTERNAL_ERROR`. Each command registry record lists only the legacy tokens it can actually emit, and focused tests reject an unmapped token.

Plain-text success keeps the existing narrative after a canonical prefix, for example `SUCCESS: <existing message>`. Plain-text errors begin with the same canonical classification as JSON mode.

### 3.4 Help JSON and runtime result envelope

Tier A help is the Issue #276 shape, with exactly these keys:

```json
{
  "schema_version": 1,
  "command": "bemoat:...",
  "mode": "help",
  "classification": "HELP",
  "tier": "A",
  "purpose": "...",
  "accepted_pre_states": [],
  "required_inputs": [],
  "optional_flags": [],
  "caller_supplied_values": [],
  "trusted_derived_values": [],
  "required_evidence": [],
  "reads": [],
  "writes": [],
  "retry_contract": {},
  "result_classifications": [],
  "next_action_rules": [],
  "stop_conditions": [],
  "examples": []
}
```

Every Tier A terminal path uses:

```ts
type ResultEnvelopeV1 = {
  schema_version: 1
  command: `bemoat:${string}`
  mode: 'result'
  outcome: 'SUCCESS' | 'NO_OP' | 'STOP' | 'ERROR'
  classification: Exclude<CanonicalClassification, 'HELP'>
  mutation_performed: boolean
  observed_pre_state: string | null
  resulting_state: string | null
  repository: string | null
  issue_number: string | null
  pr_number: string | null
  exact_head: string | null
  evidence_ids: Record<string, string>
  next_action: NextAction
  details: Record<string, unknown>
}

type NextAction = {
  type: 'COMMAND' | 'FOUNDER_GATE' | 'STOP' | 'COMPLETE'
  command: `bemoat:${string}` | null
  reason: string
}
```

`details` is always present and is the only extension point. Inapplicable common fields are `null`/empty but never omitted or type-changed. `assertResultEnvelopeV1` rejects aliases and a `COMMAND` next action whose command is absent from the registry.

### 3.5 Routing row and uniqueness contract

```ts
type RouteRow = {
  route_key: string
  observed_state: string | null | 'NOT_STATEFUL'
  evidence_case: string
  required_evidence_condition: string
  forbidden_evidence_condition: string
  permitted_operation: string | null
  canonical_command: `bemoat:${string}` | null
  required_review_type: 'full' | 'delta' | 'blocker-verification' | null
  expected_post_state_or_gate: string
  prohibited_commands: Array<`bemoat:${string}`>
  decision: 'COMMAND' | 'FOUNDER_GATE' | 'COMPLETE' | 'STOP'
  stop_condition: string | null
}
```

`resolveCommandRoute({ observed_state, evidence_case })` performs an exact lookup only. The registry validator rejects duplicate `route_key` or duplicate `(observed_state, evidence_case)`. An unknown state, unknown evidence case, malformed/stale/superseded/duplicated/competing evidence, or zero/multiple matches returns one synthesized `STOP` result with `STATE_CONFLICT`; it never selects a fallback command.

Required route families in the registry:

| State/evidence case | Exactly one decision |
| --- | --- |
| No Task state + exact task-bootstrap Founder authorization/workflow tuple | `bemoat:mission-control:task-bootstrap` |
| `READY` + valid HANDOFF inputs | `bemoat:mission-control:dispatch` |
| `IN_PROGRESS` + complete exact-head delivery evidence | `bemoat:agent:delivery` |
| `AWAITING_REVIEW_1` + exact full-review evidence | `bemoat:mission-control:review` (`full`) |
| `CORRECTION_REQUIRED_1` + bounded correction RESULT evidence | `bemoat:agent:delivery` -> `AWAITING_REVIEW_2` |
| `AWAITING_REVIEW_2` + exact delta-review evidence | `bemoat:mission-control:review` (`delta`) |
| `CORRECTION_REQUIRED_2` + bounded correction RESULT evidence | `bemoat:agent:delivery` -> `AWAITING_REVIEW_3` |
| `AWAITING_REVIEW_3` + exact bounded review evidence | `bemoat:mission-control:review` (`delta`/`blocker-verification`) |
| `FOUNDER_AUTHORIZED_CORRECTION` + unconsumed exact authorization | `bemoat:mission-control:dispatch --founder-correction` |
| `BLOCKED_FOR_FOUNDER_DECISION` without the exact named authorization | `FOUNDER_GATE — no agent mutation` |
| `ELIGIBLE_FOR_FOUNDER_REVIEW` without merge authorization | `FOUNDER_GATE — no agent mutation` |
| `ELIGIBLE_FOR_FOUNDER_REVIEW` + exact merge authorization/current reviewed head | `bemoat:mission-control:merge` |
| `ELIGIBLE_FOR_FOUNDER_REVIEW` + complete Founder-authorized old/new-head tuple | `bemoat:mission-control:reopen` only |
| Any state + unauthorized head drift | `STOP` |
| Any state + proven routing-only projection drift after failed canonical transport | `bemoat:mission-control:reconcile` only |
| Exact quarantined #274/#275 incident tuple | `bemoat:mission-control:recover-review` only |
| `DONE` + exact identical merge-completion retry evidence | `bemoat:mission-control:merge` -> `NO_OP_IDENTICAL_RETRY` |
| `DONE` without retry request | `COMPLETE` |
| `BLOCKED_EXTERNAL`, `STATE_CONFLICT`, or unresolved `STATE_MIGRATION_REQUIRED` | `STOP` |
| Any state + malformed/stale/superseded/duplicated/competing/ambiguous/unknown evidence | `STOP` |
| `NOT_STATEFUL` + explicit FAST/unmanaged role-comment operation | `bemoat:issue:comment` |
| `NOT_STATEFUL` + explicitly authorized starter/child sync operation | `bemoat:boilerplate:sync` |
| `NOT_STATEFUL` + explicit local hook-install operation | `bemoat:hooks:install` |

The 14 values exported by `MISSION_CONTROL_STATES` must each occur in at least one explicit registry row. `recover-review` remains `exceptional: true`; every other `CANONICAL_TRANSPORTS` binding must match its existing role and `exceptional` value byte-for-byte.

## 4. Final Command-Tier Inventory (22/22)

| Command | Tier | Parser owner and accepted runtime inputs | Runtime read boundary | Durable write boundary | Classification reason and exact proof test |
| --- | --- | --- | --- | --- | --- |
| `bemoat:agent:delivery` | A | `scripts/agent-delivery.mjs`; Issue positional; `--repo`, `--body-file` or stdin | local HEAD/branch; PR/head/CI; Issue/state/comments | RESULT comment; leased/CAS Issue state projection | Authority-bearing delivery. `cli-tier-a-boundaries`: help/invalid zero-I/O; fixture runtime JSON and readback. |
| `bemoat:agent:issue` | B | `scripts/agent-issue/cli-args.mjs`; Issue positional; optional `--phase correction` | local git/files; GitHub Issue/comments/PR/checks | none | Merged policy explicitly declares it read-only. `cli-tier-b-boundaries`: poison writers and before/after snapshot stay untouched. |
| `bemoat:boilerplate:check` | B | `scripts/boilerplate/config.mjs`; `--harness-only` or `--full`; trusted `BEMOAT_SYNC_MODE` | repository files/config; upstream git clone/network | no durable target write; `.bemoat-check-tmp` is removed on success/failure | Inspection only. Test proves target tree identical and temp path absent after fixture run. |
| `bemoat:boilerplate:sync` | A | `scripts/boilerplate/config.mjs`; sync mode; `--apply-build-contract`; transition-gate flags; documented env defaults | source/target files, git, upstream clone, transition evidence | managed/seed/merge-keep files, package proposal, metadata, stash/commit | Durable repository mutation. Existing filesystem/workflow suites plus Tier A help/invalid tests prove boundary. |
| `bemoat:branch:check` | B | `scripts/check-branch-safety.sh`; no runtime inputs | current git branch and opt-in environment | none | Read-only validation. Child-process help must bypass `git`; runtime fixtures prove no ref/config write. |
| `bemoat:check` | C | package pipeline; no repository parser | delegated guards, ESLint, TypeScript, Vitest reads | none by contract | Wrapper around registered validation/tasks. `cli-command-registry`: exact delegation string and no custom argv parser; safe help alternatives listed. |
| `bemoat:guard:cloudflare-env` | B | `scripts/guard-cloudflare-env.mjs`; no runtime inputs | env and `wrangler.jsonc` | none | Read-only guard; existing `cloudflare-env-guard` plus Tier B boundary test. |
| `bemoat:guard:harness-contract` | B | `scripts/guard-harness-contract.mjs`; no runtime inputs | managed manifest and harness files | none | Read-only guard; existing harness-contract tests plus Tier B boundary test. |
| `bemoat:guard:mission-control-contract` | B | `scripts/guard-mission-control-contract.mjs`; no runtime inputs | policy/docs/scripts/manifest | none | Read-only guard; existing MC guard tests plus Tier B boundary test. |
| `bemoat:guard:pack` | B | `scripts/guard-pack.mjs`; no runtime inputs | repository guard inputs | none | Read-only aggregate guard; `guard-pack` and Tier B boundary tests. |
| `bemoat:guard:safety` | B | same `scripts/guard-pack.mjs` entrypoint; no runtime inputs | repository guard inputs | none | Exact package alias, classified separately. Registry/package test proves same entrypoint without collapsing command identity. |
| `bemoat:hooks:install` | A | `scripts/install-git-hooks.mjs`; no runtime inputs | `.githooks` existence; git config | chmod hook files; `core.hooksPath` | Durable local-repository mutation. Tier A fixture proves help/invalid do not chmod/configure and valid run does only documented writes. |
| `bemoat:issue:comment` | A | `scripts/post-role-comment.mjs`; Issue positional; `--repo`, `--body-file`/stdin, `--check`, `--allow-warning` | body file/stdin; Issue comments/correction evidence | Issue role comment unless `--check` | Canonical durable comment transport for its documented non-owned cases. Existing comment suite plus Tier A JSON/write tests. |
| `bemoat:mission-control:dispatch` | A | `scripts/mission-control-dispatch.mjs`; Issue positional; `--repo`, `--body-file`, `--founder-correction`, `--workflow-mode`, `--planning-base-sha` | Issue/state/comments/PR; body file; branch reservation evidence | HANDOFF comment, Issue state, temporary reservation ref with cleanup | Registered `HANDOFF` transport. Registry-to-transport and fixture mutation/readback tests. |
| `bemoat:mission-control:merge` | A | `scripts/mission-control-merge.mjs`; Issue positional; `--repo`, `--authorization-comment` | Founder authorization, Task/PR/comments/checks/base/policy/campaign | ready/merge, RESULT comment, Issue close/state, campaign projection | Registered `MERGE` transport. Existing merge suite plus JSON/exit/partial-write mapping tests. |
| `bemoat:mission-control:reconcile` | A | `scripts/mission-control-reconcile.mjs`; Issue positional; optional `--repo` | Task/PR/comments/state/terminal evidence | routing-only Issue state projection via lease/CAS | Registered `STATE_PROJECTION`; never owns ordinary delivery/review/reopen. Existing suite plus route quarantine tests. |
| `bemoat:mission-control:recover-review` | A | `scripts/mission-control/workflows/recover-review.mjs`; exact #274/#275 positional/flags/body file | pinned policy/source/checkout, Task/PR/comments/checks | one quarantined REVIEW_VERDICT comment and state projection | Registered exceptional recovery only. Exact tuple and ordinary-review rejection tests. |
| `bemoat:mission-control:reopen` | A | `scripts/mission-control/workflows/reopen.mjs`; Issue positional; exact repo/PR/base/state/old-head/new-head/counters/authorization flags | Founder authorization, Task/PR/comments/policy/head | state projection to `FOUNDER_AUTHORIZED_CORRECTION` | Registered merged #285 reopen route. Existing #285 suite plus JSON/route/managed-script binding tests. |
| `bemoat:mission-control:review` | A | `scripts/mission-control-review.mjs`; Issue positional; body file, expected state/type/full SHA, optional repo | verdict body, Task/PR/comments/checks | REVIEW_VERDICT comment and Issue state/counters via lease/CAS | Registered ordinary `REVIEW_VERDICT` owner. Existing review suites plus JSON/full-vs-delta route tests. |
| `bemoat:mission-control:task-bootstrap` | A | `scripts/mission-control-task-create.mjs`; `--founder-authorization-comment-id`; trusted Actions env | signed authorization, workflow identity, public key, GitHub campaign/PR | Task Issue creation/state/attestation and campaign projection | Durable authority-bearing bootstrap. Existing bootstrap tests plus adapter-construction/help test. |
| `bemoat:test:int` | C | `cross-env ... vitest run`; no repository parser | source/test/config files | none by contract | Third-party wrapper. Safe help: `pnpm exec vitest --help`; registry test proves exact delegation and no hidden custom parser. |
| `bemoat:typecheck` | C | `scripts/bemoat-typecheck.mjs`; intentionally consumes no argv | toolchain contract and TS projects | none (`tsc --noEmit`) | Bounded custom wrapper, not a parser. Safe help: `pnpm exec tsc --help`; test proves argv is ignored and no mutation/network API exists. |

Tier totals are exactly A=11, B=8, C=3. Any package change that alters the 22-command set must update the registry, docs, tests, and managed package-script rails in the same commit or fail the guard.

## 5. Requirement-to-Task and Test Matrix

### Material requirement coverage

| Requirement | Implementation task | Exact primary test |
| --- | --- | --- |
| One authoritative schema-v1 command registry; every command classified; Tier A/B/C and exclusions | Task 1 | `cli-command-registry.int.spec.ts` — `classifies the exact 22-command package inventory once` |
| `CANONICAL_TRANSPORTS` compatibility without ownership duplication | Task 1 | `...` — `matches every registered role and exceptional bit` |
| Merged `reopen` command and child-managed binding | Tasks 1, 6 | `...` — `binds reopen facade, workflow, package script, and managed rails` |
| `--help`, `-h`, ordered JSON-help permutations | Tasks 2-7 | `cli-invocation-contract...` — `normalizes all Tier A help permutations`; Tier A/B matrix tests |
| Tier A runtime JSON and one-object stdout | Tasks 2, 4-7 | `cli-tier-a-boundaries...` — `parses exact JSON stdout for every terminal fixture` |
| Stable v1 result envelope, classifications, and exits | Task 2 plus per-command tasks | `cli-invocation-contract...` — `validates envelope keys/types and classification exit map` |
| Argument normalization and no ambiguous positional/named precedence | Task 2 | `...` — `rejects malformed/duplicate/conflicting values before execute` |
| Help no network/no write/no adapter construction | Tasks 2-7 | Tier A/B child-process matrices using `cli-boundary-harness.ts` |
| Invalid invocation early exit | Tasks 2-7 | Tier A/B matrices — `returns exit 2 before durable read or adapter factory` |
| Deterministic routing, 100% managed-state coverage, exact-one uniqueness | Task 8 | `cli-routing-contract...` — state enumeration, duplicate route, unknown evidence tests |
| Agent execution protocol and exact next action/STOP/Founder gate | Tasks 8-9 | routing tests plus `cli-documentation-contract...` loader assertions |
| Generated/verified reference, quick-start, maintainer contract | Task 9 | `cli-documentation-contract...` — renderer equality and required decision columns |
| Package/registry/parser/docs/examples drift prevention | Tasks 1, 2, 9 | registry and documentation contract suites; `guard-cli-contract` |
| Backward-compatible plain text and deliberate legacy mapping | Tasks 3-7 | existing per-command suites plus Tier A classification parity table |
| Actual child-process, adapter, filesystem, stdout, and exit boundaries | Tasks 2-7 | `cli-boundary-harness.ts` matrices; no primary oversized snapshot |
| Regression, exact-head CI, Independent Review 1, no PR #275 semantic change | Task 10 | full command list in Task 10 and exact-head GitHub checks |

### Acceptance criteria audit mapping

| AC | Task(s) | Exact evidence/test |
| --- | --- | --- |
| AC-01 | 1 | exact 22-key set and one tier per key |
| AC-02 | 1 | Tier C delegated-executable/no-parser scan |
| AC-03 | 1 | single registry export and schema version test |
| AC-04 | 1 | registry references, never re-exports ownership; transport equality test |
| AC-05 | 1, 9 | missing/duplicate/stale/role/exceptional/package mutation table tests |
| AC-06 | 3-7 | Tier A/B `--help` and `-h` child processes exit 0 |
| AC-07 | 3-7 | no args/secrets/auth plus poison `gh`/`git`/`pnpm` PATH |
| AC-08 | 3-7 | adapter-factory spies and filesystem before/after snapshots |
| AC-09 | 2, 4-7 | Tier A section-order assertion |
| AC-10 | 1-7 | registry/parser accepted-token equality |
| AC-11 | 4-7 | every Tier A `examples[].argv` parses to preflight fixture |
| AC-12 | 2, 4-7 | Tier A terminal matrix parses exactly one stdout JSON object |
| AC-13 | 2 | four help/JSON permutations deep-equal |
| AC-14 | 2, 4-7 | `assertResultEnvelopeV1` on every terminal class |
| AC-15 | 4-7 | paired plain/JSON fixture classification equality |
| AC-16 | 2 | extra command fields rejected outside `details` |
| AC-17 | 2, 4-7 | exit-0 HELP/SUCCESS/NO_OP table |
| AC-18 | 2-7 | exit-2 invalid matrix with zero I/O |
| AC-19 | 2, 4-7 | six safe-stop classifications exit 3 |
| AC-20 | 2, 4-7 | partial/unproved outcome maps to exit-4 AMBIGUOUS_RESULT |
| AC-21 | 2, 4-7 | unexpected injected exception maps to exit-1 INTERNAL_ERROR |
| AC-22 | 2, 4-7 | plain terminal error prefix parity |
| AC-23 | 1, 8 | every exported `MISSION_CONTROL_STATES` member occurs in routes |
| AC-24 | 8 | supported tuple table returns one decision |
| AC-25 | 8 | duplicate tuple fixture is rejected |
| AC-26 | 8, 9 | Founder-gate rows have null command and explicit no-mutation text |
| AC-27 | 8 | malformed/stale/superseded/duplicate/competing/ambiguous fixtures STOP |
| AC-28 | 1, 8 | full/delta routes select ordinary review only |
| AC-29 | 1, 6, 8 | recover-review exact incident tuple and exceptional quarantine |
| AC-30 | 1, 6, 8 | reopen exact old/new-head Founder tuple only |
| AC-31 | 7, 8 | reconcile only routing-projection-drift fixtures |
| AC-32 | 6-8 | standalone fixture has zero campaign calls; campaign fixture retains checks |
| AC-33 | 2 | integer/repository/SHA/comment-ID table normalization |
| AC-34 | 2-7 | duplicate singleton and positional-conflict rejection |
| AC-35 | 1, 2 | registry source attribution and no prose inference test |
| AC-36 | 1, 2 | trusted-derived defaults allowlist test |
| AC-37 | 8, 9 | loader route-before-mutation structural assertion |
| AC-38 | 9 | loader requires first-use `--help --json` |
| AC-39 | 2, 9 | loader requires Tier A `--json` and returned `next_action` |
| AC-40 | 8, 9 | raw mutation prohibition in quick-start/loader and route ownership tests |
| AC-41 | 2, 8, 9 | malformed JSON/schema/disagreement -> STATE_CONFLICT STOP fixtures |
| AC-42 | 9 | renderer equality and structural maintainer guard |
| AC-43 | 2-7 | complete Tier A/B no-network/no-write matrix |
| AC-44 | 10 | existing exact-head/Founder/CAS/lease/readback/retry suites |
| AC-45 | 1, 8, 10 | state enum frozen-members test plus existing transition suites |
| AC-46 | 2-7, 10 | legacy positional/plain-text fixtures; bounded exact-head exception documented |
| AC-47 | all, 10 | prohibited-scope diff scan and no deployment/sync commands run |
| AC-48 | 10 | safety, focused tests, full check, diff check, exact-head CI checks |
| AC-49 | 10 | independent Full Semantic Review 1 at exact PR head |

## 6. Implementation Tasks

### Task 1: Freeze the complete registry, tiers, transport bindings, and managed reopen rails

**Files:**

- Create: `scripts/cli/command-contract-registry.mjs`
- Create: `scripts/cli/command-contract.mjs`
- Create: `tests/int/cli-command-registry.int.spec.ts`
- Modify: `scripts/mission-control-state.mjs` at the existing `missionControlStates` declaration/export
- Modify: `scripts/boilerplate/inventory.mjs` at `managedPaths` and `managedPackageScripts`
- Modify: `.bemoat/boilerplate-sync-manifest.json` at `managedPaths` and `managedPackageScripts`

**Interfaces:**

- Produces: `COMMAND_CONTRACT_SCHEMA_VERSION`, `COMMAND_CONTRACT_REGISTRY`, `getCommandContract(command)`, `validateCommandContractRegistry({ registry, packageJson, transports, states })`, and immutable `MISSION_CONTROL_STATES`.
- Consumes: `CANONICAL_TRANSPORTS` as the authority; it does not redefine its owner/role semantics.

- [x] **Step 1: Write the failing inventory/transport tests**

  Add exact tests named `classifies the exact 22-command package inventory once`, `uses tier totals A=11 B=8 C=3`, `requires every schema-v1 command field and existing entrypoint`, `proves Tier C delegates without a repository parser`, `matches package scripts byte-for-byte`, `matches every canonical transport role and exceptional bit`, `gives every Tier A command one route or explicit exceptional record`, `exports the unchanged 14-state schema`, and `binds reopen facade workflow package script and managed rails`. Mutate an in-memory registry once per rejection case instead of using a monolithic snapshot.

- [x] **Step 2: Run the focused test and verify failure**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-command-registry.int.spec.ts`

  Expected: FAIL because the registry/reader exports do not exist and merged reopen is absent from `managedPackageScripts`/explicit facade paths.

- [x] **Step 3: Implement the exact Section 3 schema and Section 4 inventory**

  Export the existing 14 state values without changing them. Populate all 22 command records, all required route rows from Section 3.5, exact input/source/read/write/retry fields, Tier C exclusions, and per-command legacy mappings. Add the root reopen facade and package name to starter-managed rails; do not run sync.

- [x] **Step 4: Run the focused test and verify pass**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-command-registry.int.spec.ts tests/int/mission-control-reopen.int.spec.ts tests/int/mission-control-child-portability.int.spec.ts`

  Expected: PASS; output reports 22 classified commands (11/8/3), seven canonical transport bindings, 14 states, and managed reopen coverage.

- [x] **Step 5: Commit the independently reviewable registry**

  ```bash
  git add scripts/cli/command-contract-registry.mjs scripts/cli/command-contract.mjs scripts/mission-control-state.mjs scripts/boilerplate/inventory.mjs .bemoat/boilerplate-sync-manifest.json tests/int/cli-command-registry.int.spec.ts
  git commit -m "feat: define canonical agent command registry"
  ```

- [x] **Lead acceptance:** `TASK ACCEPTED` at exact head `1a5ca67cc2d500099699adf2d77b3ca228387ba3`; final Task 1 delta reviewed, with 7 related test files and 245 tests passing.

### Task 2: Add the minimal invocation/result boundary and real process harness

**Files:**

- Create: `scripts/cli/command-invocation.mjs`
- Create: `scripts/cli/command-help.mjs`
- Create: `scripts/cli/command-result.mjs`
- Create: `tests/helpers/cli-boundary-harness.ts`
- Create: `tests/int/cli-invocation-contract.int.spec.ts`

**Interfaces:**

- Consumes: `getCommandContract(command)` from Task 1.
- Produces: `resolveCommandIdentity`, `parseCommandInvocation`, `CliInvocationError`, `formatTextHelp`, `createHelpEnvelopeV1`, `createResultEnvelopeV1`, `assertResultEnvelopeV1`, `classificationExitCode`, direct `command-help.mjs`, and test helper `runCliBoundaryCase`.

- [x] **Step 1: Write the failing normalization/envelope tests**

  Add exact Vitest cases named `normalizes all four Tier A JSON-help permutations`, `renders Tier A and Tier B sections in contract order`, `normalizes positive integers repositories and full lowercase SHAs without lossy coercion`, `rejects duplicate singleton unknown missing and conflicting inputs before execute`, `accepts npm_lifecycle_event only when its registry entrypoint matches`, `validates the exact v1 help and result key/type sets`, `rejects command data outside details`, `maps every canonical classification to one exit code`, and `emits one JSON object with plain-text classification parity`. The process helper creates an isolated cwd, installs poison `gh`/`git`/`pnpm` executables, snapshots all files/modes, spawns the real facade, and compares the snapshot after exit.

- [x] **Step 2: Run and verify failure**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-invocation-contract.int.spec.ts`

  Expected: FAIL with missing `command-invocation.mjs`, `command-result.mjs`, and `cli-boundary-harness.ts` exports.

- [x] **Step 3: Implement only parsing, formatting, validation, and test support**

  Do not import GitHub adapters or execute domain work. Return values/errors; do not call `process.exit` inside library functions. Keep process exit decisions in thin facades so tests can exercise all terminal classes. `command-help.mjs` may set `process.exitCode` after rendering but must not import a Tier A/B facade.

- [x] **Step 4: Run and verify pass**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-invocation-contract.int.spec.ts`

  Expected: PASS for every normalization row, four help permutations, envelope mutation fixture, and exit mapping.

- [x] **Step 5: Commit**

  ```bash
  git add scripts/cli/command-invocation.mjs scripts/cli/command-help.mjs scripts/cli/command-result.mjs tests/helpers/cli-boundary-harness.ts tests/int/cli-invocation-contract.int.spec.ts
  git commit -m "feat: add bounded CLI invocation and result contracts"
  ```

- [x] **Lead acceptance:** `TASK ACCEPTED` at exact head `fe743b0383a5ca7fbce1ec1dbc1469cef7a81c5c`; aggregate check passed with 57 test files and 1,222 tests.

### Task 3: Normalize all Tier B read-only entrypoints

**Files:**

- Create: `tests/int/cli-tier-b-boundaries.int.spec.ts`
- Modify: `scripts/agent-issue.mjs`
- Modify: `scripts/agent-issue/cli-args.mjs`
- Modify: `scripts/check-boilerplate-drift.mjs`
- Modify: `scripts/boilerplate/config.mjs` at `parseSyncMode`
- Modify: `scripts/check-branch-safety.sh`
- Modify: `scripts/guard-cloudflare-env.mjs`
- Modify: `scripts/guard-harness-contract.mjs`
- Modify: `scripts/guard-mission-control-contract.mjs`
- Modify: `scripts/guard-pack.mjs`
- Modify focused existing tests: `tests/int/agent-issue.int.spec.ts`, `tests/int/boilerplate-sync.int.spec.ts`, `tests/int/branch-safety.int.spec.ts`, `tests/int/cloudflare-env-guard.int.spec.ts`, `tests/int/harness-contract-guard.int.spec.ts`, `tests/int/mission-control-contract.int.spec.ts`, `tests/int/guard-pack.int.spec.ts`

**Interfaces:**

- Consumes: Task 2 invocation/help functions.
- Produces: early Tier B help and canonical invalid-invocation behavior; runtime outputs remain their current read-only formats unless the registry declares a domain JSON result.

- [ ] **Step 1: Write the failing Tier B matrix**

  Add parameterized exact tests named `Tier B %s --help and -h exit zero without I/O`, `Tier B %s rejects invalid invocation with exit two before I/O`, and `Tier B %s help names the exact lifecycle command and entrypoint` for all eight commands. Add `boilerplate check removes transient storage and preserves the target on success and clone failure`. Assert execution from repository root and isolated cwd; semantic equality; required sections; no poison executable call; no adapter factory; and no file/mode change.

- [ ] **Step 2: Run and verify failure**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-b-boundaries.int.spec.ts`

  Expected: FAIL because seven JS facades and the branch shell enter normal execution or reject help as an ordinary argument.

- [ ] **Step 3: Add the smallest facade preflight**

  Each JS `main` resolves its validated command identity and calls `parseCommandInvocation` before any runtime reads. The shell facade recognizes only `--help`/`-h` and delegates rendering to `node scripts/cli/command-help.mjs bemoat:branch:check`; its normal branch logic remains byte-for-byte below that gate. `bemoat:agent:issue` retains its Issue positional and correction phase. Sync-mode parsing consumes normalized values and rejects simultaneous `--harness-only`/`--full` rather than last-wins.

- [ ] **Step 4: Run focused and existing tests**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-b-boundaries.int.spec.ts tests/int/agent-issue.int.spec.ts tests/int/boilerplate-sync.int.spec.ts tests/int/branch-safety.int.spec.ts tests/int/cloudflare-env-guard.int.spec.ts tests/int/harness-contract-guard.int.spec.ts tests/int/mission-control-contract.int.spec.ts tests/int/guard-pack.int.spec.ts`

  Expected: PASS; all eight help rows are zero-I/O, invalid rows exit 2, and existing valid read-only behavior is unchanged.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/agent-issue.mjs scripts/agent-issue/cli-args.mjs scripts/check-boilerplate-drift.mjs scripts/boilerplate/config.mjs scripts/check-branch-safety.sh scripts/guard-cloudflare-env.mjs scripts/guard-harness-contract.mjs scripts/guard-mission-control-contract.mjs scripts/guard-pack.mjs tests/int/cli-tier-b-boundaries.int.spec.ts tests/int/agent-issue.int.spec.ts tests/int/boilerplate-sync.int.spec.ts tests/int/branch-safety.int.spec.ts tests/int/cloudflare-env-guard.int.spec.ts tests/int/harness-contract-guard.int.spec.ts tests/int/mission-control-contract.int.spec.ts tests/int/guard-pack.int.spec.ts
  git commit -m "feat: add deterministic help to read-only commands"
  ```

### Task 4: Normalize durable repository setup/sync commands

**Files:**

- Create: `tests/int/cli-tier-a-boundaries.int.spec.ts` with the shared Tier A table and sync/hooks cases
- Modify: `scripts/sync-boilerplate.mjs`
- Modify: `scripts/boilerplate/config.mjs` at `parseApplyBuildContract`
- Modify: `scripts/boilerplate/workflow.mjs` at `createBoilerplateSyncWorkflow().run`
- Modify: `scripts/install-git-hooks.mjs`
- Modify focused existing tests: `tests/int/boilerplate-sync-workflow.int.spec.ts`, `tests/int/boilerplate-sync-filesystem.int.spec.ts`, `tests/int/boilerplate-sync-git.int.spec.ts`, `tests/int/branch-safety.int.spec.ts`

**Interfaces:**

- Consumes: Task 2 invocation/result functions.
- Produces: Tier A help/JSON envelope integration for `boilerplate:sync` and `hooks:install`; existing workflow functions return structured domain results to the facade instead of owning stdout.

- [ ] **Step 1: Write failing child-process and injected-runtime cases**

  Add exact tests named `boilerplate sync and hooks expose equivalent text help`, `boilerplate sync and hooks normalize all JSON-help permutations`, `boilerplate sync and hooks help and invalid syntax perform zero I/O`, `boilerplate sync JSON writes only the documented allowlist`, `hooks install JSON changes only hook modes and core.hooksPath`, and `repository mutation begins only after the final preflight`. Preserve existing plain-text fixture assertions with canonical prefixes.

- [ ] **Step 2: Run and verify failure**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-a-boundaries.int.spec.ts -t "boilerplate sync|hooks install"`

  Expected: FAIL because both commands lack common JSON help/result behavior and construct mutation paths before shared validation.

- [ ] **Step 3: Implement thin facade adaptation**

  Parse before creating `workflow` or calling `chmodSync`/`git config`. Return a domain result from the existing sync workflow; map it in the facade. Do not change stash, commit, gate, or managed-path semantics.

- [ ] **Step 4: Run focused and regression tests**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/boilerplate-sync-workflow.int.spec.ts tests/int/boilerplate-sync-filesystem.int.spec.ts tests/int/boilerplate-sync-git.int.spec.ts tests/int/branch-safety.int.spec.ts`

  Expected: PASS; valid fixture writes remain exactly allowlisted, and help/invalid rows perform none.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/sync-boilerplate.mjs scripts/boilerplate/config.mjs scripts/boilerplate/workflow.mjs scripts/install-git-hooks.mjs tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/boilerplate-sync-workflow.int.spec.ts tests/int/boilerplate-sync-filesystem.int.spec.ts tests/int/boilerplate-sync-git.int.spec.ts tests/int/branch-safety.int.spec.ts
  git commit -m "feat: contract durable repository setup commands"
  ```

### Task 5: Normalize role comment, dispatch, delivery, and ordinary review transports

**Files:**

- Modify: `scripts/post-role-comment.mjs`
- Modify: `scripts/mission-control-dispatch.mjs`
- Modify: `scripts/agent-delivery.mjs`
- Modify: `scripts/mission-control-review.mjs`
- Modify: `tests/int/cli-tier-a-boundaries.int.spec.ts`
- Modify focused existing tests: `tests/int/post-role-comment.int.spec.ts`, `tests/int/mission-control-characterization.int.spec.ts`, `tests/int/agent-delivery.int.spec.ts`, `tests/int/mission-control-review-cli.int.spec.ts`, `tests/int/mission-control-review.int.spec.ts`

**Interfaces:**

- Consumes: Tasks 1-2 contracts and existing `Coordinator`/CAS/lease/domain functions.
- Produces: structured terminal results from four facades with legacy outcomes under `details.legacy_classification`.

- [ ] **Step 1: Add failing per-command matrices**

  Add parameterized tests named `Tier A %s help forms exit zero without network write or adapter construction`, `Tier A %s registry examples reach the documented preflight`, `Tier A %s invalid syntax exits two before durable reads`, `Tier A %s emits one v1 result object with the expected exit`, and `Tier A %s plain and JSON modes share one classification`. Apply them to role comment, dispatch, delivery, and ordinary review; add named mutation-order tests `delivery and review preserve last validation before first write` and `partial comment-state drift is AMBIGUOUS_RESULT`. Keep runtime mutation assertions in existing fixtures.

- [ ] **Step 2: Run and verify failure**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-a-boundaries.int.spec.ts -t "role comment|dispatch|delivery|ordinary review"`

  Expected: FAIL because current usage exits 1, help reaches normal parsing, SHAs accept short/mixed forms, and stdout is not the common envelope.

- [ ] **Step 3: Integrate shared preflight/result mapping**

  Keep each existing parser-facing option name and domain call. Move adapter construction/readBody after `mode === 'run'`. Return domain facts needed by `createResultEnvelopeV1`; do not move or combine mutations. `--check` stays a no-write role-comment runtime path. Map partial comment/state drift to `AMBIGUOUS_RESULT` without guessing recovery.

- [ ] **Step 4: Run focused and existing tests**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/post-role-comment.int.spec.ts tests/int/mission-control-characterization.int.spec.ts tests/int/agent-delivery.int.spec.ts tests/int/mission-control-review-cli.int.spec.ts tests/int/mission-control-review.int.spec.ts`

  Expected: PASS; existing domain writes/readbacks and counters are unchanged, while all new interface assertions pass.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/post-role-comment.mjs scripts/mission-control-dispatch.mjs scripts/agent-delivery.mjs scripts/mission-control-review.mjs tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/post-role-comment.int.spec.ts tests/int/mission-control-characterization.int.spec.ts tests/int/agent-delivery.int.spec.ts tests/int/mission-control-review-cli.int.spec.ts tests/int/mission-control-review.int.spec.ts
  git commit -m "feat: normalize canonical role transports"
  ```

### Task 6: Normalize task bootstrap and the bounded recover/reopen transports

**Files:**

- Modify: `scripts/mission-control-task-create.mjs`
- Modify: `scripts/mission-control-recover-review.mjs`
- Modify: `scripts/mission-control/workflows/recover-review.mjs` at `parseRecoveryArgs` and `main`
- Modify: `scripts/mission-control-reopen.mjs`
- Modify: `scripts/mission-control/workflows/reopen.mjs` at `parseReopenArgs` and `main`
- Modify: `tests/int/cli-tier-a-boundaries.int.spec.ts`
- Modify focused existing tests: `tests/int/mission-control-task-bootstrap-contract.int.spec.ts`, `tests/int/mission-control-task-initialization.int.spec.ts`, `tests/int/mission-control-recover-review.int.spec.ts`, `tests/int/mission-control-reopen.int.spec.ts`, `tests/int/mission-control-correction-entrypoints.int.spec.ts`

**Interfaces:**

- Consumes: Tasks 1-2 contracts; existing bootstrap service and recover/reopen workflows.
- Produces: structured terminal facts while preserving exact signed authorization, incident, old/new-head, counter, policy, and readback contracts.

- [ ] **Step 1: Write failing boundary and quarantine cases**

  Add exact tests named `task bootstrap help precedes public-key read and adapter construction`, `recover review help precedes body policy checkout and GitHub reads`, `reopen help precedes authorization and GitHub reads`, `bootstrap recover and reopen invalid syntax exits two`, `authority and evidence mismatches exit three without mutation`, `unproved partial writes exit four`, `valid and identical retry fixtures map to canonical success classes`, `ordinary review evidence cannot enter recover-review`, and `head drift without the complete Founder tuple cannot enter reopen`.

- [ ] **Step 2: Run and verify failure**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-a-boundaries.int.spec.ts -t "task bootstrap|recover review|reopen"`

  Expected: FAIL because bootstrap constructs its adapter during normal main setup, recovery lacks help, and existing outputs/exits do not implement the shared contract.

- [ ] **Step 3: Integrate shared contracts without changing domain tuples**

  Build the bootstrap adapter/service only inside the run branch. Replace recovery/reopen local help detection with the shared preflight but retain exported domain parsers for existing tests. Return current workflow results to the facade and map only at the output boundary.

- [ ] **Step 4: Run focused and existing suites**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/mission-control-task-bootstrap-contract.int.spec.ts tests/int/mission-control-task-initialization.int.spec.ts tests/int/mission-control-recover-review.int.spec.ts tests/int/mission-control-reopen.int.spec.ts tests/int/mission-control-correction-entrypoints.int.spec.ts`

  Expected: PASS with exact #274/#275 recovery quarantine and merged #285 reopen semantics unchanged.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/mission-control-task-create.mjs scripts/mission-control-recover-review.mjs scripts/mission-control/workflows/recover-review.mjs scripts/mission-control-reopen.mjs scripts/mission-control/workflows/reopen.mjs tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/mission-control-task-bootstrap-contract.int.spec.ts tests/int/mission-control-task-initialization.int.spec.ts tests/int/mission-control-recover-review.int.spec.ts tests/int/mission-control-reopen.int.spec.ts tests/int/mission-control-correction-entrypoints.int.spec.ts
  git commit -m "feat: normalize bounded bootstrap and recovery commands"
  ```

### Task 7: Normalize reconcile and merge without changing atomic bundles

**Files:**

- Modify: `scripts/mission-control-reconcile.mjs` at `parseReconcileArgs` and direct-execution `main`
- Modify: `scripts/mission-control-merge.mjs` at `parseArgs` and direct-execution `main`
- Modify: `tests/int/cli-tier-a-boundaries.int.spec.ts`
- Modify focused existing tests: `tests/int/mission-control-reconcile.int.spec.ts`, `tests/int/mission-control-merge.int.spec.ts`, `tests/int/mission-control-merge-verdict-binding-entrypoint.int.spec.ts`, `tests/int/mission-control-phase1-dogfood.int.spec.ts`

**Interfaces:**

- Consumes: Tasks 1-2 contracts and current `runBoundedReconciliation`/`runFounderAuthorizedMerge` bundle functions.
- Produces: common envelope at facade boundary; domain result objects and side-effect order stay intact.

- [ ] **Step 1: Add failing exact terminal-path tests**

  Add exact tests named `reconcile and merge help and invalid syntax perform zero I/O`, `reconcile and merge examples reach documented preflight`, `reconcile and merge map every terminal class and exit code`, `reconcile and merge JSON stdout is one v1 object`, `merge validates all authority head CI and mergeability before its first mutation`, `merge reads back protected base RESULT Task DONE closure and campaign projection`, and `reconcile cannot close reopen or adopt arbitrary head drift`.

- [ ] **Step 2: Run and verify failure**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-a-boundaries.int.spec.ts -t "reconcile|merge"`

  Expected: FAIL because current entrypoints do not support help/JSON/common exits and some parser errors are generic exit 1.

- [ ] **Step 3: Adapt only entrypoint parsing and output**

  Keep all safe execution bundle arrays, Founder authorization parsing, exact-head CI, merge protection, campaign checks, CAS/lease calls, and readbacks unchanged. Convert only facade inputs/outputs and error mapping. An unknown legacy domain outcome must fail as `INTERNAL_ERROR`, never silently become SUCCESS.

- [ ] **Step 4: Run focused and existing suites**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/mission-control-reconcile.int.spec.ts tests/int/mission-control-merge.int.spec.ts tests/int/mission-control-merge-verdict-binding-entrypoint.int.spec.ts tests/int/mission-control-phase1-dogfood.int.spec.ts`

  Expected: PASS; transition, counter, authority, retry, campaign, and terminal readback assertions remain green.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/mission-control-reconcile.mjs scripts/mission-control-merge.mjs tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/mission-control-reconcile.int.spec.ts tests/int/mission-control-merge.int.spec.ts tests/int/mission-control-merge-verdict-binding-entrypoint.int.spec.ts tests/int/mission-control-phase1-dogfood.int.spec.ts
  git commit -m "feat: expose stable reconcile and merge results"
  ```

### Task 8: Enforce deterministic routing and exact-one decisions

**Files:**

- Create: `scripts/cli/command-routing.mjs`
- Create: `tests/int/cli-routing-contract.int.spec.ts`
- Modify: `tests/int/cli-command-registry.int.spec.ts`

**Interfaces:**

- Consumes: `COMMAND_CONTRACT_REGISTRY.routes`, `MISSION_CONTROL_STATES`, `getTransportRoute`.
- Produces: `resolveCommandRoute({ observed_state, evidence_case }) -> RouteRow`; no command execution and no evidence reconstruction.

- [ ] **Step 1: Write the failing routing suite**

  Add exact tests named `covers every exported managed state`, `covers every canonical transport and Tier A operation`, `returns exactly one decision for every supported tuple`, `rejects duplicate route keys and state-evidence tuples`, `Founder gates and COMPLETE carry no command`, `ordinary review routes only to review`, `recover reopen and reconcile remain quarantined`, `standalone routes make no campaign decision`, `identical completed retry routes to the canonical no-op owner`, and `unknown malformed stale superseded duplicate competing or ambiguous evidence stops`.

- [ ] **Step 2: Run and verify failure**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-routing-contract.int.spec.ts`

  Expected: FAIL because the pure resolver does not exist.

- [ ] **Step 3: Implement exact lookup only**

  Index frozen rows by `${observed_state ?? 'UNINITIALIZED'}::${evidence_case}`. Throw during registry validation on duplicates; return the canonical synthesized STOP row for unknown runtime input. Do not order predicates, infer evidence, call an adapter, or execute `canonical_command`.

- [ ] **Step 4: Run and verify pass**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-routing-contract.int.spec.ts tests/int/cli-command-registry.int.spec.ts tests/int/mission-control-characterization.int.spec.ts`

  Expected: PASS; every known tuple has exactly one result and all unknown/conflicting tuples stop.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/cli/command-routing.mjs tests/int/cli-routing-contract.int.spec.ts tests/int/cli-command-registry.int.spec.ts
  git commit -m "feat: enforce deterministic command routing"
  ```

### Task 9: Generate/verify agent docs and wire the drift guard

**Files:**

- Create: `scripts/cli/render-command-docs.mjs`
- Create: `scripts/guard-cli-contract.mjs`
- Create: `docs/mission-control/agent-quick-start.md`
- Create: `docs/mission-control/command-contract-maintainers.md`
- Create: `tests/int/cli-documentation-contract.int.spec.ts`
- Modify: `docs/mission-control/command-reference.md`
- Modify: `prompts/mission-control/chatgpt-project-loader.md`
- Modify: `scripts/guard-pack.mjs`
- Modify: `scripts/boilerplate/inventory.mjs`
- Modify: `.bemoat/boilerplate-sync-manifest.json`
- Modify: `package.json`

**Interfaces:**

- Consumes: registry/reader/router from Tasks 1 and 8.
- Produces: `renderCommandReference`, `renderAgentQuickStart`, `checkGeneratedCommandDocs`, and a non-mutating `guard:cli-contract` package command.

- [ ] **Step 1: Write failing renderer/structure tests**

  Add exact tests named `committed command reference equals deterministic render`, `committed quick-start equals deterministic render`, `every documented example is accepted by its parser`, `quick-start exposes every under-one-minute decision field`, `loader enforces the nine-step execution protocol`, `maintainer contract names every drift edge`, and `guard rejects package registry parser docs example transport state and managed-path drift`. Compare sections/tables, not one oversized file snapshot.

- [ ] **Step 2: Run and verify failure**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-documentation-contract.int.spec.ts`

  Expected: FAIL because the renderer, quick-start, maintainer contract, and guard do not exist and the current command reference is independent prose.

- [ ] **Step 3: Implement deterministic docs and guard wiring**

  Render command/routing tables from registry values. Keep explanatory prose short and structurally checked. Add `guard:cli-contract` (non-`bemoat:*`) to `package.json`, call the guard from `runGuardPack`, and add every new reusable file/test/doc path to both starter inventory and manifest. The guard reads only; it never rewrites docs during validation.

- [ ] **Step 4: Run and verify pass**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-documentation-contract.int.spec.ts tests/int/cli-command-registry.int.spec.ts tests/int/cli-routing-contract.int.spec.ts tests/int/guard-pack.int.spec.ts tests/int/mission-control-command-reference.int.spec.ts tests/int/mission-control-child-portability.int.spec.ts`

  Then run: `pnpm run guard:cli-contract`

  Expected: PASS; generated text equals committed docs, all examples parse, package/registry/transport/state/docs bindings agree, and the guard changes no file.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/cli/render-command-docs.mjs scripts/guard-cli-contract.mjs docs/mission-control/command-reference.md docs/mission-control/agent-quick-start.md docs/mission-control/command-contract-maintainers.md prompts/mission-control/chatgpt-project-loader.md scripts/guard-pack.mjs scripts/boilerplate/inventory.mjs .bemoat/boilerplate-sync-manifest.json package.json tests/int/cli-documentation-contract.int.spec.ts tests/int/guard-pack.int.spec.ts tests/int/mission-control-command-reference.int.spec.ts tests/int/mission-control-child-portability.int.spec.ts
  git commit -m "docs: bind agent command guidance to registry"
  ```

### Task 10: Prove regression safety, deliver once, and stop at Independent Review 1

**Files:** No planned product edits. Fix only proven Issue #276 defects in the owning earlier task/commit before delivery; do not add a cleanup commit.

**Consumes:** Completed Tasks 1-9.

- [ ] **Step 1: Run the focused contract matrix**

  ```bash
  pnpm exec vitest run --config ./vitest.config.mts \
    tests/int/cli-command-registry.int.spec.ts \
    tests/int/cli-invocation-contract.int.spec.ts \
    tests/int/cli-tier-a-boundaries.int.spec.ts \
    tests/int/cli-tier-b-boundaries.int.spec.ts \
    tests/int/cli-routing-contract.int.spec.ts \
    tests/int/cli-documentation-contract.int.spec.ts
  ```

  Expected: PASS with 22 commands, 11/8/3 tiers, all Tier A/B help cases, all Tier A runtime envelopes, 14-state coverage, exact-one routes, and drift mutations rejected.

- [ ] **Step 2: Run repository safety/regression gates**

  ```bash
  pnpm run guard:safety
  PAYLOAD_SECRET=secret pnpm run check
  git diff --check
  ```

  Expected: all exit 0 with zero lint warnings. Do not run child sync, deploy, migration, production, or retained-data commands.

- [ ] **Step 3: Audit scope and compatibility before push**

  Run `git status --short`, `git diff --stat origin/main...HEAD`, and `git diff --name-only origin/main...HEAD`. Confirm no Campaign #215, PR #275-specific bootstrap semantics, state-transition logic, migrations, application code, deployment config, secrets, or child-owned infrastructure changed. Re-run the 49-row AC table above and record `Done`, `Not done`, `Not applicable`, or `Waiting for CI / human review` with evidence.

  Expected: only Section 2 files and explicitly listed existing focused tests changed; AC-48 exact-head CI and AC-49 review remain waiting.

- [ ] **Step 4: Push one Issue #276 branch and open/update one PR**

  Use the repository issue workflow after Founder approval. Target `main` under the starter bootstrap exception, include `Closes #276`, the AC audit, exact local evidence, the bounded exact-head parser tightening, and explicit confirmation that PR #275/Campaign #215/child sync were untouched. Do not merge.

- [ ] **Step 5: Verify exact-head CI**

  Resolve the pushed PR head and require both GitHub checks named `CI` and `CI (starter strict)` to pass on that exact SHA. Inspect logs for any failure; do not guess or accept stale checks.

  Expected: both checks green on the exact current PR head.

- [ ] **Step 6: Publish one compact `## RESULT` and stop**

  Post the canonical Issue #276 RESULT with PR/head, files, commands, AC audit, risks, and one next action: Independent Full Semantic Review 1. Do not edit Campaign #215, PR #275, or merge.

  Commit: none. This is delivery and evidence collection for the already committed tasks.

## 7. Implementation Review Gates

- Registry review: one dataset, 22 commands, exact Tier C exclusions, no duplicated transport authority.
- Boundary review: child-process help and invalid syntax demonstrate actual zero network/write behavior, not mocked prose claims.
- Domain review: each existing workflow's last pre-mutation validation and first post-write readback remain in the same order.
- Routing review: pure lookup only; every state covered; exact-one/gate/complete/stop; unknowns stop.
- Documentation review: an agent can select and invoke a command without reading parser/workflow source; examples are executable argv arrays.
- Compatibility review: existing positional/plain invocations stay valid except the explicitly approved full-lowercase exact-head tightening; legacy domain tokens are visible only as mapped details.
- Delivery review: exact-head local/CI evidence and Independent Review 1; Founder alone merges.

## 8. Known Risks and Required Handling

| Risk | Required handling |
| --- | --- |
| Eleven Tier A facades currently mix parsing, output, and mutation | Adapt facade boundaries only; existing domain functions and mutation order remain characterized by their current suites. |
| `boilerplate:check` uses transient target-root storage and network at runtime | Help/invalid must preflight first; runtime test proves cleanup on both success and failure and no durable target drift. |
| `reopen` is merged but missing from managed package/facade rails | Task 1 adds and tests the binding; no child sync is run. |
| Existing command reference is already canonical prose | Task 9 converts operational tables to renderer output without deleting safety context; section tests prevent loss. |
| Shared canonical classifications differ from existing domain outcomes | Registry carries an explicit per-command map; unknown legacy tokens fail closed. |
| Exact full-lowercase SHA validation tightens currently permissive parsers | Founder approval of this plan is the explicit bounded compatibility approval; document it in PR/RESULT and do not tighten unrelated inputs. |
| Route evidence can be complex | The new module accepts only pre-normalized evidence cases and performs no inference or execution; existing domain readers retain evidence semantics. |
| Managed starter paths can drift from the manifest | Update both files in the same tasks and test equality; do not execute child sync. |

## 9. Completion Boundary

Implementation is complete only when all 49 acceptance criteria have evidence, local gates pass, both exact-head GitHub checks pass, and Independent Full Semantic Review 1 is requested. The implementation run stops there. It does not merge Issue #276, return to PR #275, freeze the harness, or begin Finance work.
