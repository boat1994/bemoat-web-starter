## Repository-specific override behavior

Child overrides live at `.bemoat/mission-control-overrides.md` (never
sync-managed). See [project-overrides.example.md](./project-overrides.example.md).

Overrides may add/narrow project requirements. They must not relax shared
invariants (review budget, completion gate, severity rules, exact-head
requirements, auto-merge bans, silent reset bans). Conflicting overrides yield
`STATE_CONFLICT`.


