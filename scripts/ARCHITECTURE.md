# Scripts Architecture

The scripts directory maintains a strict architecture contract defined in `scripts/architecture-contract.json`.

The contract enforces:
- A maximum set of strongly connected components (dependency cycles) to prevent architecture decay.
- Adapter isolation, ensuring adapters (like `scripts/adapters/command-runner.mjs`) do not import from the repository and are only used by allowlisted callers.
- A complete root-script migration map: every `scripts/*.mjs` and `scripts/*.sh` file has exactly one mapping with facade disposition, internal destination vocabulary, owning slice (1–7), and migration status. Campaign slice-range authority is a separate contract and does not expand this root-script ownership range.
- Deterministic path ordering of `rootScripts`.
- Explicit transitional recording for `scripts/harness-contract/` pending separate migration authority.

Allowed internal destination prefixes: `scripts/mission-control/`, `scripts/context/`, `scripts/boilerplate/`, `scripts/guards/`, `scripts/adapters/`, `scripts/tooling/`, and `scripts/shared/`.

## Harness-contract facade boundaries

`scripts/guard-harness-contract.mjs` is the stable public facade and direct CLI composition root for harness-contract checks.

Owned modules under `scripts/harness-contract/` may import Node builtins and approved intra-directory modules only:

| Module | Responsibility |
| --- | --- |
| `scripts/harness-contract/child-script-policy.mjs` | Child-facing `bemoat:*` policy scanning and formatting |
| `scripts/harness-contract/runtime-import-parser.mjs` | Static/dynamic runtime import specifier parsing |
| `scripts/harness-contract/managed-runtime-closure.mjs` | Managed runtime delivery closure scan/assert |
| `scripts/harness-contract/manifest.mjs` | Managed-paths manifest loading |

Allowed internal edge:

```text
scripts/harness-contract/managed-runtime-closure.mjs -> scripts/harness-contract/runtime-import-parser.mjs
```

Extracted modules must not import any approved SCC node. Production consumers continue to import only the facade.
