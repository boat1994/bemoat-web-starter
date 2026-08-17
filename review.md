Act as Mission Control for `boat1994/bemoat-web-starter`.

Treat the newly proven REVIEW_VERDICT validation mismatch as a bounded
canonical-workflow correctness defect under Issue #333.

Do not implement in this coordination action.

Re-verify live GitHub state and record one defect-fix HANDOFF.

Proven defect:

`pnpm run bemoat:issue:comment -- 333 --body-file <file> --check`
can return SUCCESS for a REVIEW_VERDICT that the downstream canonical
review-verdict binding machinery rejects as STATE_CONFLICT.

Specific proven inconsistencies:

1. post-role-comment validation checks compatibility field presence and verdict
   enum but does not enforce the canonical REVIEW_VERDICT binding parser.

2. command-contract metadata advertises/accepts legacy REVIEW_VERDICT
   compatibility shapes that downstream canonical binding rejects.

3. field-shape validation and verdict extraction have inconsistent handling of
   bullet-prefixed fields, producing misleading enum errors.

Required invariant:

Any REVIEW_VERDICT accepted by `bemoat:issue:comment --check` must be
consumable by the same canonical REVIEW_VERDICT binding semantics used by
downstream Mission Control state/merge verification.

Prefer one validation authority; do not duplicate canonical binding semantics.

Add focused regressions for:
- canonical PR URL · `main` · exact head → accepted;
- slash-separated PR # / main@SHA / head → rejected;
- main@SHA in the canonical base slot → rejected;
- any legacy shape advertised by help but rejected downstream → no longer
  advertised/accepted, unless canonical downstream support is deliberately
  retained;
- bullet/non-bullet field handling is internally consistent;
- valid verdict enum must not produce a false enum error due only to formatting;
- --help examples, --check validation, posting validation, and downstream
  consumption remain parity-tested.

Do not modify PR #362 after its completed semantic Review 1.
Do not merge in this action.
Do not start Batch 9.
Do not expand into unrelated comment transport behavior.

Publish one canonical HANDOFF to Issue #333 through the registered transport
and STOP.