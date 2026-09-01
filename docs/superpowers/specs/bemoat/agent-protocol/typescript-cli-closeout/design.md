# Retained Harness TypeScript CLI Closeout

<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-429"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#429"
branch_template: "refactor/429-typescript-cli-entrypoints"
transition_target: "FOUNDER_GATE"
planning_base_sha: "f498a5efbfa188565683dbcf6e02318fd6cbcfc1"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/bemoat/agent-protocol/typescript-cli-closeout/design.md"
paired_plan: "docs/superpowers/plans/bemoat/agent-protocol/typescript-cli-closeout/plan.md"
```
<!-- bemoat-task-identity:end -->

## Authority

Issue #429 and the Founder execution brief authorize a behavior-preserving
TypeScript closeout for the maintained stateless agent protocol and generic
Bemoat harness at protected base
`f498a5efbfa188565683dbcf6e02318fd6cbcfc1`.

The retained runtime remains:

```text
package.json / registered public command
        -> TypeScript CLI entrypoint
        -> typed application / domain / adapters
```

The change must not restore the retired stateful Mission Control subsystem or
introduce a loader, build pipeline, state machine, persistence layer, or
compatibility framework.

## Scope ruling

The repository contains 43 tracked `.mjs` files at the protected base.

The following 40 files are maintained Bemoat protocol or generic harness
runtime and are `RETAIN+PORT`:

- `scripts/adapters/command-runner.mjs`
- `scripts/agent-context-sync-base.mjs`
- `scripts/agent-context.mjs`
- `scripts/agent-handoff.mjs`
- `scripts/bemoat-typecheck.ts`
- `scripts/boilerplate/config.mjs`
- `scripts/boilerplate/filesystem.mjs`
- `scripts/boilerplate/git.mjs`
- `scripts/boilerplate/inventory.mjs`
- `scripts/boilerplate/workflow.mjs`
- `scripts/boilerplate/workflows/check-boilerplate-drift.mjs`
- `scripts/check-boilerplate-drift.mjs`
- `scripts/cli/command-contract-registry.mjs`
- `scripts/cli/command-contract.mjs`
- `scripts/cli/command-help.mjs`
- `scripts/cli/command-invocation.mjs`
- `scripts/cli/command-result.mjs`
- `scripts/cli/utility-routing-policy.mjs`
- `scripts/context/cli.mjs`
- `scripts/guard-cloudflare-env.ts`
- `scripts/guard-harness-contract.ts`
- `scripts/guard-pack.ts`
- `scripts/guards/build-script-contract.ts`
- `scripts/guards/cloudflare-env.ts`
- `scripts/guards/env-placeholder.ts`
- `scripts/guards/frontend-seo.ts`
- `scripts/guards/pack.ts`
- `scripts/guards/package-manager.ts`
- `scripts/guards/planning-contract-runtime.ts`
- `scripts/guards/planning-contract.ts`
- `scripts/guards/repo-safety.ts`
- `scripts/guards/scripts-architecture.ts`
- `scripts/guards/structural-protection.ts`
- `scripts/guards/toolchain-contract.ts`
- `scripts/harness-contract/child-script-policy.mjs`
- `scripts/harness-contract/managed-runtime-closure.mjs`
- `scripts/harness-contract/manifest.mjs`
- `scripts/harness-contract/runtime-import-parser.mjs`
- `scripts/install-git-hooks.mjs`
- `scripts/sync-boilerplate.mjs`

No tracked harness `.mjs` is dead at this base. Each port deletes its
superseded path only after consumers move.

These three files are `OUTSIDE-HARNESS` for Issue #429:

- `eslint.config.mjs` is tool configuration owned by ESLint.
- `scripts/build.ts` is application/build-contract tooling.
- `scripts/deploy-smoke-test.ts` is deployment verification tooling.

Their sync availability does not make them part of the stateless protocol or
generic harness-safety executable surface. They remain explicit follow-up
candidates and are not aesthetic exceptions to the maintained harness
invariant.

## Behavior contract

The port preserves command names, accepted arguments, help/result schemas,
stdout, stderr, exit codes, mutation classifications, trusted evidence,
fail-closed behavior, retry behavior, and next-action routing.

In particular:

- `bemoat:context` remains read-only and deterministic.
- `bemoat:handoff` validates before its single permitted Issue-comment write,
  performs exact readback, and fails closed on ambiguity without blind retry.
- `bemoat:context:sync-base` retains its bounded stale-base mutation authority
  and sibling/dirty/divergence protections.
- Generic guards remain fail-closed.
- Child harness sync receives every renamed runtime dependency and no
  child-owned infrastructure.

## TypeScript design

Use the repository-supported Node runtime `>=24.15.0` and native TypeScript
execution. Preserve simple module/function boundaries. Add explicit types only
where the port exposes a real trust boundary or removes an existing broad
value; do not add classes, factories, dependency-injection containers, or new
registries.

Existing `.mjs` re-export facades become direct `.ts` modules or disappear in
favor of their existing `.ts` authority. Existing logic-bearing modules are
renamed and minimally typed. There must be one authoritative implementation
per behavior.

## Characterization and verification

Before changing production entrypoints, add focused process-boundary coverage
for the currently under-protected Context, Handoff, and sync-base facades.
Mechanical extension conversion may rely on existing characterization; any
semantic defect discovered during the migration requires a focused failing
story before correction.

Terminal verification includes:

- maintained harness `.mjs` count equals zero;
- the three OUTSIDE-HARNESS `.mjs` files remain classified and unchanged;
- CLI Discovery and safe help work for every retained Bemoat command;
- focused protocol, CLI, guard, harness-contract, sync, and architecture tests;
- `pnpm run check`;
- `pnpm run boilerplate:check` when useful for child projection evidence;
- `git diff --check`;
- exact-head GitHub CI and starter CI;
- one independent STANDARD semantic review and Delta Review after corrections.

## Delivery

Use one coherent draft PR targeting `main` under the starter bootstrap
exception. Progressive commits may make bounded progress durable. The agent
must not merge. Final routing is a canonical `bemoat:handoff` followed by fresh
`bemoat:context` and a Founder gate.
