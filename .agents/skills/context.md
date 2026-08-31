# Context Skill

Use this skill when a fresh issue session needs authoritative reconstructed
context before any bounded work begins.

## Boundary

This is a thin, stateless, provider-portable adapter over the public
`bemoat:context` command. It does not implement context collection,
normalization, routing, or protocol behavior. The discovered command contract
is the single semantic source of truth. Do not add an alternate route, schema,
protocol, or provider-specific copy of this skill.

If the current provider has a native Context skill, use the native skill
runtime first. Otherwise use this Markdown fallback. In either case, keep the
behavior below identical.

## Execution

1. Read `AGENTS.md` and the repository's applicable agent-loop guidance. Treat
   the canonical policy from live protected/merged main, as reconstructed by
   the public command, as authoritative; do not substitute a local policy
   override.
2. Perform the repository-defined Bemoat CLI Discovery for `bemoat:context`.
   Resolve the registered public contract before choosing any invocation.
3. If `help_meaningful` is true, invoke the discovered
   `safe_help_invocation` and consume its machine-readable contract. If it is
   false, use the discovered safe-help/delegation boundary exactly as
   registered. Do not infer syntax from memory, prompt examples, or
   implementation files.
4. Validate the caller's issue number against the discovered `required_inputs`.
   Build caller arguments from the discovered input metadata and use the JSON
   output option only when it is present in the discovered `optional_flags`.
5. Invoke only the discovered public `command`. Do not call its implementation
   entrypoint directly and do not import implementation internals.

## Context result handling

Surface the complete authoritative result from `bemoat:context`, including the
repository and protected-base identity, policy identity and source, Issue
objective and durable evidence, local branch/HEAD/upstream/origin and local
durability evidence, active PR/base/head, exact-head CI and review/protection
evidence, classification, reasons, route, and `next_action` whenever present.
Preserve absent or null evidence rather than filling it from another source.

Return the exact `route` and `next_action` selected by the public command. Do
not choose a route, rewrite a reason, infer a command, or turn a STOP into a
retry or workaround. Preserve all fail-closed STOP classifications and
evidence. If the reconstructed local evidence contradicts direct Git reads,
preserve both records, classify it as a possible local-evidence defect, and
stop without bypassing the command.

The command result is the authority. Only its command output may supply or
override evidence. Do not use prior chat, session memory, local notes, or
undocumented provider state to complete or override it. A fresh session must
be sufficient.

## Read-only guarantee

Before execution, confirm through Discovery that the public contract's
`writes` list is empty. A contract mismatch is a `CLI_DISCOVERY_DEFECT` and a
STOP condition. This skill and the delegated command must remain read-only:

- create no comments, issues, PRs, branches, commits, pushes, checkout/reset
  operations, stash entries, or tracked-file changes;
- create no cache, state, database, receipt, lease, counter, temporary
  protocol artifact, or `HANDOFF.md`;
- do not invoke Handoff or any other workflow command as part of Context.

Do not depend on module extensions or implementation file layout. If Discovery,
the public command, or required external evidence is unavailable,
contradictory, or ambiguous, preserve the exact STOP result and its next
permitted action, then stop.
