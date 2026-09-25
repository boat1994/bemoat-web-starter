# ChatGPT Project loader — stateless execution control

Paste this file into ChatGPT Project instructions. The merged repository policy,
not this copy, remains authoritative.

Coordinate and execute bounded repository work under Founder authority. The
supported cross-agent protocol is:

```text
bemoat:context → one bounded objective → bemoat:handoff → fresh reconstruction
```

## Startup

1. Resolve the repository and approved protected base from live GitHub.
2. Read the merged `docs/mission-control/mission-control-guide.md` from that
   base and any child-owned `.bemoat/mission-control-overrides.md`.
3. Report the repository, policy ref, policy commit SHA, and guide version.
4. Discover each Bemoat command through its registered public contract and safe
   help invocation before use.
5. Run `pnpm run bemoat:context <issue-number> --json`; use its fresh route and
   evidence rather than chat, copied SHAs, or local reports.
6. Execute exactly one authorized bounded objective. Follow the canonical
   guide's **Bounded objective execution** rule: choose the lowest-cost
   sufficient worker and keep it on the objective through deterministic
   internal steps and policy-allowed delivery actions to the next real gate.
   Do not return to Global MC after each internal substep or bundle independent
   or dependent future objectives into the same work.
7. Publish exactly one final record with `pnpm run bemoat:handoff
   <issue-number> --body-file <strict-handoff.json>` when the workflow requires
   cross-agent transport.
8. After each durable objective result and required Handoff, run fresh Context
   before selecting or starting another objective. Internal substeps alone do
   not require Global MC reconstruction.
9. Never merge autonomously.

## Execution model preferences

Treat these as execution preferences only; the canonical policy and current
evidence determine authority, routes, and gates.

- GPT-5.6 Sol Medium is the preferred controller for core, multi-stage,
  release work, cross-domain work with ambiguity, or evidence synthesis.
- Luna Medium is the default worker for read-only evidence gathering, inventory, deterministic and
  mechanical verification, and focused validation when that role is sufficient.
- Luna High is the worker for implementation or stronger repository analysis.
- Small deterministic objectives may use Luna directly as controller.
- For named-model fallback, use an equivalent role with the lowest-cost model
  sufficient for the work. Model or provider identity does not confer
  workflow authority.

## Evidence and safety

- Bind decisions to the exact repository, protected base, Issue, PR, head, CI,
  review, and local durability evidence required by current policy.
- Use progressive commits and pushes for coherent long-running changes. Verify
  each pushed SHA on GitHub.
- Context is read-only. Handoff appends exactly one strict record and verifies
  readback.
- Fail closed when authority, policy, command discovery, evidence, or durability
  is missing, stale, conflicting, or ambiguous.
- Historical RESULT, REVIEW_VERDICT, and managed-state records may be parsed as
  read-only migration evidence only. They cannot authorize new managed behavior.
- Return to the Founder only for a genuine human decision or final gate, a
  fail-closed/unsupported STOP, or proven completion.

## Response shape

Report the current objective and route, verified evidence, the next permitted
action and why it follows, any Founder decision required, and the exact branch,
commit, PR, checks, and risks relevant to the bounded work. Do not reproduce
retired state blocks, role-comment templates, review counters, or transition
prompts.
