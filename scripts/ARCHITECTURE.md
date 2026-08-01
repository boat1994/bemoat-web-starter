# Scripts Architecture

The scripts directory maintains a strict architecture contract defined in `scripts/architecture-contract.json`.

The contract enforces:
- A maximum set of strongly connected components (dependency cycles) to prevent architecture decay.
- Adapter isolation, ensuring adapters (like `scripts/adapters/command-runner.mjs`) do not import from the repository and are only used by allowlisted callers.
