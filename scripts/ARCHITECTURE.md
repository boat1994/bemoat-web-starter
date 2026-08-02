# Scripts Architecture

The scripts directory maintains a strict architecture contract defined in `scripts/architecture-contract.json`.

The contract enforces:
- A maximum set of strongly connected components (dependency cycles) to prevent architecture decay.
- Adapter isolation, ensuring adapters (like `scripts/adapters/command-runner.mjs`) do not import from the repository and are only used by allowlisted callers.
- A complete root-script migration map: every `scripts/*.mjs` and `scripts/*.sh` file has exactly one mapping with facade disposition, internal destination vocabulary, owning slice (1–7), and migration status.
- Deterministic path ordering of `rootScripts`.
- Explicit transitional recording for `scripts/harness-contract/` pending separate migration authority.

Allowed internal destination prefixes: `scripts/mission-control/`, `scripts/agent-issue/`, `scripts/boilerplate/`, `scripts/guards/`, `scripts/adapters/`, `scripts/tooling/`, and `scripts/shared/`.
