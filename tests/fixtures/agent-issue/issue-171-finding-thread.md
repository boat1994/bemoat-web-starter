**MC-R1-171-001 — Critical — Common ancestry does not prove authorized planning lineage**

This accepts any non-empty `git merge-base(baseTipSha, reviewedHead)`. In an ordinary repository, a reviewed head forked from an obsolete or unintended point still shares the repository root with `main`, so this predicate grants correction authorization even when the head never descended from the exact protected-base SHA authorized for planning.

Required correction evidence: bind the immutable planning contract to the exact authorized planning-base commit plus canonical repository/protected-branch identity; prove the reviewed head descends from that commit while allowing the live base tip to advance; fail closed against shared-history but unauthorized heads and local/stale/ambiguous/replace/graft-influenced lineage; classify unavailable shallow/missing-object proof as `BLOCKED_EXTERNAL`; retain the existing no-PR, ghost-PR, counter/finding, and implementation-PR exact-head/base tests.
