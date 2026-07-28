## RESULT

**Failure class:** `SPECIFICATION`
**Decision:** `REVISE_SPECIFICATION`
**Scope:** one no-code authority-source analysis for `MC-R1-171-001` at reviewed head `c88a2cc3858be16a32c308b716c22a1121996ea2`.

### Gate verified

- Issue #171 open; Review 7 comment `5093899315`; exact head `c88a2cc3858be16a32c308b716c22a1121996ea2`.
- Finding thread `https://github.com/boat1994/bemoat-web-starter/pull/172#discussion_r3649776607` remains open.
- PR #172 open, Draft, base `main`, exact head `c88a2cc3858be16a32c308b716c22a1121996ea2`.

### Required correction behavior

Bind the immutable planning contract to the exact authorized planning-base commit plus canonical repository/protected-branch identity; prove the reviewed head descends from that commit while allowing the live base tip to advance; fail closed against shared-history but unauthorized heads and local/stale/ambiguous/replace/graft-influenced lineage; classify unavailable shallow/missing-object proof as `BLOCKED_EXTERNAL`.

### Smallest bounded correction scope

Correct only `MC-R1-171-001` against correction base `c88a2cc3858be16a32c308b716c22a1121996ea2` without authorizing Review 8.

### Prohibitions

- Do not reinterpret `MC-R1-171-001`.
- Do not authorize Review 8 in this transition.
- Do not mark PR #172 ready or merge it in this transition.
