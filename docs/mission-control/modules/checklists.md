## Completion gate

A task becomes `ELIGIBLE FOR FOUNDER REVIEW` only when all are true:

- every required Acceptance Criterion is `Done` or explicitly `Not applicable` with reason;
- required tests/checks pass for the exact current head;
- required manual QA evidence exists;
- no verified Blocker/Critical finding remains open;
- implementation remains inside approved scope;
- task Issue state records the current head and review cycle;
- PR targets the approved base;
- PR description links/closes the source Issue as required;
- no unresolved state conflict exists.

Once eligible: stop searching for additional improvements; do not reopen for
Important, Minor, or Nit; create bounded follow-up Issues where worthwhile;
return one Founder action (review/merge/decline); do not merge automatically.


