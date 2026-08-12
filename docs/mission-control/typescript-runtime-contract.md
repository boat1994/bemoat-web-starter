# Mission Control TypeScript runtime contract

Phase 0 is pinned to the protected main baseline
449ddb917cf809cb6c2aff0ade843d0727d82f64 after Issue #328 merged.

## Selected strategy

Use native Node TypeScript type stripping for future Mission Control .ts
modules. The repository floor is Node >=24.15.0; the local probe used
Node v24.16.0. Node runs erasable TypeScript syntax directly, preserves the
package's ESM semantics, and does not require a runtime loader.

The canonical typecheck remains no-emit validation. tsconfig.harness-strict.json
extends the application config but forces strict nullability for harness code,
includes scripts/mission-control/**/*.ts, and enables the compiler settings
that keep native Node execution honest:

- allowImportingTsExtensions: true
- erasableSyntaxOnly: true

pnpm run typecheck now invokes node scripts/bemoat-typecheck.mjs. That
managed command validates both tsconfig.json and tsconfig.harness-strict.json
with tsc --noEmit. pnpm run bemoat:typecheck remains the child-facing
public command and retains the same implementation.

## Coexistence and import rules

Existing .mjs entrypoints and package commands remain authoritative and
unchanged. Do not convert task-state.mjs or another production implementation
in Phase 0.

Future .ts modules must:

- remain ESM under the package's type: module contract;
- use explicit .ts extensions for relative imports, including imports across
  a temporary .mjs / .ts compatibility boundary;
- use import type for type-only imports;
- use only erasable TypeScript syntax at runtime;
- preserve one authoritative implementation of each behavior;
- avoid tsconfig path aliases at the native Node boundary.

.mjs modules continue to use explicit .mjs imports. A migration slice may
cross languages only through an explicit import boundary with characterization
coverage; it must not fork business logic.

## Rejected alternatives

- Native execution on Node 20 was rejected because it is below the repository
  engine floor and does not provide the approved native TypeScript runtime
  contract.
- tsx as the Mission Control runtime was rejected because native Node 24
  satisfies the erasable-syntax requirements. The existing tsx dependency is
  retained only for the current Playwright command and is not added to or used
  by Mission Control package commands.
- A compile-to-JavaScript pipeline was rejected for Phase 0 because no emitted
  artifact or syntax transform is required. tsc --noEmit supplies the static
  guarantee while Node supplies runtime execution.

## CLI, shebang, and debug contract

The current CLI remains .mjs with #!/usr/bin/env node shebangs and package
commands that invoke those .mjs files through node. Phase 0 adds no public
TypeScript CLI entrypoint and changes no exit-code, stdout, or stderr contract.

Native type stripping does not generate source maps; it replaces type syntax
with whitespace, preserving source line positions. The erasableSyntaxOnly
compiler setting prevents future slices from depending on syntax that would
require runtime transformation and source-map handling.

## Bounded evidence

The focused toolchain test executes
scripts/mission-control/types/runtime-probe.ts with process.execPath. The
probe imports its sibling using an explicit .ts extension and asserts native
Node ESM/type-stripping behavior. The existing .mjs command tests remain in the
same Vitest suite and are still invoked via their existing package commands.

The first safe production slice after this foundation is the pure constant
module scripts/mission-control/domain/campaign-enums.mjs. This Phase 0 change
does not convert that slice; it stops before the first production migration.
