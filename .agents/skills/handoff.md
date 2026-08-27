# Handoff Skill

This is a thin, stateless, provider-portable UX adapter over the discovered
public `bemoat:handoff` command. It does not implement HANDOFF validation,
publication, readback, routing, or persistence. The discovered public command
contract remains the single semantic source of truth.

If the current provider has a native Handoff skill runtime, use the native
Handoff skill first. Otherwise use this Markdown fallback. In either case,
preserve the behavior and public-contract boundary below.

## Pre-publication gate

1. Read `AGENTS.md` and the applicable repository skill guidance.
2. Perform repository-defined Bemoat CLI Discovery for both
   `bemoat:context` and `bemoat:handoff`. Resolve the registered contracts
   before selecting any invocation.
3. If `help_meaningful` is true, invoke the discovered
   `safe_help_invocation` and consume its machine-readable contract. If it is
   false, use the registered safe-help/delegation boundary exactly as
   discovered. Do not infer syntax from memory, examples, or implementation
   files.
4. Fresh-reconstruct the requested Issue through the discovered public Context
   contract before preparing a HANDOFF. Do not use chat, session memory, local
   notes, or a copied handoff as authority.
5. Keep the objective bounded to the already-authorized work. Use only the
   repository, Issue, branch, protected-base, PR/head, policy, CI/review, and
   local-durability evidence relevant to that objective.
6. Validate one strict JSON HANDOFF against the discovered Handoff contract.

If validation or required evidence is invalid, malformed, conflicting, stale,
non-durable, unavailable, or ambiguous, stop before invoking the public
command. Preserve the discovered fail-closed stop classification exactly,
including
`INVALID_INVOCATION`, `STATE_CONFLICT`, `AUTHORITY_CONFLICT`, `HEAD_DRIFT`,
`BLOCKED_EXTERNAL`, `EVIDENCE_CONFLICT`, `AMBIGUOUS_RESULT`, and
`INTERNAL_ERROR`. The command's write boundary is exactly:
`exactly one top-level Issue HANDOFF comment; no other protocol mutation`.

Never blindly retry, post, or publish a second comment after an unproven or
ambiguous mutation result. Follow only the discovered conditional retry
contract: Return NO_OP_IDENTICAL_RETRY only when one exact canonical HANDOFF
already exists and fresh readback proves its identity; never blindly retry an
unproven POST.

## Exit-hygiene/finalization gate

Inspect workspace status and classify every local residue before creating the
temporary body file or publishing:

- Agent-owned temporary, scratch, diagnostic, review-dump, generated transport,
  or disposable evidence residue must be removed.
- Intended durable task work must be committed and pushed, or otherwise made
  GitHub-visible, when the repository policy requires it.
- Pre-existing or unrelated human/agent work must never be deleted or
  overwritten merely to obtain a clean workspace. If it prevents safe
  continuation, fail closed and report the blocker.
- Explicitly retained local material is allowed only when policy permits it
  and it cannot become workflow authority.

Do not use broad destructive cleanup, a blanket ignore rule, a reset, or a
stash to hide uncertainty. Continue to publication only after the bounded
objective is durable and the workspace classification is safe.

## Build and publish

1. Read the discovered Handoff contract's `required_inputs`, `optional_flags`,
   `writes`, stop classifications, retry contract, and `post_write_readback`
   requirement.
   Build caller arguments from that metadata; do not copy invocation syntax from
   this document or from memory.
2. Build exactly one strict JSON HANDOFF record containing only the fields
   accepted by the discovered schema. Bind it to the reconstructed Issue and
   the verified bounded objective, evidence, route, stop conditions, and next
   action. Do not use Markdown, a fenced JSON block, or stdin when the
   discovered contract requires a `body_file` input.
3. Create one temporary body file solely as invocation transport. Write the
   exact strict JSON record to that file, pass it through the discovered
   `body_file` input, and never treat the file as durable workflow state or
   continuation authority.
4. Invoke only the discovered public `bemoat:handoff` command. Do not invoke
   its implementation entrypoint, import internal modules, call a legacy
   Mission Control transport, or publish through a raw GitHub mutation path
   owned by the public command.
5. Require the command's result classification and fresh GitHub readback. A
   successful result must prove the one exact HANDOFF body and immutable
   comment identity required by the discovered contract. Preserve the exact
   `SUCCESS`, `NO_OP_IDENTICAL_RETRY`, or fail-closed result rather than
   rewriting it.

## Cleanup and continuation

Remove the temporary body file and any agent-created disposable transport,
scratch, diagnostic, review-dump, or generated evidence residue only after the
publication/readback outcome is known. Keep no `HANDOFF.md`, cache, database,
receipt, lease, counter, second protocol record, or other local workflow
state. Never delete or overwrite pre-existing or unrelated local files;
report them and stop if they make safe finalization ambiguous.

After a verified publication or exact identical no-op, inspect final workspace
status again, then fresh-run the discovered
public Context command for the same Issue and surface exactly its returned
route, reasons, and `next_action`. Do not infer a continuation from the
HANDOFF text, session memory, or local notes. The skill-mediated operation must
be equivalent to direct command use: its route, mutation result, readback
identity, and next action must preserve the same protocol semantics as direct
use of the discovered public Handoff command for the same record.
