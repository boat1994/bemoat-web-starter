# Issue 150: Upstream Dogfood Evidence

## Claim-matched executable coverage

- Protected-base loading and bundles are derived from the approved-SHA Project loader; a tampered loader fixture proves the classifier follows content rather than a path list.
- Unmarked, duplicate, and genuinely unbalanced state fixtures execute the preflight boundary and assert `STATE_MIGRATION_REQUIRED`.
- `BLOCKED_EXTERNAL`, genuine `STATE_CONFLICT`, exact-head mismatch, and older-SHA CI success have separate executable cases.
- `HANDOFF`, `RESULT`, and `REVIEW_VERDICT` parsing and timestamp supersession are all exercised.
- The drift guard executes 15 verdict/cycle transitions and the complete 104-case state/cycle/full-review cross-product; dynamic reconciler and parser tampering prove semantic drift is rejected without source-text matching.
- An integrated upstream fixture parses each managed lifecycle state, runs READY through preflight, replays delivery and all three review bounds, analyzes two exact-head checks, exercises all role headings, and proves sync manifest/runtime parity plus recursive inventory without performing child sync.

## Reproducible approved-base baseline

`node scripts/capture-baseline.mjs c2637d6540f9200b01e8e0af1938e257975ada27` uses byte-preserving `git show`, recursive NUL-delimited `git ls-tree -z`, and loader-content classification. The JSON output records the exact derivation ref and all 49 recursive sync-managed documentation paths.

## Complete benchmark and traceability

[`issue-150-benchmark-scenarios.json`](./issue-150-benchmark-scenarios.json) is the canonical machine-readable fixture. Each scenario contains policy intent, approved-base behavior, approved canonical behavior, concrete input/evidence/expected fields, executable test references, Issue #150 criterion mappings, and immutable trace IDs for all ten contradictions in the Issue #149 discovery RESULT.

No child repository, policy module, state vocabulary, schema, production resource, migration, or deployment is changed by this characterization pass.
