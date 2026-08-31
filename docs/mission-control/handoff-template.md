# HANDOFF template

Publish exactly one strict JSON object after fresh Context reconstruction and
one bounded objective:

```bash
pnpm run bemoat:handoff <issue-number> --body-file <strict-handoff.json>
```

The body must contain exactly one strict JSON HANDOFF object with the schema-v1
fields below. Markdown, fenced
JSON, stdin, unknown fields, and multiple records are rejected.

```json
{
  "schema_version": 1,
  "record_type": "HANDOFF",
  "repository": "owner/repository",
  "issue_number": "410",
  "objective": "One bounded objective",
  "permitted_scope": ["Authorized paths or behavior"],
  "prohibited_scope": ["Explicit exclusions"],
  "executing_agent": "agent identity",
  "provider": "provider identity",
  "branch": "chore/410-example",
  "exact_head": "0123456789abcdef0123456789abcdef01234567",
  "protected_base": {
    "branch": "main",
    "sha": "89abcdef0123456789abcdef0123456789abcdef"
  },
  "pr": {
    "number": "455",
    "url": "https://github.com/owner/repository/pull/455",
    "base": "main",
    "head": "chore/410-example",
    "head_sha": "0123456789abcdef0123456789abcdef01234567"
  },
  "verified_evidence": [
    {
      "kind": "validation",
      "value": "Focused and full checks passed at exact_head",
      "url": null
    }
  ],
  "route": "FOUNDER_GATE",
  "next_action": {
    "route": "FOUNDER_GATE",
    "description": "Founder reviews the verified exact head; no autonomous merge"
  },
  "stop_conditions": ["Do not merge without Founder approval"],
  "local_durability": {
    "required": true,
    "durable": true,
    "reason": null
  }
}
```

Routes are closed to `IMPLEMENT`, `VERIFY`, `FIX`, `REVIEW`,
`FOUNDER_GATE`, `COMPLETE`, and `STOP`. When there is no branch or PR, use
`null` only where the schema permits it. If local durability is required but
incomplete, set `durable` to `false`, explain why in `reason`, and use an
appropriate STOP route.

The receiver must run `bemoat:context <issue-number> --json` and rebind live
evidence before acting. HANDOFF records authority and routing; it does not
create managed state, review counters, merge permission, or another protocol
transport.
