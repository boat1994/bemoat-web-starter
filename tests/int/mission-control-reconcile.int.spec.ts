import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import * as reconcileModule from '../../scripts/mission-control-reconcile.mjs'

// Shared .mjs scripts expose runtime behavior, not TypeScript declarations. Keep
// the strict-project boundary explicit without changing the production API.
const {
  analyzeReconciliation,
  classifyDeliveryLag,
  classifyMergeDrift,
  classifyReviewLag,
  founderMergeTransitionAuthorized,
  isGenuineStateConflict,
  parseRoleCommentBody,
  proposeDeliveryReconciliation,
  proposeReviewReconciliation,
} = reconcileModule as unknown as Record<string, (...args: any[]) => any>

const sampleResult = `## RESULT

### Task log
- Timestamp: 2026-07-17T10:00:00+07:00
- Task / Issue: #120
- Phase: Dev (implementation)
- Executing role: Dev / Builder

**Completed:** Dev (implementation)
**State:** branch \`feature/120\` · base \`main\` · head \`abc1234\`
**PR:** https://github.com/boat1994/bemoat-web-starter/pull/121
**Managed state:** AWAITING_REVIEW_1 · PR #121 · \`abc1234\`
**Summary:** Mission Control v1.1 policy
**Next:** Reviewer ## REVIEW_VERDICT
`

const sampleVerdict = `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-07-17T11:00:00+07:00
- Task / Issue: #120
- Phase: Reviewer
- Executing role: Reviewer / Red Team

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/121 · \`main\` · \`abc1234\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Managed state:** ELIGIBLE_FOR_FOUNDER_REVIEW · cycle 1 · last_reviewed_head \`abc1234\`
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass
**Next:** Founder merge authorization
`

describe('mission-control reconcile classifiers', () => {
  it('parses RESULT and REVIEW_VERDICT role comments', () => {
    const result = parseRoleCommentBody(sampleResult)
    const verdict = parseRoleCommentBody(sampleVerdict)

    expect(result.role).toBe('RESULT')
    expect(result.prNumber).toBe('121')
    expect(result.headSha).toBe('abc1234')

    expect(verdict.role).toBe('REVIEW_VERDICT')
    expect(verdict.verdict).toBe('ELIGIBLE FOR FOUNDER REVIEW')
    expect(verdict.headSha).toBe('abc1234')
  })

  it('scenario 1: valid delivery does not require conflict before Review 1', () => {
    const lag = classifyDeliveryLag(
      { state: 'IN_PROGRESS', active_pr: null, current_head: null },
      { number: '121', headRefOid: 'abc1234' },
      { exactHeadVerified: true },
      { parsed: parseRoleCommentBody(sampleResult) },
    )

    expect(lag.kind).toBe('DETERMINISTIC_RECONCILIATION')
    expect(lag.lag).toBe(true)
  })

  it('scenario 2: reviewer verdict proposes atomic managed state', () => {
    const fields = proposeReviewReconciliation({
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewedHead: 'abc1234',
      reviewCycle: 0,
      fullReviewCount: 0,
    })

    expect(fields.state).toBe('ELIGIBLE_FOR_FOUNDER_REVIEW')
    expect(fields.last_reviewed_head).toBe('abc1234')
    expect(fields.review_cycle).toBe(1)
    expect(fields.full_review_count).toBe(1)
    expect(fields.next_permitted_action).toBe('Founder merge authorization required before merge.')
  })

  it('BLOCKED FOR FOUNDER DECISION next action is Approve/Decline without pre-approval prompt', () => {
    const fields = proposeReviewReconciliation({
      verdict: 'BLOCKED FOR FOUNDER DECISION',
      reviewedHead: 'abc1234',
      reviewCycle: 3,
      fullReviewCount: 1,
    })

    expect(fields.state).toBe('BLOCKED_FOR_FOUNDER_DECISION')
    expect(fields.next_permitted_action).toContain('Approve or Decline')
    expect(fields.next_permitted_action).toContain('no implementation prompt until Approve')
  })

  it('scenario 3: stale post-RESULT state reconciles deterministically', () => {
    const proposal = proposeDeliveryReconciliation({
      livePr: { number: '121', headRefOid: 'abc1234', baseRefName: 'main' },
      activeTaskIssue: '120',
      latestResult: { parsed: parseRoleCommentBody(sampleResult) },
    })

    expect(proposal).toMatchObject({
      state: 'AWAITING_REVIEW_1',
      active_pr: '"#121"',
      current_head: 'abc1234',
      review_cycle: 0,
      full_review_count: 0,
    })
  })

  it('scenario 4: contradictory head evidence is a genuine conflict', () => {
    const lag = classifyDeliveryLag(
      { state: 'IN_PROGRESS', active_pr: '#121', current_head: 'oldhead' },
      { number: '121', headRefOid: 'newhead' },
      { exactHeadVerified: true },
      { parsed: { headSha: 'oldhead', prNumber: '121' } },
    )

    expect(lag.kind).toBe('STATE_CONFLICT')
    expect(
      isGenuineStateConflict({
        headMismatch: true,
        stateConflictBlockers: ['STATE_CONFLICT: state current_head does not match the live PR head.'],
      }),
    ).toBe(true)
  })

  it('fails closed when RESULT omits a PR identifier', () => {
    const lag = classifyDeliveryLag(
      { state: 'IN_PROGRESS', active_pr: '#123', current_head: null },
      { number: '123', headRefOid: 'abc1234' },
      { exactHeadVerified: true },
      { parsed: { headSha: 'abc1234', prNumber: null } },
    )

    expect(lag.kind).toBe('STATE_CONFLICT')
    expect(lag.reason).toContain('RESULT PR identifier missing')
  })

  it('fails closed when REVIEW_VERDICT omits a PR identifier', () => {
    const lag = classifyReviewLag(
      { state: 'AWAITING_REVIEW_1', review_cycle: 0, last_reviewed_head: null },
      { number: '123', headRefOid: 'abc1234' },
      { parsed: { verdict: 'ELIGIBLE FOR FOUNDER REVIEW', headSha: 'abc1234', prNumber: null } },
    )

    expect(lag.kind).toBe('STATE_CONFLICT')
    expect(lag.reason).toContain('REVIEW_VERDICT PR identifier missing')
  })

  it('fails closed when RESULT references a different PR at the same head', () => {
    const lag = classifyDeliveryLag(
      { state: 'IN_PROGRESS', active_pr: '#123', current_head: null },
      { number: '123', headRefOid: 'abc1234' },
      { exactHeadVerified: true },
      { parsed: { headSha: 'abc1234', prNumber: '121' } },
    )

    expect(lag.kind).toBe('STATE_CONFLICT')
    expect(lag.reason).toContain('RESULT PR does not match live PR')
  })

  it('fails closed when REVIEW_VERDICT references a different PR at the same head', () => {
    const lag = classifyReviewLag(
      { state: 'AWAITING_REVIEW_1', review_cycle: 0, last_reviewed_head: null },
      { number: '123', headRefOid: 'abc1234' },
      { parsed: { verdict: 'ELIGIBLE FOR FOUNDER REVIEW', headSha: 'abc1234', prNumber: '121' } },
    )

    expect(lag.kind).toBe('STATE_CONFLICT')
    expect(lag.reason).toContain('REVIEW_VERDICT PR does not match live PR')
  })

  it('scenario 5: founder merge transition stays separate from migration/deploy', () => {
    const mergeOnly = founderMergeTransitionAuthorized({ mergeAuthorized: true })
    const mergeAndDeploy = founderMergeTransitionAuthorized({
      mergeAuthorized: true,
      deployAuthorized: true,
    })

    expect(mergeOnly.boundedSequence).toBe(true)
    expect(mergeOnly.migrationAllowed).toBe(false)
    expect(mergeAndDeploy.boundedSequence).toBe(false)
    expect(mergeAndDeploy.deployAllowed).toBe(true)
  })

  it('scenario 6: head drift during merge transition blocks the operation', () => {
    expect(classifyMergeDrift('authorizedhead', 'livehead')).toMatchObject({ drift: true })
    expect(classifyMergeDrift('samehead', 'samehead')).toMatchObject({ drift: false })
  })

  it('scenario 7: delivery reconciliation never increments review counters', () => {
    const proposal = proposeDeliveryReconciliation({
      livePr: { number: '121', headRefOid: 'abc1234' },
      activeTaskIssue: '120',
      latestResult: { parsed: parseRoleCommentBody(sampleResult) },
    })

    expect(proposal.review_cycle).toBe(0)
    expect(proposal.full_review_count).toBe(0)
  })

  it('detects post-review bookkeeping lag from verdict evidence', () => {
    const lag = classifyReviewLag(
      { state: 'AWAITING_REVIEW_1', review_cycle: 0, last_reviewed_head: null },
      { headRefOid: 'abc1234' },
      { parsed: parseRoleCommentBody(sampleVerdict) },
    )

    expect(lag.kind).toBe('DETERMINISTIC_RECONCILIATION')
  })

  it('analyzeReconciliation returns a delivery proposal without genuine conflict', () => {
    const analysis = analyzeReconciliation({
      managedState: {
        state: 'READY',
        active_pr: null,
        current_head: null,
        approved_base: 'main',
        review_cycle: 0,
        full_review_count: 0,
      },
      livePr: { number: '121', headRefOid: 'abc1234', baseRefName: 'main' },
      exactHeadCi: { exactHeadVerified: true },
      latestResult: { parsed: parseRoleCommentBody(sampleResult) },
      latestVerdict: null,
      activeTaskIssue: '120',
      stateConflictBlockers: [],
    })

    expect(analysis.genuineConflict).toBe(false)
    expect(analysis.proposal?.type).toBe('delivery')
    expect(analysis.proposal?.fields.state).toBe('AWAITING_REVIEW_1')
  })

  it('records review_cycle 1 after a completed eligible Review 1 verdict', () => {
    const fields = proposeReviewReconciliation({
      verdict: 'CORRECTION REQUIRED',
      reviewedHead: 'abc1234',
      reviewCycle: 0,
      fullReviewCount: 0,
    })

    expect(fields.state).toBe('CORRECTION_REQUIRED_1')
    expect(fields.review_cycle).toBe(1)
    expect(fields.full_review_count).toBe(1)
  })

  it('rejects CORRECTION REQUIRED on Review 3 (reviewCycle: 2) because Review 4 does not exist', () => {
    const fields = proposeReviewReconciliation({
      verdict: 'CORRECTION REQUIRED',
      reviewedHead: 'abc1234',
      reviewCycle: 2,
      fullReviewCount: 1,
    })

    expect(fields.state).toBe('STATE_CONFLICT')
    expect(fields.review_cycle).toBe(2)
    expect(fields.full_review_count).toBe(1)
    expect(fields.next_permitted_action).toMatch(/contradictory evidence/)
  })
})
