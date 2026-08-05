import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

const INCIDENT_HEAD = 'c44bf1bc379fe4160946dce96e5a4d7abae7b5b0'
const PREVIOUS_REVIEW_HEAD = '301ae166052af036ce4d727be59d8d20cc8c02d1'
const FINDING_IDS = Array.from({ length: 7 }, (_, index) => `MC-R1-00${index + 1}`)

const recoveryModulePromise = import('../../scripts/mission-control/domain/review-recovery.mjs')
const registryModulePromise = import('../../scripts/mission-control/transport-registry.mjs')
const workflowModulePromise = import('../../scripts/mission-control/workflows/recover-review.mjs')
const reconcileModulePromise = import('../../scripts/mission-control-reconcile.mjs')

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function rawIncidentBody(): string {
  return `## REVIEW_VERDICT

**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**State:** head \`${INCIDENT_HEAD}\`
**Findings:** Critical: None · Important: MC-R1-001..MC-R1-007 resolved
`
}

function buildIncidentRecord(
  buildRecoveryRecord: (input: Record<string, unknown>) => Record<string, unknown>,
  issueBody: string,
  prBody: string,
) {
  return buildRecoveryRecord({
    repository: 'boat1994/bemoat-web-starter',
    task_issue: 274,
    pr: 275,
    base: 'main',
    exact_head: INCIDENT_HEAD,
    prior_last_reviewed_head: PREVIOUS_REVIEW_HEAD,
    review_type: 'delta',
    verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
    reviewer_identity: {
      login: 'boat1994',
      github_database_id: 36528988,
      author_association: 'OWNER',
      trust_source: 'repository-owned reviewer trust policy',
    },
    expected_prior_state: 'AWAITING_REVIEW_2',
    expected_prior_counters: { review_cycle: 1, full_review_count: 1 },
    resulting_counters: { review_cycle: 2, full_review_count: 1 },
    lineage: {
      original_review_comment_id: 5187488219,
      correction_result_comment_id: 5187802812,
    },
    source_evidence: [
      {
        location: 'issue:274',
        comment_id: 5187836238,
        classification: 'noncanonical_malformed',
        body_sha256: sha256(issueBody),
      },
      {
        location: 'pull:275',
        comment_id: 5187837555,
        classification: 'noncanonical_duplicate',
        body_sha256: sha256(prBody),
      },
    ],
    resolved_findings: FINDING_IDS,
    ci: [
      { name: 'ci', check_run_id: 92212805944, conclusion: 'success', head_sha: INCIDENT_HEAD },
      { name: 'starter-ci', check_run_id: 92212805950, conclusion: 'success', head_sha: INCIDENT_HEAD },
    ],
    protected_base_sha: '8'.repeat(40),
    policy_source_sha: 'e'.repeat(40),
  })
}

describe('Mission Control review recovery transport', () => {
  it('registers one exceptional recovery route without changing ordinary review ownership', async () => {
    const { CANONICAL_TRANSPORTS, getTransportRoute } = await registryModulePromise

    expect(getTransportRoute('bemoat:mission-control:recover-review')).toMatchObject({
      owner: 'Mission Control Recovery Transport',
      role: 'REVIEW_VERDICT',
      exceptional: true,
      ordinary_owner: 'bemoat:mission-control:review',
    })
    expect(CANONICAL_TRANSPORTS.filter((route) => route.role === 'REVIEW_VERDICT')).toHaveLength(2)
  })

  it('requires the merged-guide Review 2 projection to be exactly 2/1', async () => {
    const { buildRecoveryRecord, validateRecoveryRecord } = await recoveryModulePromise
    const issueBody = rawIncidentBody()
    const record = buildIncidentRecord(buildRecoveryRecord, issueBody, issueBody)

    expect(record).toMatchObject({
      record_kind: 'review_recovery',
      resulting_counters: { review_cycle: 2, full_review_count: 1 },
      source_evidence: [
        { comment_id: 5187836238, location: 'issue:274' },
        { comment_id: 5187837555, location: 'pull:275' },
      ],
    })
    expect(validateRecoveryRecord(record)).toMatchObject({ ok: true })

    const malformed = {
      ...record,
      resulting_counters: { review_cycle: 1, full_review_count: 1 },
    }
    expect(validateRecoveryRecord(malformed)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['resulting counters must be exactly 2/1']),
    })
  })

  it('quarantines the two raw incident comments only after a matching typed receipt exists', async () => {
    const { buildRecoveryRecord, detectUnaccountedReviewEvidence, renderRecoveryReceipt } =
      await recoveryModulePromise
    const issueBody = rawIncidentBody()
    const prBody = issueBody
    const record = buildIncidentRecord(buildRecoveryRecord, issueBody, prBody)
    const receipt = {
      id: 'recovery-1',
      body: renderRecoveryReceipt(record),
      createdAt: '2026-08-05T13:00:00+07:00',
    }
    const issueComments = [
      {
        id: '5187836238',
        body: issueBody,
        createdAt: '2026-08-05T12:00:00+07:00',
        author: 'boat1994',
        author_association: 'OWNER',
      },
    ]
    const prComments = [
      {
        id: '5187837555',
        body: prBody,
        createdAt: '2026-08-05T12:01:00+07:00',
        author: 'boat1994',
        author_association: 'OWNER',
      },
    ]
    const context = {
      repository: 'boat1994/bemoat-web-starter',
      taskIssue: 274,
      activePr: 275,
      managedState: {
        state: 'AWAITING_REVIEW_2',
        active_pr: '#275',
        current_head: INCIDENT_HEAD,
        updated_at: '2026-08-05T11:00:00+07:00',
        latest_review_verdict_comment_id: '5187488219',
      },
    }

    const blocked = detectUnaccountedReviewEvidence({
      ...context,
      issueComments,
      prComments,
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe('NONCANONICAL_ROLE_EVIDENCE')
    expect(blocked.recoveryCommand).toContain('bemoat:mission-control:recover-review')

    const accounted = detectUnaccountedReviewEvidence({
      ...context,
      issueComments: [...issueComments, receipt],
      prComments,
    })
    expect(accounted).toMatchObject({ ok: true, quarantined: ['5187836238', '5187837555'] })
  })

  it('does not loosen the ordinary parser for prose-only PR references', async () => {
    const { parseOrdinaryReviewEvidence } = await recoveryModulePromise

    expect(parseOrdinaryReviewEvidence(`## REVIEW_VERDICT

The PR #275 is ready, but this is not a canonical binding.
`)).toMatchObject({
      canonical: false,
      pr: null,
    })
  })

  it('accepts only the pinned exact-incident CLI contract', async () => {
    const { parseRecoveryArgs } = await workflowModulePromise
    const options = parseRecoveryArgs([
      '274',
      '--repo', 'boat1994/bemoat-web-starter',
      '--expected-pr', '275',
      '--expected-base', 'main',
      '--expected-state', 'AWAITING_REVIEW_2',
      '--expected-head', INCIDENT_HEAD,
      '--expected-review-cycle', '1',
      '--expected-full-review-count', '1',
      '--review-type', 'delta',
      '--issue-source-comment', '5187836238',
      '--pr-source-comment', '5187837555',
      '--original-review-comment', '5187488219',
      '--correction-result-comment', '5187802812',
      '--body-file', 'recovery.md',
    ])

    expect(options).toMatchObject({ issueNumber: '274', expectedPr: '275', reviewType: 'delta' })
    expect(() => parseRecoveryArgs(['274', '--repo', 'other/repo'])).toThrow(
      /--expected-pr is required/,
    )
  })

  it('resumes an ambiguous recovery comment POST without posting a duplicate', async () => {
    const { Coordinator } = await reconcileModulePromise
    const body = `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-08-05T13:00:00+07:00
- Task / Issue: #274
- Phase: Review Recovery
- Executing role: Mission Control Recovery Transport

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/275 · \`main\` · \`${INCIDENT_HEAD}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder merge authorization
`
    let state: Record<string, unknown> = {
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      current_head: INCIDENT_HEAD,
      last_reviewed_head: PREVIOUS_REVIEW_HEAD,
      open_blockers: FINDING_IDS,
    }
    const comments: Array<Record<string, unknown>> = []
    let postAttempts = 0
    const coordinator = new Coordinator({
      readState: async () => structuredClone(state),
      writeState: async (next: Record<string, unknown>) => {
        state = structuredClone(next)
        return structuredClone(state)
      },
      listComments: async () => structuredClone(comments),
      postComment: async (commentBody: string) => {
        postAttempts += 1
        comments.push({ id: 'recovery-1', body: commentBody, author: 'boat1994', author_association: 'OWNER' })
        throw new Error('ambiguous network response after comment POST')
      },
      trustedAuthors: ['boat1994'],
      requireTrustedAuthor: true,
      trustedAssociations: ['OWNER'],
    })
    const result = await coordinator.integrateReviewVerdict({
      verdictBody: body,
      verifyPreconditions: async (): Promise<void> => undefined,
      projectState: (prior: Record<string, unknown>, comment: Record<string, unknown>, identity: unknown) => ({
        ...prior,
        state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        review_cycle: 2,
        full_review_count: 1,
        last_reviewed_head: INCIDENT_HEAD,
        open_blockers: [] as string[],
        latest_review_verdict_comment_id: comment.id,
        latest_transition_identity: JSON.stringify(identity),
      }),
      updatedAt: '2026-08-05T13:00:00+07:00',
      updatedBy: 'Mission Control Recovery Transport',
    })

    expect(result).toMatchObject({ outcome: 'REVIEWED', recovered: true, comment: { id: 'recovery-1' } })
    expect(postAttempts).toBe(1)
    expect(comments).toHaveLength(1)
  })
})
