import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import * as reconcileModule from '../../scripts/mission-control-reconcile.mjs'

// Shared .mjs scripts expose runtime behavior, not TypeScript declarations. Keep
// the strict-project boundary explicit without changing the production API.
const {
  analyzeReconciliation,
  classifyReconciliation,
  classifyDeliveryLag,
  classifyMergeDrift,
  classifyReviewLag,
  founderMergeTransitionAuthorized,
  dispatchManagedTask,
  isGenuineStateConflict,
  migrateLegacyManagedState,
  parseRoleCommentBody,
  proposeDeliveryReconciliation,
  proposeReviewReconciliation,
  runBoundedReconciliation,
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
  it.each([
    ['contradictory authority', { authoritativeContradiction: true }, 'STATE_CONFLICT'],
    ['unavailable evidence', { requiredEvidenceUnavailable: true }, 'BLOCKED_EXTERNAL'],
    ['legacy representation', { managedState: { post_budget_review_history: [] } }, 'DETERMINISTIC_MIGRATION'],
    ['bookkeeping lag', { bookkeepingProposal: { state: 'AWAITING_REVIEW_1' } }, 'BOOKKEEPING_REPAIR'],
    ['terminal lag', { terminal: { issueClosed: true, prMerged: true, reviewedHeadMatches: true, currentHeadMatches: true, mergeCommit: 'merge-sha', exactHeadCi: true }, managedState: { state: 'ELIGIBLE_FOR_FOUNDER_REVIEW' } }, 'TERMINAL_REPAIR'],
    ['identical evidence', { managedState: { state: 'DONE' }, terminal: { issueClosed: true, prMerged: true, reviewedHeadMatches: true, currentHeadMatches: true, mergeCommit: 'merge-sha', exactHeadCi: true } }, 'NO_OP'],
  ])('strictly classifies %s', (_name, evidence, expected) => {
    expect(classifyReconciliation(evidence).outcome).toBe(expected)
  })

  it('migrates the #155 legacy post-budget representation without resetting counters or lineage', () => {
    const migrated = migrateLegacyManagedState({
      state: 'STATE_CONFLICT',
      review_cycle: 3,
      full_review_count: 1,
      last_reviewed_head: 'review-4-head',
      finding_lineage: [
        { finding_id: 'MC-R1-002', disposition: 'open' },
        { finding_id: 'MC-STATE-155-002', disposition: 'resolved' },
      ],
      post_budget_review_history: [{
        review_number: 4,
        reviewed_head: 'review-4-head',
        verdict: 'BLOCKED FOR FOUNDER DECISION',
        finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
      }],
      founder_authorization: {
        status: 'approved',
        authority: 'Founder',
        scope: 'review',
        review_number: 4,
        reviewed_head: 'review-4-head',
        action: 'Authorize bounded Review 4',
        authorized_at: '2026-07-23T16:30:00Z',
      },
      founder_correction_authorization: {
        status: 'approved',
        authority: 'Founder',
        scope: 'correction',
        for_review_number: 4,
        reviewed_head: 'review-4-head',
        finding_ids: ['MC-R1-002'],
        action: 'Authorize one bounded correction',
        authorized_at: '2026-07-23T16:40:00Z',
      },
    })

    expect(migrated.changed).toBe(true)
    expect(migrated.state).toMatchObject({
      review_cycle: 3,
      full_review_count: 1,
      last_reviewed_head: 'review-4-head',
      founder_decision: { for_review_number: 4, finding_ids: ['MC-R1-002'] },
      post_budget_reviews: [{
        review_number: 4,
        reviewed_head: 'review-4-head',
        authorization: { review_number: 4, reviewed_head: 'review-4-head' },
      }],
      finding_lineage: [
        { finding_id: 'MC-R1-002', disposition: 'open' },
        { finding_id: 'MC-STATE-155-002', disposition: 'resolved' },
      ],
    })
    expect(migrated.state).not.toHaveProperty('post_budget_review_history')
    expect(migrated.state).not.toHaveProperty('founder_authorization')
    expect(migrated.state).not.toHaveProperty('founder_correction_authorization')
  })

  it('merges compatible canonical and legacy post-budget reviews losslessly and rejects contradictions', () => {
    const authorization = {
      status: 'approved', authority: 'Founder', scope: 'review', review_number: 4,
      reviewed_head: 'review-4-head', action: 'Authorize bounded Review 4',
      authorized_at: '2026-07-23T16:30:00Z',
    }
    const review = {
      review_number: 4, reviewed_head: 'review-4-head', verdict: 'BLOCKED FOR FOUNDER DECISION',
      finding_dispositions: [{ finding_id: 'MC-R1-160-002', disposition: 'open' }], authorization,
    }
    const migrated = migrateLegacyManagedState({
      state: 'BLOCKED_FOR_FOUNDER_DECISION', review_cycle: 3, full_review_count: 1,
      last_reviewed_head: 'review-4-head', post_budget_reviews: [review],
      post_budget_review_history: [{ ...review, authorization: undefined }], founder_authorization: authorization,
    })

    expect(migrated.state.post_budget_reviews).toEqual([review])
    expect(migrated.state).not.toHaveProperty('post_budget_review_history')
    expect(() => migrateLegacyManagedState({
      ...migrated.state,
      post_budget_review_history: [{ ...review, verdict: 'STATE CONFLICT', authorization: undefined }],
      founder_authorization: authorization,
    })).toThrow('contradictory post-budget review')
  })

  it('rejects a Founder decision unless its correction scope, review, exact head, and finding IDs bind together', () => {
    const reviewAuthorization = {
      status: 'approved', authority: 'Founder', scope: 'review', review_number: 4,
      reviewed_head: 'review-4-head', action: 'Authorize bounded Review 4', authorized_at: '2026-07-23T16:30:00Z',
    }
    expect(() => migrateLegacyManagedState({
      state: 'STATE_CONFLICT', review_cycle: 3, full_review_count: 1, last_reviewed_head: 'review-4-head',
      post_budget_review_history: [{
        review_number: 4, reviewed_head: 'review-4-head', verdict: 'CORRECTION REQUIRED',
        finding_dispositions: [{ finding_id: 'MC-R1-160-002', disposition: 'open' }],
      }],
      founder_authorization: reviewAuthorization,
      founder_correction_authorization: {
        status: 'approved', authority: 'Founder', scope: 'merge', for_review_number: 4,
        reviewed_head: 'review-4-head', finding_ids: ['MC-R1-160-002'], action: 'Merge', authorized_at: '2026-07-23T16:40:00Z',
      },
    })).toThrow('invalid Founder correction authorization')
  })

  it('fails closed when terminal repair evidence lacks a merge commit, exact-head CI, or a matching current head', () => {
    for (const terminal of [
      { issueClosed: true, prMerged: true, reviewedHeadMatches: true, exactHeadCi: true, currentHeadMatches: true },
      { issueClosed: true, prMerged: true, reviewedHeadMatches: true, mergeCommit: 'merge-sha', currentHeadMatches: true },
      { issueClosed: true, prMerged: true, reviewedHeadMatches: true, mergeCommit: 'merge-sha', exactHeadCi: true },
    ]) {
      expect(classifyReconciliation({ managedState: { state: 'ELIGIBLE_FOR_FOUNDER_REVIEW' }, terminal }).outcome)
        .toBe('STATE_CONFLICT')
    }
  })

  it('reproduces the #154-#155 loop and converges within one repair plus one verification', async () => {
    const legacyState = {
      state: 'STATE_CONFLICT', review_cycle: 3, full_review_count: 1,
      last_reviewed_head: 'review-4-head',
      finding_lineage: [
        { finding_id: 'MC-R1-002', disposition: 'open' },
        { finding_id: 'MC-STATE-155-002', disposition: 'resolved' },
      ],
      post_budget_review_history: [{
        review_number: 4, reviewed_head: 'review-4-head',
        verdict: 'BLOCKED FOR FOUNDER DECISION',
        finding_dispositions: [{ finding_id: 'MC-R1-002', disposition: 'open' }],
      }],
      founder_authorization: {
        status: 'approved', authority: 'Founder', scope: 'review', review_number: 4,
        reviewed_head: 'review-4-head', action: 'Authorize bounded Review 4',
        authorized_at: '2026-07-23T16:30:00Z',
      },
    }
    const deriveMeasurements = (trace: Array<Record<string, number>>) => trace.reduce((total, step) => ({
      coordination_runs: total.coordination_runs + (step.coordination_runs ?? 0),
      state_writes: total.state_writes + (step.state_writes ?? 0),
      role_comments: total.role_comments + (step.role_comments ?? 0),
      model_required_stages: total.model_required_stages + (step.model_required_stages ?? 0),
      reconciliation_attempts: total.reconciliation_attempts + (step.reconciliation_attempts ?? 0),
      false_state_conflicts: total.false_state_conflicts + (step.false_state_conflicts ?? 0),
    }), {
      coordination_runs: 0, state_writes: 0, role_comments: 0, model_required_stages: 0,
      reconciliation_attempts: 0, false_state_conflicts: 0,
    })
    // This is the complete historical #154–#155 trace: legacy preflight,
    // correction handoff, post-budget review, terminal lag, and repeated evidence.
    // Measurements are counted from executed trace events rather than copied literals.
    const before = deriveMeasurements([
      { coordination_runs: 1, state_writes: 1, role_comments: 1, model_required_stages: 1, reconciliation_attempts: 1, false_state_conflicts: 1 },
      { coordination_runs: 1, state_writes: 1, role_comments: 1, model_required_stages: 1, reconciliation_attempts: 1 },
      { coordination_runs: 1, state_writes: 1, role_comments: 1, model_required_stages: 1, reconciliation_attempts: 1 },
      { coordination_runs: 1, state_writes: 1, role_comments: 1, model_required_stages: 1, reconciliation_attempts: 1 },
    ])
    let liveState: any = legacyState
    let writes = 0
    const result = await runBoundedReconciliation({
      readEvidence: async () => ({ managedState: liveState }),
      writeState: async (nextState: any) => { writes += 1; liveState = nextState; return nextState },
    })
    const repeated = await runBoundedReconciliation({
      readEvidence: async () => ({ managedState: liveState }),
      writeState: async () => { writes += 1; return liveState },
    })

    expect(result).toMatchObject({
      outcome: 'DETERMINISTIC_MIGRATION',
      finalOutcome: 'NO_OP',
      measurements: {
        coordination_runs: 1,
        state_writes: 1,
        role_comments: 0,
        model_required_stages: 0,
        reconciliation_attempts: 2,
        false_state_conflicts: 0,
      },
    })
    expect(repeated).toMatchObject({
      outcome: 'NO_OP',
      finalOutcome: 'NO_OP',
      measurements: { state_writes: 0, reconciliation_attempts: 1, false_state_conflicts: 0 },
    })
    expect(writes).toBe(1)
    const after = result.measurements
    expect({ before, after }).toEqual({
      before: {
        coordination_runs: 4,
        state_writes: 4,
        role_comments: 4,
        model_required_stages: 4,
        reconciliation_attempts: 4,
        false_state_conflicts: 1,
      },
      after: {
        coordination_runs: 1,
        state_writes: 1,
        role_comments: 0,
        model_required_stages: 0,
        reconciliation_attempts: 2,
        false_state_conflicts: 0,
      },
    })
  })

  it('fails closed after its single verification when a repair remains necessary', async () => {
    let reads = 0
    const result = await runBoundedReconciliation({
      readEvidence: async () => {
        reads += 1
        return { managedState: { post_budget_review_history: [] as unknown[] } }
      },
      writeState: async (nextState: any) => nextState,
    })

    expect(reads).toBe(2)
    expect(result).toMatchObject({
      outcome: 'DETERMINISTIC_MIGRATION',
      finalOutcome: 'STATE_CONFLICT',
      finalReason: 'bounded repair was not confirmed by the single verification',
      measurements: { state_writes: 1, reconciliation_attempts: 2 },
    })
  })

  it('requires the durable write to return the exact proposed state', async () => {
    await expect(runBoundedReconciliation({
      readEvidence: async () => ({ managedState: { post_budget_review_history: [] as unknown[] } }),
      writeState: async () => ({ state: 'IN_PROGRESS' }),
    })).rejects.toThrow('durable reconciliation write was not confirmed')
  })

  it('repairs terminal bookkeeping once and never reopens completed work', async () => {
    let evidence: any = {
      managedState: {
        state: 'ELIGIBLE_FOR_FOUNDER_REVIEW', review_cycle: 3, full_review_count: 1,
        current_head: 'reviewed-head', last_reviewed_head: 'reviewed-head',
        finding_lineage: [{ finding_id: 'MC-R1-002', disposition: 'resolved' }],
      },
      terminal: { issueClosed: true, prMerged: true, reviewedHeadMatches: true, currentHeadMatches: true, mergeCommit: 'merge-sha', exactHeadCi: true },
    }
    const writes: any[] = []
    const first = await runBoundedReconciliation({
      readEvidence: async () => evidence,
      writeState: async (nextState: any) => {
        writes.push(nextState)
        evidence = { ...evidence, managedState: nextState }
        return nextState
      },
    })
    const second = await runBoundedReconciliation({
      readEvidence: async () => evidence,
      writeState: async () => { throw new Error('must not rewrite identical terminal evidence') },
    })

    expect(first.finalOutcome).toBe('NO_OP')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ state: 'DONE', review_cycle: 3, full_review_count: 1 })
    expect(writes[0].finding_lineage).toEqual([{ finding_id: 'MC-R1-002', disposition: 'resolved' }])
    expect(second.outcome).toBe('NO_OP')
  })

  it('dispatches READY to IN_PROGRESS with one HANDOFF or rolls the state back', async () => {
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0, finding_lineage: [] }
    const writes: string[] = []
    const comments: string[] = []
    const success = await dispatchManagedTask({
      readState: async () => state,
      writeState: async (next: any) => { state = next; writes.push(next.state) },
      postHandoff: async (body: string) => { comments.push(body) },
      handoffBody: '## HANDOFF\n\nBounded Dev work',
    })

    expect(success.outcome).toBe('DISPATCHED')
    expect(writes).toEqual(['IN_PROGRESS'])
    expect(comments).toEqual(['## HANDOFF\n\nBounded Dev work'])

    state = { state: 'READY', review_cycle: 0, full_review_count: 0, finding_lineage: [] }
    writes.length = 0
    await expect(dispatchManagedTask({
      readState: async () => state,
      writeState: async (next: any) => { state = next; writes.push(next.state) },
      postHandoff: async () => { throw new Error('offline') },
      handoffBody: '## HANDOFF\n\nBounded Dev work',
    })).rejects.toThrow('dispatch rolled back')
    expect(writes).toEqual(['IN_PROGRESS', 'READY'])
    expect(state.state).toBe('READY')
  })

  it('retracts a successful HANDOFF when concurrent state mutation invalidates its durable transition', async () => {
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0, finding_lineage: [] }
    const retracted: string[] = []
    await expect(dispatchManagedTask({
      readState: async () => state,
      writeState: async (next: any) => { state = next },
      postHandoff: async () => {
        state = { ...state, state: 'BLOCKED_EXTERNAL' }
        return { id: 'handoff-1' }
      },
      retractHandoff: async (comment: { id: string }) => { retracted.push(comment.id) },
      handoffBody: '## HANDOFF\n\nBounded Dev work',
    })).rejects.toThrow('concurrent state change')
    expect(retracted).toEqual(['handoff-1'])
  })

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
