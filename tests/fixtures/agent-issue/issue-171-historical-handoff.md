## HANDOFF

### Task log
* Timestamp: 2026-07-26T21:34:37+07:00
* Task / Issue: #171
* Phase: Founder-authorized correction after Review 3
* Executing role: Mission Control
* Authorization: `founder-r3-1f05427a8fbb-2026-07-26T01-30-29-07-00`

**Target:** Dev / Correction Builder

**Objective:** Resolve immutable Critical finding `MC-R1-171-001` on PR #172 while preserving counters `3/1`, finding identity, the prior reviewed head, and the prohibition on Review 4.

**Links:** Issue https://github.com/boat1994/bemoat-web-starter/issues/171 · PR https://github.com/boat1994/bemoat-web-starter/pull/172 · finding https://github.com/boat1994/bemoat-web-starter/pull/172#discussion_r3649776607

**Scope:** Bind the planning contract to the exact authorized planning-base commit, canonical repository, and protected branch; require a commit-target ref; bind compare evidence to the exact reviewed head; reject impossible topology, substituted compare heads, shared-history unauthorized heads, and unavailable canonical evidence; preserve no-PR, ghost-PR, exact-head, counters, and immutable-lineage guards.

**Required preflight:** Dev must use a clean worktree at PR head `1f05427a8fbb893e726dd0e317ff30a90d7b3570` and run `pnpm run bemoat:agent:issue -- 171 --phase correction` before applying or committing correction changes.

**Stop:** Do not implement, commit, push, resolve the finding, start Review 4, merge, mark ready, deploy, sync child repositories, modify Cloudflare, or resume Finance in this dispatch run.

**Next:** Atomically post this HANDOFF, consume the Founder authorization, transition Issue #171 to `IN_PROGRESS`, verify the binding and reservation release, then stop.
