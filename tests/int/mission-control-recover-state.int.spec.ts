import { describe, expect, it } from 'vitest'

import {
  main,
  runRecoverState,
} from '../../scripts/mission-control/workflows/recover-state.mjs'
import {
  parseMissionControlState,
  projectMissionControlStateBlock,
  renderMissionControlState,
} from '../../scripts/mission-control-state.mjs'
import { getCommandContract } from '../../scripts/cli/command-contract.mjs'
import { createHelpEnvelopeV1 } from '../../scripts/cli/command-help.mjs'
import { getTransportRoute } from '../../scripts/mission-control/transport-registry.mjs'

type JsonObject = Record<string, unknown>
type Comment = JsonObject & { id: string; body: string }

const COMMAND = 'bemoat:mission-control:recover-state'
const REPOSITORY = 'boat1994/bemoat-web-starter'
const ISSUE = '276'
const PR = '292'
const BASE = 'main'
const BRANCH = 'feature/276-slice-b'
const BASE_SHA = '7cf51129144a355172a32d57a73b5fda9eae5504'
const POLICY_BLOB_SHA = 'b'.repeat(40)
const CURRENT_HEAD = 'c659bc11b927ba54cf663a41fd13495aa1af20ee'
const REVIEWED_HEAD = '24497c9891b03e4042ac34770a1dfd3b225be1e1'
const ADOPTION_HEAD = '917f879bea53ced5bc9622bd28f46d45046973c4'
const PREDECESSOR_COMMENT = '5213944977'
const ADOPTION_AUTHORIZATION_COMMENT = '5215031090'
const IMPLEMENTATION_RESULT_COMMENT = '5215321038'
const IMPLEMENTATION_REVIEW_COMMENT = '5215623058'
const RECOVERY_AUTHORIZATION_COMMENT = '5216214424'
const COUNTER_EVIDENCE_COMMENT = '5212960343'

const FINDINGS = [
  {
    id: 'CLI-IDEMPOTENCY-001',
    canonical_summary: 'Issue comment transport must make identical retries safe.',
    source_thread: `https://github.com/${REPOSITORY}/issues/${ISSUE}`,
    required_evidence: ['idempotency evidence'],
  },
  {
    id: 'CLI-SCHEMA-001',
    canonical_summary: 'Help output must expose stop classifications.',
    source_thread: `https://github.com/${REPOSITORY}/issues/${ISSUE}`,
    required_evidence: ['schema evidence'],
  },
]

function predecessorBody(overrides: { reviewedHead?: string; cycle?: string } = {}) {
  const reviewedHead = overrides.reviewedHead ?? REVIEWED_HEAD
  const cycle = overrides.cycle ?? null
  return `## REVIEW_VERDICT

### Task log
Timestamp: 2026-08-07T07:30:00Z
Task / Issue: #276
Phase: review
Executing role: bounded-correction-worker
**Reviewed PR:** 292
**Approved base:** \`${BASE_SHA}\`
**Exact head reviewed:** \`${reviewedHead}\`
**PR / base / head:** PR #292 · \`${BASE}\` · \`${reviewedHead}\`
**Verdict:** CORRECTION REQUIRED

### Review identity
Independent bounded Delta Review for CLI-DISCOVERY-002.${cycle ? `\nCycle: ${cycle}` : ''}

### Immutable finding disposition
CLI-IDEMPOTENCY-001: verified.
CLI-SCHEMA-001: verified.

### Critical findings
None.

### Important findings
None.

\`\`\`json
${JSON.stringify({ schema_version: 1, mode: 'implementation_pr', reviewed_head: reviewedHead, findings: FINDINGS }, null, 2)}
\`\`\`
`
}

function counterEvidenceBody() {
  return `## REVIEW_VERDICT

Task / Issue: #276
**Reviewed PR:** 292
**Approved base:** \`${BASE_SHA}\`
**Exact head reviewed:** \`3554c41ac9006dd4992a7abf9b510ad1790c71f8\`
**Verdict:** CORRECTION REQUIRED
Cycle: 1
`
}

function adoptionAuthorizationBody(overrides: { issue?: string; pr?: string; baseSha?: string } = {}) {
  return `## FOUNDER AUTHORIZATION — MC-CORRECTION-FINDING-ADOPTION-001

### Approved canonical transport

\`bemoat:mission-control:adopt-finding\`

### Exact approval binding

- Repository: \`${REPOSITORY}\`
- Issue: #${overrides.issue ?? ISSUE}
- PR: #${overrides.pr ?? PR}
- Base: \`${BASE}@${overrides.baseSha ?? BASE_SHA}\`
- Live adoption head: \`${ADOPTION_HEAD}\`
- Predecessor contract: Issue comment \`${PREDECESSOR_COMMENT}\`
- Predecessor reviewed head: \`${REVIEWED_HEAD}\`
- Existing immutable findings:
  - \`CLI-IDEMPOTENCY-001\`
  - \`CLI-SCHEMA-001\`
- Authorized appended finding:
  - \`MC-CORRECTION-FINDING-ADOPTION-001\`

### Next permitted action

Implement the Founder-authorized append-only adoption.
`
}

function implementationResultBody(overrides: { head?: string; executed?: boolean } = {}) {
  const head = overrides.head ?? CURRENT_HEAD
  return `## RESULT

### Task log
- Timestamp: \`2026-08-07T16:30:00+07:00\`
- Task / Issue: #276
- Phase: Dev (implementation)
- Executing role: Dev / Builder
- Branch: \`${BRANCH}\`
- Head: \`${head}\`
- PR: https://github.com/${REPOSITORY}/pull/${PR}

### Summary
- Implemented Founder-authorized Tier-A \`bemoat:mission-control:adopt-finding\`.
- ${overrides.executed ? 'Executed the live adoption transition against Issue #276.' : 'Did not execute the live adoption transition against Issue #276.'}
`
}

function implementationReviewBody(overrides: { head?: string; verdict?: string } = {}) {
  const head = overrides.head ?? CURRENT_HEAD
  return `## REVIEW_VERDICT

### Task log
Timestamp: 2026-08-07T10:05:00Z
Task / Issue: #276
Phase: review
Executing role: bounded-semantic-reviewer
**Reviewed PR:** 292
**Approved base:** \`${BASE_SHA}\`
**Exact head reviewed:** \`${head}\`
**Verdict:** ${overrides.verdict ?? 'ELIGIBLE FOR FOUNDER REVIEW'}

### Review identity
Independent bounded semantic review for MC-CORRECTION-FINDING-ADOPTION-001.

### Exact next permitted action
Founder-authorized execution of \`bemoat:mission-control:adopt-finding\` for Issue #276 using durable authorization comment ${ADOPTION_AUTHORIZATION_COMMENT}.
`
}

function recoveryAuthorizationBody(overrides: { issue?: string; pr?: string; head?: string; expectedState?: string } = {}) {
  return `## FOUNDER AUTHORIZATION — MC-MISSING-MANAGED-STATE-RECOVERY-001

The Founder approves exactly one bounded correction: \`MC-MISSING-MANAGED-STATE-RECOVERY-001\`.

### Exact live binding

- Repository: \`${REPOSITORY}\`
- Issue: #${overrides.issue ?? ISSUE}
- PR: #${overrides.pr ?? PR}
- Branch: \`${BRANCH}\`
- Current exact head: \`${overrides.head ?? CURRENT_HEAD}\`
- Base: \`${BASE}@${BASE_SHA}\`
- Expected reconstructable historical state for this incident: \`${overrides.expectedState ?? 'CORRECTION_REQUIRED_1'}\`
- Existing predecessor correction contract: comment \`${PREDECESSOR_COMMENT}\`
- Existing Founder finding-adoption authorization: comment \`${ADOPTION_AUTHORIZATION_COMMENT}\`
- Reviewed adopt-finding implementation verdict: comment \`${IMPLEMENTATION_REVIEW_COMMENT}\`

### Next permitted action
Implement the bounded recovery transport. Do not execute live recovery.
`
}

function comment(id: string, body: string, overrides: JsonObject = {}): Comment {
  return {
    id,
    body,
    issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE}`,
    user: { login: 'boat1994' },
    author_association: 'OWNER',
    created_at: '2026-08-07T17:00:00Z',
    ...overrides,
  }
}

function baseComments(overrides: JsonObject = {}) {
  const extraComments = Array.isArray(overrides.extraComments)
    ? overrides.extraComments as Comment[]
    : []
  return [
    comment(COUNTER_EVIDENCE_COMMENT, counterEvidenceBody(), { created_at: '2026-08-07T06:30:00Z' }),
    comment(PREDECESSOR_COMMENT, predecessorBody(), { created_at: '2026-08-07T07:30:00Z' }),
    comment(ADOPTION_AUTHORIZATION_COMMENT, adoptionAuthorizationBody(), { created_at: '2026-08-07T08:00:00Z' }),
    comment(IMPLEMENTATION_RESULT_COMMENT, implementationResultBody(), { created_at: '2026-08-07T16:30:00+07:00' }),
    comment(IMPLEMENTATION_REVIEW_COMMENT, implementationReviewBody(), { created_at: '2026-08-07T10:05:00Z' }),
    comment(RECOVERY_AUTHORIZATION_COMMENT, recoveryAuthorizationBody(), { created_at: '2026-08-07T17:00:00Z' }),
    ...extraComments,
  ] as Comment[]
}

function options(overrides: JsonObject = {}): JsonObject {
  return {
    issueNumber: ISSUE,
    repo: REPOSITORY,
    expectedPr: PR,
    expectedBase: BASE,
    expectedBaseSha: BASE_SHA,
    expectedHead: CURRENT_HEAD,
    expectedBranch: BRANCH,
    predecessorComment: PREDECESSOR_COMMENT,
    adoptionAuthorizationComment: ADOPTION_AUTHORIZATION_COMMENT,
    implementationResultComment: IMPLEMENTATION_RESULT_COMMENT,
    implementationReviewComment: IMPLEMENTATION_REVIEW_COMMENT,
    recoveryAuthorizationComment: RECOVERY_AUTHORIZATION_COMMENT,
    check: false,
    ...overrides,
  }
}

function expectedState(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: 1,
    state: 'CORRECTION_REQUIRED_1',
    review_cycle: 1,
    full_review_count: 1,
    approved_base: BASE,
    active_task_issue: `#${ISSUE}`,
    active_pr: `#${PR}`,
    current_head: CURRENT_HEAD,
    last_reviewed_head: REVIEWED_HEAD,
    workflow_mode: 'implementation_pr',
    guide_version: '1.3.0',
    guide_source_ref: BASE,
    guide_source_sha: POLICY_BLOB_SHA,
    latest_review_verdict_comment_id: PREDECESSOR_COMMENT,
    open_blockers: ['CLI-IDEMPOTENCY-001', 'CLI-SCHEMA-001'],
    follow_up_issues: [],
    next_permitted_action: `Re-attempt Founder-authorized ${'bemoat:mission-control:adopt-finding'} for Issue #${ISSUE} after fresh live verification; do not execute automatically.`,
    material_change_status: 'none',
    updated_at: '2026-08-07T07:30:00Z',
    updated_by: 'Mission Control Missing-State Recovery',
    ...overrides,
  }
}

function createHarness(overrides: JsonObject = {}) {
  let issueBody = String(overrides.issueBody ?? 'Task prose\n\nThe managed projection is absent.\n')
  let comments = baseComments(overrides)
  const pullRequestOverrides = overrides.pullRequest &&
    typeof overrides.pullRequest === 'object' &&
    !Array.isArray(overrides.pullRequest)
    ? overrides.pullRequest as Record<string, unknown>
    : {}
  const pullRequest = {
    number: Number(PR),
    state: 'OPEN',
    isDraft: false,
    headRefName: BRANCH,
    headRefOid: CURRENT_HEAD,
    baseRefName: BASE,
    baseRefOid: BASE_SHA,
    ...pullRequestOverrides,
  }
  const writes: Array<{
    repo: string
    issueNumber: string
    expectedBody: string
    nextBody: string
    transitionIdentity: string
  }> = []
  const operations: string[] = []
  const deps = {
    readManagedIssue: async () => ({
      number: Number(ISSUE),
      state: 'OPEN',
      body: issueBody,
    }),
    readPullRequest: async () => structuredClone(pullRequest),
    readComment: async (_repo: string, id: string) => {
      const found = comments.find((entry) => String(entry.id) === String(id))
      if (!found) throw new Error(`missing comment ${id}`)
      return structuredClone(found)
    },
    readIssueComments: async () => structuredClone(comments),
    readTrustedFounderLogins: async () => ['boat1994'],
    readProtectedPolicy: async () => ({
      ref: BASE,
      commitSha: BASE_SHA,
      sha: POLICY_BLOB_SHA,
      guideVersion: '1.3.0',
    }),
    writeIssueBody: async (input: {
      repo: string
      issueNumber: string
      expectedBody: string
      nextBody: string
      transitionIdentity: string
    }) => {
      operations.push('writeIssueBody')
      writes.push(structuredClone(input))
      if (overrides.writeError) throw overrides.writeError
      if (overrides.skipWrite) {
        return {
          path: 'lease',
          observedBodyHash: 'skip',
          nextBodyHash: 'skip',
          adopted: false,
        }
      }
      if (issueBody !== input.expectedBody) throw new Error('STATE_CONFLICT: stale Issue body')
      issueBody = input.nextBody
      return {
        path: 'lease',
        observedBodyHash: 'observed',
        nextBodyHash: 'next',
        adopted: true,
      }
    },
    adoptFinding: async () => {
      operations.push('adoptFinding')
      throw new Error('adopt-finding must not be called by recovery')
    },
  }

  return {
    deps,
    pullRequest,
    operations,
    get writes() { return writes.length },
    get body() { return issueBody },
    set body(next: string) { issueBody = next },
    get comments() { return comments },
    set comments(next: Comment[]) { comments = next },
  }
}

describe(COMMAND, () => {
  it('help is machine-readable and performs zero writes', async () => {
    const harness = createHarness()
    const result = await main(['--help', '--json'], harness.deps)
    expect(result.classification).toBe('HELP')
    expect(harness.writes).toBe(0)
    const contract = getCommandContract(COMMAND)
    expect(contract).not.toBeNull()
    const help = createHelpEnvelopeV1(contract as JsonObject)
    expect(help.accepted_pre_states).toEqual(['MANAGED_STATE_BLOCK_ABSENT'])
    expect(help.writes).toEqual(['one canonical managed-state block appended through leased/CAS Issue-body projection'])
    expect(help.next_action_rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        classification: 'SUCCESS',
        next_action: expect.objectContaining({ command: 'bemoat:mission-control:adopt-finding' }),
      }),
    ]))
  })

  it('check mode validates the fixture without writing comments or state', async () => {
    const harness = createHarness()
    const result = await runRecoverState({ options: options({ check: true }), deps: harness.deps, checkOnly: true })
    expect(result.classification).toBe('SUCCESS')
    expect(result.mutationPerformed).toBe(false)
    expect(harness.writes).toBe(0)
    expect(harness.operations).not.toContain('adoptFinding')
  })

  it('accepts only a completely absent canonical block', async () => {
    const harness = createHarness()
    const result = await runRecoverState({ options: options(), deps: harness.deps })
    expect(result.classification).toBe('SUCCESS')
    expect(result.state).toMatchObject(expectedState())
    expect(result.state.recovery_evidence_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(parseMissionControlState(harness.body)).toMatchObject({ present: true, valid: true })
  })

  it('rejects a valid existing state instead of repairing it', async () => {
    const state = expectedState({ state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0, current_head: null, last_reviewed_head: null })
    const harness = createHarness({ issueBody: `Task prose\n${renderMissionControlState(state)}\n` })
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/STATE_CONFLICT/)
    expect(harness.writes).toBe(0)
  })

  it('rejects malformed or partial marker pairs', async () => {
    const harness = createHarness({ issueBody: 'Task prose\n<!-- bemoat-mission-control-state:start -->\n' })
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/STATE_CONFLICT/)
    expect(harness.writes).toBe(0)
  })

  it('derives state, counters, findings, heads, and PR identity from evidence', async () => {
    const harness = createHarness()
    const result = await runRecoverState({ options: options({ expectedState: 'DONE', reviewCycle: 99, openBlockers: ['caller-supplied'] }), deps: harness.deps })
    expect(result.state).toMatchObject(expectedState())
    expect(result.state.state).toBe('CORRECTION_REQUIRED_1')
    expect(result.state.review_cycle).toBe(1)
    expect(result.state.full_review_count).toBe(1)
    expect(result.state.last_reviewed_head).toBe(REVIEWED_HEAD)
    expect(result.state.current_head).toBe(CURRENT_HEAD)
    expect(result.state.active_pr).toBe('#292')
    expect(result.state.open_blockers).toEqual(['CLI-IDEMPOTENCY-001', 'CLI-SCHEMA-001'])
  })

  it('rejects ambiguous predecessor evidence', async () => {
    const harness = createHarness({
      extraComments: [comment('5217000001', predecessorBody())],
    })
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)
  })

  it('rejects conflicting explicit counters', async () => {
    const harness = createHarness({
      extraComments: [comment('5217000002', '## REVIEW_VERDICT\nTask / Issue: #276\n**Reviewed PR:** 292\n**Exact head reviewed:** `24497c9891b03e4042ac34770a1dfd3b225be1e1`\n**Verdict:** CORRECTION REQUIRED\nreview_cycle: 2\nfull_review_count: 1')],
    })
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)
  })

  it('rejects counter lineage supplied by an untrusted bound comment', async () => {
    const harness = createHarness({
      extraComments: [comment('5217000005', counterEvidenceBody(), { user: { login: 'untrusted-reviewer' } })],
    })
    harness.comments = harness.comments.filter((entry) => entry.id !== COUNTER_EVIDENCE_COMMENT)
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(harness.writes).toBe(0)
  })

  it('rejects unsupported history instead of inventing a higher correction state', async () => {
    const harness = createHarness({
      predecessorBody: predecessorBody({ cycle: '4' }),
    })
    harness.comments = harness.comments.map((entry) => entry.id === PREDECESSOR_COMMENT
      ? { ...entry, body: predecessorBody({ cycle: '4' }) }
      : entry)
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/EVIDENCE_CONFLICT|UNSUPPORTED_PRE_STATE/)
  })

  it('rejects a lineage with no immutable counter evidence instead of defaulting a state', async () => {
    const harness = createHarness()
    harness.comments = harness.comments.filter((entry) => entry.id !== COUNTER_EVIDENCE_COMMENT)
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)
    expect(harness.writes).toBe(0)
  })

  it('preserves guide blob provenance separately from the protected policy commit', async () => {
    const harness = createHarness()
    const result = await runRecoverState({ options: options(), deps: harness.deps })
    expect(result.state.guide_source_sha).toBe(POLICY_BLOB_SHA)
    expect(result.state.guide_source_sha).not.toBe(BASE_SHA)
  })

  it('rejects wrong repository, Issue, or PR bindings', async () => {
    const wrongIssue = createHarness({
      recoveryAuthorizationBody: recoveryAuthorizationBody({ issue: '999' }),
    })
    wrongIssue.comments = wrongIssue.comments.map((entry) => entry.id === RECOVERY_AUTHORIZATION_COMMENT
      ? { ...entry, body: recoveryAuthorizationBody({ issue: '999' }) }
      : entry)
    await expect(runRecoverState({ options: options(), deps: wrongIssue.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)

    const wrongRepo = createHarness()
    wrongRepo.comments = wrongRepo.comments.map((entry) => entry.id === ADOPTION_AUTHORIZATION_COMMENT
      ? { ...entry, body: adoptionAuthorizationBody({ issue: ISSUE, pr: PR }).replace(REPOSITORY, 'someone/else') }
      : entry)
    await expect(runRecoverState({ options: options(), deps: wrongRepo.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)
  })

  it('rejects base, branch, and current-head drift', async () => {
    const harness = createHarness({ pullRequest: { headRefName: 'other-branch' } })
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/HEAD_DRIFT/)
  })

  it('requires the trusted Founder identity and immutable non-superseded authorities', async () => {
    const harness = createHarness()
    harness.deps.readTrustedFounderLogins = async () => ['someone-else']
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/AUTHORITY_CONFLICT/)

    const superseded = createHarness({
      extraComments: [comment('5217000003', `supersedes: ${RECOVERY_AUTHORIZATION_COMMENT}\nnot authoritative`)],
    })
    await expect(runRecoverState({ options: options(), deps: superseded.deps })).rejects.toThrow(/AUTHORITY_CONFLICT/)
  })

  it('creates exactly one canonical block and preserves unrelated Issue prose', async () => {
    const prefix = '## Original task\n\nKeep this paragraph exactly.\n'
    const suffix = '\n\n## Durable evidence\nDo not rewrite this section.\n'
    const harness = createHarness({ issueBody: `${prefix}${suffix}` })
    await runRecoverState({ options: options(), deps: harness.deps })
    const starts = harness.body.match(/bemoat-mission-control-state:start/g) ?? []
    const ends = harness.body.match(/bemoat-mission-control-state:end/g) ?? []
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(harness.body.startsWith(prefix)).toBe(true)
    expect(harness.body).toContain(suffix)
    expect(harness.operations).toEqual(['writeIssueBody'])
  })

  it('does not alter historical comments or create an active correction identity', async () => {
    const harness = createHarness()
    const before = structuredClone(harness.comments)
    const result = await runRecoverState({ options: options(), deps: harness.deps })
    expect(harness.comments).toEqual(before)
    expect(result.state).not.toHaveProperty('active_correction_contract_identity')
    expect(result.state).not.toHaveProperty('latest_transition_identity')
  })

  it('returns NO_OP_IDENTICAL_RETRY for the exact completed projection', async () => {
    const harness = createHarness()
    await runRecoverState({ options: options(), deps: harness.deps })
    const writes = harness.writes
    const result = await runRecoverState({ options: options(), deps: harness.deps })
    expect(result.classification).toBe('NO_OP_IDENTICAL_RETRY')
    expect(result.mutationPerformed).toBe(false)
    expect(harness.writes).toBe(writes)
  })

  it('does not treat changed evidence as an identical retry', async () => {
    const harness = createHarness()
    await runRecoverState({ options: options(), deps: harness.deps })
    harness.comments = harness.comments.map((entry) => entry.id === IMPLEMENTATION_REVIEW_COMMENT
      ? { ...entry, body: implementationReviewBody({ verdict: 'CORRECTION REQUIRED' }) }
      : entry)
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/EVIDENCE_CONFLICT|STATE_CONFLICT/)
  })

  it('rejects a changed immutable evidence set even when it reconstructs the same state', async () => {
    const harness = createHarness()
    await runRecoverState({ options: options(), deps: harness.deps })
    harness.comments = harness.comments.map((entry) => entry.id === RECOVERY_AUTHORIZATION_COMMENT
      ? { ...entry, body: `${entry.body}\nEvidence substitution.` }
      : entry)
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/EVIDENCE_CONFLICT|STATE_CONFLICT/)
    expect(harness.writes).toBe(1)
  })

  it('binds counter reconstruction to the exact counter-evidence body', async () => {
    const harness = createHarness()
    await runRecoverState({ options: options(), deps: harness.deps })
    harness.comments = harness.comments.map((entry) => entry.id === COUNTER_EVIDENCE_COMMENT
      ? { ...entry, body: `${counterEvidenceBody()}Evidence substitution.` }
      : entry)
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/EVIDENCE_CONFLICT|STATE_CONFLICT/)
    expect(harness.writes).toBe(1)
  })

  it('stops on stale CAS without overwriting the winner', async () => {
    const harness = createHarness({ writeError: new Error('STATE_CONFLICT: lease CAS lost') })
    const before = harness.body
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/STATE_CONFLICT/)
    expect(harness.body).toBe(before)
    expect(harness.writes).toBe(1)
  })

  it('stops on lease conflict and never retries the write', async () => {
    const harness = createHarness({ writeError: new Error('STATE_CONFLICT: issue-body lease CAS lost') })
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/STATE_CONFLICT/)
    expect(harness.writes).toBe(1)
  })

  it('classifies an ambiguous write outcome without retrying or invoking adoption', async () => {
    const harness = createHarness({ writeError: new Error('network timeout after accepted write') })
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/AMBIGUOUS_RESULT/)
    expect(harness.writes).toBe(1)
    expect(harness.operations).not.toContain('adoptFinding')
  })

  it('routes success only to adopt-finding after fresh verification', async () => {
    const harness = createHarness()
    const result = await runRecoverState({ options: options(), deps: harness.deps })
    expect(result.nextAction).toEqual({
      type: 'COMMAND',
      command: 'bemoat:mission-control:adopt-finding',
      reason: expect.stringContaining('fresh live verification'),
    })
    expect(harness.operations).not.toContain('adoptFinding')
  })

  it('main emits the canonical result envelope without executing the next action', async () => {
    const harness = createHarness()
    const result = await main([
      ISSUE,
      '--repo', REPOSITORY,
      '--expected-pr', PR,
      '--expected-base', BASE,
      '--expected-base-sha', BASE_SHA,
      '--expected-head', CURRENT_HEAD,
      '--expected-branch', BRANCH,
      '--predecessor-comment', PREDECESSOR_COMMENT,
      '--adoption-authorization-comment', ADOPTION_AUTHORIZATION_COMMENT,
      '--implementation-result-comment', IMPLEMENTATION_RESULT_COMMENT,
      '--implementation-review-comment', IMPLEMENTATION_REVIEW_COMMENT,
      '--recovery-authorization-comment', RECOVERY_AUTHORIZATION_COMMENT,
      '--check', '--json',
    ], harness.deps)
    expect(result.classification).toBe('SUCCESS')
    expect(result.mutation_performed).toBe(false)
    expect((result.next_action as { command?: unknown }).command).toBe('bemoat:mission-control:adopt-finding')
    expect(harness.writes).toBe(0)
    expect(harness.operations).not.toContain('adoptFinding')
  })

  it('keeps reconcile missing-state initialization fail-closed', () => {
    expect(() => projectMissionControlStateBlock('Task prose\n', expectedState())).toThrow(/managed state block is missing/)
  })

  it('keeps the projection helper additive and canonical', () => {
    const body = 'Task prose\n'
    const rendered = `${body}${renderMissionControlState(expectedState())}\n`
    expect(parseMissionControlState(rendered)).toMatchObject({ present: true, valid: true })
  })

  it('does not expose resulting state or counters as caller inputs', () => {
    const contract = getCommandContract(COMMAND) as unknown as {
      required_inputs: Array<{ name: string }>
      optional_flags: Array<{ name: string }>
    }
    const inputs = [...contract.required_inputs, ...contract.optional_flags]
    const names = inputs.map((input) => input.name)
    expect(names).not.toContain('expected_state')
    expect(names).not.toContain('review_cycle')
    expect(names).not.toContain('full_review_count')
    expect(names).not.toContain('last_reviewed_head')
    expect(names).not.toContain('open_blockers')
  })

  it('rejects incomplete invocation before reading or writing external state', async () => {
    const harness = createHarness()
    const result = await main([ISSUE, '--json'], harness.deps)
    expect(result.classification).toBe('INVALID_INVOCATION')
    expect(harness.writes).toBe(0)
    expect(harness.operations).toEqual([])
  })

  it('classifies a post-write readback mismatch as ambiguous without retrying', async () => {
    const harness = createHarness({ skipWrite: true })
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/AMBIGUOUS_RESULT/)
    expect(harness.writes).toBe(1)
    expect(harness.operations).toEqual(['writeIssueBody'])
  })

  it('rejects duplicate immutable adoption authority and keeps recovery transport separate', async () => {
    const duplicate = createHarness({
      extraComments: [comment('5217000004', adoptionAuthorizationBody())],
    })
    await expect(runRecoverState({ options: options(), deps: duplicate.deps })).rejects.toThrow(/AUTHORITY_CONFLICT/)

    expect(getTransportRoute(COMMAND)).toMatchObject({ role: 'STATE_PROJECTION', exceptional: true })
    expect(getTransportRoute('bemoat:mission-control:adopt-finding')).toMatchObject({
      role: 'STATE_PROJECTION',
      exceptional: false,
    })
  })

  it('rejects duplicate predecessor evidence when the reviewed SHA casing differs', async () => {
    const harness = createHarness({
      extraComments: [comment('5217000006', predecessorBody({ reviewedHead: REVIEWED_HEAD.toUpperCase() }))],
    })
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)
    expect(harness.writes).toBe(0)
  })
})
