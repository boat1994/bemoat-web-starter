import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import {
  main,
  runRecoverState,
} from '../../scripts/mission-control/workflows/recover-state.mjs'
import { createProductionRecoverStateDeps } from '../../scripts/mission-control/adapters/recover-state-github.mjs'
import { buildReconstructedState } from '../../scripts/mission-control/domain/recover-state-projection.mjs'
import {
  parseMissionControlState,
  projectMissionControlStateBlock,
  renderMissionControlState,
} from '../../scripts/mission-control/domain/task-state.ts'
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
const CURRENT_HEAD = '53e1775f38ad93c8a08251388a23ef6a38c3f36a'
const CORRECTION_REVIEWED_HEAD = '81b63cccda485c6df0b50ebed34a80488c9ee8f6'
const HISTORICAL_ADOPT_HEAD = 'c659bc11b927ba54cf663a41fd13495aa1af20ee'
const REVIEWED_HEAD = '24497c9891b03e4042ac34770a1dfd3b225be1e1'
const ADOPTION_HEAD = '917f879bea53ced5bc9622bd28f46d45046973c4'
const NON_ANCESTOR_HEAD = 'aaf76459d5b88dd340072ea67803a8a6ed041d38'
const PREDECESSOR_COMMENT = '5213944977'
const ADOPTION_AUTHORIZATION_COMMENT = '5215031090'
const IMPLEMENTATION_RESULT_COMMENT = '5215321038'
const IMPLEMENTATION_REVIEW_COMMENT = '5215623058'
const RECOVERY_AUTHORIZATION_COMMENT = '5216214424'
const RECOVERY_IMPLEMENTATION_RESULT_COMMENT = '5217140920'
const RECOVERY_IMPLEMENTATION_REVIEW_COMMENT = '5217390793'
const LINEAGE_CORRECTION_AUTHORIZATION_COMMENT = '5218182829'
const CORRECTION_RESULT_COMMENT = '5218673559'
const CORRECTION_REVIEW_COMMENT = '5218763552'
const COUNTER_EVIDENCE_COMMENT = '5212960343'

describe('recover-state GitHub adapter boundary', () => {
  it('maps GitHub transport failures to BLOCKED_EXTERNAL', async () => {
    const deps = createProductionRecoverStateDeps({
      runGh: () => { throw new Error('gh: network unavailable') },
    })
    await expect(deps.readIssue(ISSUE, REPOSITORY)).rejects.toThrow('gh: network unavailable')
  })
})

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
  const head = overrides.head ?? HISTORICAL_ADOPT_HEAD
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
  const head = overrides.head ?? HISTORICAL_ADOPT_HEAD
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
- Issue: \`#${overrides.issue ?? ISSUE}\`
- PR: \`#${overrides.pr ?? PR}\`
- Branch: \`${BRANCH}\`
- Current exact head: \`${overrides.head ?? HISTORICAL_ADOPT_HEAD}\`
- Base: \`${BASE}@${BASE_SHA}\`
- Expected reconstructable historical state for this incident: \`${overrides.expectedState ?? 'CORRECTION_REQUIRED_1'}\`
- Existing predecessor correction contract: comment \`${PREDECESSOR_COMMENT}\`
- Existing Founder finding-adoption authorization: comment \`${ADOPTION_AUTHORIZATION_COMMENT}\`
- Reviewed adopt-finding implementation verdict: comment \`${IMPLEMENTATION_REVIEW_COMMENT}\`

### Next permitted action
Implement the bounded recovery transport. Do not execute live recovery.
`
}

function recoveryImplementationResultBody(overrides: { head?: string; executed?: boolean } = {}) {
  const head = overrides.head ?? CURRENT_HEAD
  return `## RESULT

### Task log
- Task / Issue: #${ISSUE}
- Phase: Dev (implementation)
- Branch: \`${BRANCH}\`
- Head: \`${head}\`
- PR: https://github.com/${REPOSITORY}/pull/${PR}

### Summary
- Added exceptional Tier-A \`bemoat:mission-control:recover-state\` for one wholly absent managed-state projection.
- ${overrides.executed ? 'Executed the live recovery transition against Issue #276.' : 'No live recovery or adopt-finding transition was executed.'}
`
}

function recoveryImplementationReviewBody(overrides: { head?: string; verdict?: string } = {}) {
  const head = overrides.head ?? CURRENT_HEAD
  return `## REVIEW_VERDICT

### Task log
- Task / Issue: #${ISSUE}
- Phase: Review
- Reviewed PR: #${PR}
- Approved base: \`${BASE_SHA}\`
- Exact head reviewed: \`${head}\`
- Verdict: ${overrides.verdict ?? 'ELIGIBLE FOR FOUNDER REVIEW'}
`
}

function correctionResultBody(overrides: { head?: string } = {}) {
  const head = overrides.head ?? CORRECTION_REVIEWED_HEAD
  return `## RESULT

### Task log
- Task / Issue: #${ISSUE}
- Phase: Dev (correction)
- Branch: \`${BRANCH}\`
- Head: \`${head}\`
- PR: https://github.com/${REPOSITORY}/pull/${PR}

### Summary
- Corrected the recover-state lineage role separation.
- Live recover-state and adopt-finding were not executed.
`
}

function correctionReviewBody(overrides: { head?: string; verdict?: string } = {}) {
  const head = overrides.head ?? CORRECTION_REVIEWED_HEAD
  return `## REVIEW_VERDICT

### Task log
- Task / Issue: #${ISSUE}
- Phase: Bounded correction review
- Reviewed PR: #${PR}
- Approved base: \`${BASE_SHA}\`
- Exact head reviewed: \`${head}\`
- Verdict: ${overrides.verdict ?? 'ELIGIBLE FOR FOUNDER REVIEW'}
`
}

function lineageCorrectionAuthorizationBody(overrides: {
  issue?: string
  pr?: string
  branch?: string
  head?: string
  baseSha?: string
  implementationResult?: string
  implementationReview?: string
  recoveryAuthorization?: string
  recoveryImplementationResult?: string
  recoveryImplementationReview?: string
} = {}) {
  return `## FOUNDER AUTHORIZATION — RECOVER-STATE-LINEAGE-001

The Founder approves exactly one bounded correction: \`RECOVER-STATE-LINEAGE-001\`.

### Exact binding

- Repository: \`${REPOSITORY}\`
- Issue: #${overrides.issue ?? ISSUE}
- PR: #${overrides.pr ?? PR}
- Branch: \`${overrides.branch ?? BRANCH}\`
- Protected base: \`${BASE}@${overrides.baseSha ?? BASE_SHA}\`
- Current exact head at authorization: \`${overrides.head ?? CURRENT_HEAD}\`
- Historical adopt-finding implementation RESULT: \`${overrides.implementationResult ?? IMPLEMENTATION_RESULT_COMMENT}\`
- Historical adopt-finding implementation REVIEW_VERDICT: \`${overrides.implementationReview ?? IMPLEMENTATION_REVIEW_COMMENT}\`
- Missing-state recovery authorization: \`${overrides.recoveryAuthorization ?? RECOVERY_AUTHORIZATION_COMMENT}\`
- Missing-state recovery implementation RESULT: \`${overrides.recoveryImplementationResult ?? RECOVERY_IMPLEMENTATION_RESULT_COMMENT}\`
- Missing-state recovery bounded REVIEW_VERDICT: \`${overrides.recoveryImplementationReview ?? RECOVERY_IMPLEMENTATION_REVIEW_COMMENT}\`

### Approved semantic correction

Historical adopt-finding evidence remains bound to its original head; the current recovery head is independently validated.
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
    comment(RECOVERY_IMPLEMENTATION_RESULT_COMMENT, recoveryImplementationResultBody(), { created_at: '2026-08-07T19:42:00+07:00' }),
    comment(RECOVERY_IMPLEMENTATION_REVIEW_COMMENT, recoveryImplementationReviewBody(), { created_at: '2026-08-07T19:59:57Z' }),
    comment(LINEAGE_CORRECTION_AUTHORIZATION_COMMENT, lineageCorrectionAuthorizationBody(), { created_at: '2026-08-07T20:10:00Z' }),
    comment(CORRECTION_RESULT_COMMENT, correctionResultBody({ head: CURRENT_HEAD }), { created_at: '2026-08-07T21:59:51+07:00' }),
    comment(CORRECTION_REVIEW_COMMENT, correctionReviewBody({ head: CURRENT_HEAD }), { created_at: '2026-08-07T15:10:00Z' }),
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
    lineageCorrectionAuthorizationComment: LINEAGE_CORRECTION_AUTHORIZATION_COMMENT,
    correctionResultComment: CORRECTION_RESULT_COMMENT,
    correctionReviewComment: CORRECTION_REVIEW_COMMENT,
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
  const ancestryCalls: Array<{
    repository: string
    base: string
    baseSha: string
    ancestor: string
    descendant: string
  }> = []
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
    verifyCommitAncestry: async ({
      repository,
      base,
      baseSha,
      ancestor,
      descendant,
    }: {
      repository: string
      base: string
      baseSha: string
      ancestor: string
      descendant: string
    }) => {
      ancestryCalls.push({ repository, base, baseSha, ancestor, descendant })
      const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
      if (result.status === 0) return true
      if (result.status === 1) return false
      throw new Error(result.stderr || result.error?.message || 'git ancestry proof failed')
    },
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
    ancestryCalls,
    get writes() { return writes.length },
    get body() { return issueBody },
    set body(next: string) { issueBody = next },
    get comments() { return comments },
    set comments(next: Comment[]) { comments = next },
  }
}

describe(COMMAND, () => {
  it('projects the reconstructed state from validated evidence without mutating inputs', () => {
    const predecessor = {
      counters: { reviewCycle: 1, fullReviewCount: 1 },
      updatedAt: '2026-08-08T01:02:03Z',
      reviewedHead: REVIEWED_HEAD,
      contract: { mode: 'implementation_pr' },
      findingIds: ['CLI-IDEMPOTENCY-001', 'CLI-SCHEMA-001'],
    }
    const pr = {
      baseRefName: BASE,
      headRefOid: CURRENT_HEAD,
    }
    const policy = {
      guideVersion: '1.3.0',
      ref: 'main',
      sha: POLICY_BLOB_SHA,
    }
    const options = { issueNumber: ISSUE, expectedPr: PR, predecessorComment: PREDECESSOR_COMMENT }
    const before = structuredClone({ predecessor, pr, policy, options })

    const state = buildReconstructedState({
      options,
      pr,
      predecessor,
      policy,
      evidenceFingerprint: 'e'.repeat(64),
    })

    expect(state).toEqual({
      schema_version: 1,
      state: 'CORRECTION_REQUIRED_1',
      review_cycle: 1,
      full_review_count: 1,
      approved_base: BASE,
      active_task_issue: '#276',
      active_pr: '#292',
      current_head: CURRENT_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      workflow_mode: 'implementation_pr',
      guide_version: '1.3.0',
      guide_source_ref: 'main',
      guide_source_sha: POLICY_BLOB_SHA,
      latest_review_verdict_comment_id: PREDECESSOR_COMMENT,
      open_blockers: predecessor.findingIds,
      follow_up_issues: [],
      next_permitted_action: 'Re-attempt Founder-authorized bemoat:mission-control:adopt-finding for Issue #276 after fresh live verification; do not execute automatically.',
      material_change_status: 'none',
      updated_at: '2026-08-08T01:02:03Z',
      updated_by: 'Mission Control Missing-State Recovery',
      recovery_evidence_fingerprint: 'e'.repeat(64),
    })
    expect({ predecessor, pr, policy, options }).toEqual(before)
  })

  it('does not write to frozen validated evidence while projecting state', () => {
    const predecessor = Object.freeze({
      counters: Object.freeze({ reviewCycle: 2, fullReviewCount: 1 }),
      updatedAt: '2026-08-08T01:02:03Z',
      reviewedHead: REVIEWED_HEAD,
      contract: Object.freeze({ mode: 'planning_no_pr' }),
      findingIds: Object.freeze(['CLI-IDEMPOTENCY-001']),
    })

    expect(() => buildReconstructedState({
      options: { issueNumber: ISSUE, expectedPr: PR, predecessorComment: PREDECESSOR_COMMENT },
      pr: Object.freeze({ baseRefName: BASE, headRefOid: CURRENT_HEAD }),
      predecessor,
      policy: Object.freeze({ guideVersion: '1.3.0', ref: 'main', sha: POLICY_BLOB_SHA }),
      evidenceFingerprint: 'f'.repeat(64),
    })).not.toThrow()
  })

  it('accepts an immutable recovery anchor when the correction-reviewed live head is a later descendant', async () => {
    const harness = createHarness({
      pullRequest: { headRefOid: CORRECTION_REVIEWED_HEAD },
    })
    harness.comments = harness.comments.map((entry) => {
      if (entry.id === RECOVERY_AUTHORIZATION_COMMENT) {
        return { ...entry, body: recoveryAuthorizationBody({ head: CURRENT_HEAD }) }
      }
      if (entry.id === LINEAGE_CORRECTION_AUTHORIZATION_COMMENT) {
        return { ...entry, body: lineageCorrectionAuthorizationBody({ head: CURRENT_HEAD }) }
      }
      if (entry.id === CORRECTION_RESULT_COMMENT) {
        return { ...entry, body: correctionResultBody() }
      }
      if (entry.id === CORRECTION_REVIEW_COMMENT) {
        return { ...entry, body: correctionReviewBody() }
      }
      return entry
    })

    const result = await runRecoverState({
      options: options({
        expectedHead: CORRECTION_REVIEWED_HEAD,
        correctionResultComment: CORRECTION_RESULT_COMMENT,
        correctionReviewComment: CORRECTION_REVIEW_COMMENT,
      }),
      deps: harness.deps,
    })

    expect(result.classification).toBe('SUCCESS')
    expect(result.state?.current_head).toBe(CORRECTION_REVIEWED_HEAD)
    expect(result.evidenceIds).toMatchObject({
      recovery_authorization_anchor_head: CURRENT_HEAD,
      correction_reviewed_head: CORRECTION_REVIEWED_HEAD,
    })
  })

  it('returns HEAD_DRIFT when the live PR exact head differs from the correction-reviewed head', async () => {
    const harness = createHarness({
      pullRequest: { headRefOid: CORRECTION_REVIEWED_HEAD },
    })

    await expect(runRecoverState({
      options: options({ expectedHead: CORRECTION_REVIEWED_HEAD }),
      deps: harness.deps,
    })).rejects.toThrow(/HEAD_DRIFT/)
    expect(harness.writes).toBe(0)
  })

  it('fails closed when the historical recovery authorization anchor is changed or mismatched', async () => {
    const harness = createHarness()
    harness.comments = harness.comments.map((entry) => entry.id === RECOVERY_AUTHORIZATION_COMMENT
      ? { ...entry, body: recoveryAuthorizationBody({ head: NON_ANCESTOR_HEAD }) }
      : entry)

    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/HEAD_DRIFT/)
    expect(harness.writes).toBe(0)
  })

  it('accepts historical adopt-finding evidence at an ancestor head of the current recovery head', async () => {
    const harness = createHarness()
    const result = await runRecoverState({ options: options(), deps: harness.deps })

    expect(result.classification).toBe('SUCCESS')
    expect(result.state).toMatchObject({
      current_head: CURRENT_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
    })
    expect(result.evidenceIds).toMatchObject({
      historical_adopt_finding_head: HISTORICAL_ADOPT_HEAD,
      current_recovery_head: CURRENT_HEAD,
      correction_reviewed_head: CURRENT_HEAD,
      live_pr_exact_head: CURRENT_HEAD,
      ancestry_proof: 'historical_adopt_finding_head_is_ancestor_of_current_recovery_head',
    })
    expect(harness.comments.find((entry) => entry.id === IMPLEMENTATION_RESULT_COMMENT)?.body)
      .toContain(`Head: \`${HISTORICAL_ADOPT_HEAD}\``)
    expect(harness.comments.find((entry) => entry.id === IMPLEMENTATION_REVIEW_COMMENT)?.body)
      .toContain(`**Exact head reviewed:** \`${HISTORICAL_ADOPT_HEAD}\``)
    expect(harness.ancestryCalls).toHaveLength(2)
    expect(harness.ancestryCalls).toEqual([
      {
        repository: REPOSITORY,
        base: BASE,
        baseSha: BASE_SHA,
        ancestor: HISTORICAL_ADOPT_HEAD,
        descendant: CURRENT_HEAD,
      },
      {
        repository: REPOSITORY,
        base: BASE,
        baseSha: BASE_SHA,
        ancestor: HISTORICAL_ADOPT_HEAD,
        descendant: CURRENT_HEAD,
      },
    ])
  })

  it('rejects historical adopt-finding RESULT and REVIEW_VERDICT heads that disagree', async () => {
    const harness = createHarness()
    harness.comments = harness.comments.map((entry) => entry.id === IMPLEMENTATION_REVIEW_COMMENT
      ? { ...entry, body: implementationReviewBody({ head: NON_ANCESTOR_HEAD }) }
      : entry)

    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/HEAD_DRIFT|EVIDENCE_CONFLICT/)
    expect(harness.writes).toBe(0)
  })

  it('rejects a historical adopt-finding head that is not an ancestor of the current recovery head', async () => {
    const harness = createHarness()
    harness.comments = harness.comments.map((entry) => {
      if (entry.id === IMPLEMENTATION_RESULT_COMMENT) return { ...entry, body: implementationResultBody({ head: NON_ANCESTOR_HEAD }) }
      if (entry.id === IMPLEMENTATION_REVIEW_COMMENT) return { ...entry, body: implementationReviewBody({ head: NON_ANCESTOR_HEAD }) }
      if (entry.id === RECOVERY_AUTHORIZATION_COMMENT) return { ...entry, body: recoveryAuthorizationBody({ head: NON_ANCESTOR_HEAD }) }
      return entry
    })

    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/HEAD_DRIFT/)
    expect(harness.writes).toBe(0)
  })

  it('rejects a historical head that is a descendant of the current recovery head', async () => {
    const harness = createHarness({
      pullRequest: { headRefOid: HISTORICAL_ADOPT_HEAD },
    })
    harness.comments = harness.comments.map((entry) => {
      if (entry.id === IMPLEMENTATION_RESULT_COMMENT) return { ...entry, body: implementationResultBody({ head: CURRENT_HEAD }) }
      if (entry.id === IMPLEMENTATION_REVIEW_COMMENT) return { ...entry, body: implementationReviewBody({ head: CURRENT_HEAD }) }
      if (entry.id === RECOVERY_AUTHORIZATION_COMMENT) return { ...entry, body: recoveryAuthorizationBody({ head: CURRENT_HEAD }) }
      if (entry.id === RECOVERY_IMPLEMENTATION_RESULT_COMMENT) return { ...entry, body: recoveryImplementationResultBody({ head: HISTORICAL_ADOPT_HEAD }) }
      if (entry.id === RECOVERY_IMPLEMENTATION_REVIEW_COMMENT) return { ...entry, body: recoveryImplementationReviewBody({ head: HISTORICAL_ADOPT_HEAD }) }
      if (entry.id === LINEAGE_CORRECTION_AUTHORIZATION_COMMENT) return { ...entry, body: lineageCorrectionAuthorizationBody({ head: HISTORICAL_ADOPT_HEAD }) }
      return entry
    })

    await expect(runRecoverState({ options: options({ expectedHead: HISTORICAL_ADOPT_HEAD }), deps: harness.deps })).rejects.toThrow(/HEAD_DRIFT/)
    expect(harness.writes).toBe(0)
  })

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
    expect(help.required_inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'lineage_correction_authorization_comment',
        syntax: '--lineage-correction-authorization-comment <id>',
      }),
      expect.objectContaining({
        name: 'correction_result_comment',
        syntax: '--correction-result-comment <id>',
      }),
      expect.objectContaining({
        name: 'correction_review_comment',
        syntax: '--correction-review-comment <id>',
      }),
    ]))
    expect(help.trusted_derived_values).toEqual(expect.arrayContaining([
      'historical adopt-finding implementation head',
      'recovery authorization-bound head and recovery implementation anchor head',
      'correction-reviewed head and current live PR exact head',
      'trusted Git ancestry proofs between the distinct lineage heads',
    ]))
    expect(help.required_evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('historical adopt-finding head'),
    ]))
    expect(help.stop_conditions).toEqual(expect.arrayContaining([
      expect.stringContaining('failed ancestry proof'),
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
    if (!result.state) throw new Error('successful recovery must return a state')
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
    if (!result.state) throw new Error('successful recovery must return a state')
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
    if (!result.state) throw new Error('successful recovery must return a state')
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
    const wrongBranch = createHarness({ pullRequest: { headRefName: 'other-branch' } })
    await expect(runRecoverState({ options: options(), deps: wrongBranch.deps })).rejects.toThrow(/HEAD_DRIFT/)

    const wrongBase = createHarness({ pullRequest: { baseRefOid: '8'.repeat(40) } })
    await expect(runRecoverState({ options: options(), deps: wrongBase.deps })).rejects.toThrow(/HEAD_DRIFT/)

    const wrongHead = createHarness({ pullRequest: { headRefOid: HISTORICAL_ADOPT_HEAD } })
    await expect(runRecoverState({ options: options(), deps: wrongHead.deps })).rejects.toThrow(/HEAD_DRIFT/)
  })

  it('rejects current recovery RESULT and REVIEW_VERDICT heads that disagree', async () => {
    const harness = createHarness()
    harness.comments = harness.comments.map((entry) => entry.id === RECOVERY_IMPLEMENTATION_REVIEW_COMMENT
      ? { ...entry, body: recoveryImplementationReviewBody({ head: HISTORICAL_ADOPT_HEAD }) }
      : entry)

    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/HEAD_DRIFT/)
    expect(harness.writes).toBe(0)
  })

  it('rejects historical evidence from another PR, branch, or protected base', async () => {
    const wrongPr = createHarness()
    wrongPr.comments = wrongPr.comments.map((entry) => entry.id === IMPLEMENTATION_REVIEW_COMMENT
      ? { ...entry, body: implementationReviewBody().replace('**Reviewed PR:** 292', '**Reviewed PR:** 999') }
      : entry)
    await expect(runRecoverState({ options: options(), deps: wrongPr.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)

    const wrongBranch = createHarness()
    wrongBranch.comments = wrongBranch.comments.map((entry) => entry.id === IMPLEMENTATION_RESULT_COMMENT
      ? { ...entry, body: implementationResultBody().replace(BRANCH, 'feature/other-branch') }
      : entry)
    await expect(runRecoverState({ options: options(), deps: wrongBranch.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)

    const wrongBase = createHarness()
    wrongBase.comments = wrongBase.comments.map((entry) => entry.id === LINEAGE_CORRECTION_AUTHORIZATION_COMMENT
      ? { ...entry, body: lineageCorrectionAuthorizationBody({ baseSha: '8'.repeat(40) }) }
      : entry)
    await expect(runRecoverState({ options: options(), deps: wrongBase.deps })).rejects.toThrow(/HEAD_DRIFT/)

    const wrongHistoricalBase = createHarness()
    wrongHistoricalBase.comments = wrongHistoricalBase.comments.map((entry) => entry.id === IMPLEMENTATION_REVIEW_COMMENT
      ? { ...entry, body: implementationReviewBody().replace(BASE_SHA, '8'.repeat(40)) }
      : entry)
    await expect(runRecoverState({ options: options(), deps: wrongHistoricalBase.deps })).rejects.toThrow(/HEAD_DRIFT/)
  })

  it('does not expose an arbitrary historical-head selector to callers', () => {
    const contract = getCommandContract(COMMAND) as unknown as {
      required_inputs: Array<{ name: string }>
      optional_flags: Array<{ name: string }>
    }
    const names = [...contract.required_inputs, ...contract.optional_flags].map((input) => input.name)
    expect(names).not.toContain('historical_head')
    expect(names).not.toContain('historical_adopt_finding_head')
    expect(names).toContain('lineage_correction_authorization_comment')
  })

  it('fails closed when trusted ancestry proof is unavailable', async () => {
    const harness = createHarness()
    harness.deps.verifyCommitAncestry = undefined as never

    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/BLOCKED_EXTERNAL/)
    expect(harness.writes).toBe(0)
  })

  it('requires the trusted Founder identity and immutable non-superseded authorities', async () => {
    const harness = createHarness()
    harness.deps.readTrustedFounderLogins = async () => ['someone-else']
    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/AUTHORITY_CONFLICT/)

    const superseded = createHarness({
      extraComments: [comment('5217000003', `supersedes: ${RECOVERY_AUTHORIZATION_COMMENT}\nnot authoritative`)],
    })
    await expect(runRecoverState({ options: options(), deps: superseded.deps })).rejects.toThrow(/AUTHORITY_CONFLICT/)

    const supersededHistorical = createHarness({
      extraComments: [comment('5217000007', `supersedes: ${IMPLEMENTATION_REVIEW_COMMENT}\nnot authoritative`)],
    })
    await expect(runRecoverState({ options: options(), deps: supersededHistorical.deps })).rejects.toThrow(/AUTHORITY_CONFLICT/)
  })

  it('does not treat an approved handoff link as superseding its referenced authorization', async () => {
    const handoff = createHarness({
      extraComments: [comment('5220485844', `## HANDOFF

Links: authorization https://github.com/${REPOSITORY}/issues/${ISSUE}#issuecomment-${LINEAGE_CORRECTION_AUTHORIZATION_COMMENT}
Stop on ambiguous authority, missing/competing/superseded evidence, failed ancestry, or scope expansion.`)],
    })

    const result = await runRecoverState({
      options: options(),
      deps: handoff.deps,
      checkOnly: true,
    })

    expect(result.classification).toBe('SUCCESS')
    expect(handoff.writes).toBe(0)
  })

  it('does not treat role-heading references in an approved handoff as competing evidence', async () => {
    const handoff = createHarness({
      pullRequest: { headRefOid: CORRECTION_REVIEWED_HEAD },
      extraComments: [comment('5220485844', `## HANDOFF

State: head \`${CORRECTION_REVIEWED_HEAD}\`
Next: Dev returns \`## RESULT\`, then an independent review; do not execute \`adopt-finding\`.`)],
    })
    handoff.comments = handoff.comments.map((entry) => entry.id === CORRECTION_RESULT_COMMENT
      ? { ...entry, body: correctionResultBody() }
      : entry.id === CORRECTION_REVIEW_COMMENT
        ? { ...entry, body: correctionReviewBody() }
        : entry)

    const result = await runRecoverState({
      options: options({ expectedHead: CORRECTION_REVIEWED_HEAD }),
      deps: handoff.deps,
    })

    expect(result.classification).toBe('SUCCESS')
  })

  it('rejects competing historical adopt-finding evidence', async () => {
    const harness = createHarness({
      extraComments: [comment('5217000008', implementationResultBody())],
    })

    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)
    expect(harness.writes).toBe(0)
  })

  it('rejects evidence that proves live adopt-finding was executed', async () => {
    const harness = createHarness()
    harness.comments = harness.comments.map((entry) => entry.id === IMPLEMENTATION_RESULT_COMMENT
      ? { ...entry, body: implementationResultBody({ executed: true }) }
      : entry)

    await expect(runRecoverState({ options: options(), deps: harness.deps })).rejects.toThrow(/AUTHORITY_CONFLICT/)
    expect(harness.writes).toBe(0)
  })

  it('rejects a missing or wrong lineage-correction authorization selector', async () => {
    const missing = createHarness()
    const missingResult = await main([
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
    ], missing.deps)
    expect(missingResult.classification).toBe('INVALID_INVOCATION')
    expect(missing.writes).toBe(0)

    const wrong = createHarness()
    await expect(runRecoverState({
      options: options({ lineageCorrectionAuthorizationComment: RECOVERY_AUTHORIZATION_COMMENT }),
      deps: wrong.deps,
    })).rejects.toThrow(/AUTHORITY_CONFLICT|EVIDENCE_CONFLICT/)
    expect(wrong.writes).toBe(0)
  })

  it('fails closed when correction RESULT/review selectors are missing, edited, superseded, duplicated, or differently bound', async () => {
    const missing = createHarness()
    const missingResult = await main([
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
      '--lineage-correction-authorization-comment', LINEAGE_CORRECTION_AUTHORIZATION_COMMENT,
      '--correction-result-comment', CORRECTION_RESULT_COMMENT,
      '--check', '--json',
    ], missing.deps)
    expect(missingResult.classification).toBe('INVALID_INVOCATION')
    expect(missing.writes).toBe(0)

    const edited = createHarness()
    edited.comments = edited.comments.map((entry) => entry.id === CORRECTION_RESULT_COMMENT
      ? { ...entry, updated_at: '2026-08-08T00:00:00Z' }
      : entry)
    await expect(runRecoverState({ options: options(), deps: edited.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)

    const superseded = createHarness({
      extraComments: [comment('5217000010', `supersedes: ${CORRECTION_RESULT_COMMENT}\nnot authoritative`)],
    })
    await expect(runRecoverState({ options: options(), deps: superseded.deps })).rejects.toThrow(/AUTHORITY_CONFLICT/)

    const duplicated = createHarness({
      extraComments: [comment('5217000011', correctionResultBody({ head: CURRENT_HEAD }))],
    })
    await expect(runRecoverState({ options: options(), deps: duplicated.deps })).rejects.toThrow(/EVIDENCE_CONFLICT/)

    const differentlyBound = createHarness()
    differentlyBound.comments = differentlyBound.comments.map((entry) => entry.id === CORRECTION_REVIEW_COMMENT
      ? { ...entry, body: correctionReviewBody({ head: NON_ANCESTOR_HEAD }) }
      : entry)
    await expect(runRecoverState({ options: options(), deps: differentlyBound.deps })).rejects.toThrow(/HEAD_DRIFT/)
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
      '--lineage-correction-authorization-comment', LINEAGE_CORRECTION_AUTHORIZATION_COMMENT,
      '--correction-result-comment', CORRECTION_RESULT_COMMENT,
      '--correction-review-comment', CORRECTION_REVIEW_COMMENT,
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
