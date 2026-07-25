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
  dispatchFounderAuthorizedCorrection,
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
  it('migrates the exact Issue #171 founder_decision representation once without altering its lineage', () => {
    const legacy: any = {
      state: 'STATE_MIGRATION_REQUIRED',
      review_cycle: 3,
      full_review_count: 1,
      active_pr: '#172',
      current_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570',
      last_reviewed_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570',
      post_budget_reviews: [],
      founder_decision: {
        status: 'approved', authority: 'Founder', scope: 'correction', for_review_number: 3,
        reviewed_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570', finding_ids: ['MC-R1-171-001'],
        action: 'Authorize one bounded correction; Review 4 remains unauthorized',
        authorized_at: '2026-07-26T01:30:29+07:00',
      },
      open_blockers: ['MC-R1-171-001', 'Canonical representation required'],
      finding_lineage: [{
        finding_id: 'MC-R1-171-001', severity: 'Critical', disposition: 'open',
        summary: 'Common ancestry does not prove authorized planning lineage',
        source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/172#discussion_r3649776607',
        evidence: 'Founder decision and exact-head evidence remain durable',
        required_correction_evidence: ['Bind exact authorized planning lineage'],
      }],
    }

    const migrated = migrateLegacyManagedState(legacy)

    expect(migrated.changed).toBe(true)
    expect(migrated.state).toMatchObject({
      state: 'FOUNDER_AUTHORIZED_CORRECTION', review_cycle: 3, full_review_count: 1,
      current_head: legacy.current_head, last_reviewed_head: legacy.last_reviewed_head,
      post_budget_reviews: [],
      founder_correction_authorization: {
        schema_version: 2, status: 'authorized', authority: 'Founder',
        for_review_number: 3, reviewed_head: legacy.last_reviewed_head,
        finding_ids: ['MC-R1-171-001'], authorization_id: expect.any(String),
      },
    })
    expect(migrated.state.finding_lineage).toEqual(legacy.finding_lineage)
    expect(classifyReconciliation({ managedState: migrated.state }).outcome).toBe('NO_OP')
    expect(migrateLegacyManagedState(migrated.state)).toEqual({ changed: false, state: migrated.state })
  })

  it('migrates the exact Review 3 Founder correction authority without fabricating Review 4', () => {
    const migrated = migrateLegacyManagedState({
      state: 'STATE_MIGRATION_REQUIRED',
      review_cycle: 3,
      full_review_count: 1,
      active_pr: '#172',
      current_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570',
      last_reviewed_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570',
      post_budget_reviews: [],
      founder_correction_authorization: {
        status: 'approved', authority: 'Founder', scope: 'correction', for_review_number: 3,
        reviewed_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570', finding_ids: ['MC-R1-171-001'],
        action: 'Authorize one bounded correction', authorized_at: '2026-07-26T01:30:29+07:00',
      },
      finding_lineage: [{
        finding_id: 'MC-R1-171-001', disposition: 'open',
        source_thread: 'https://github.com/boat1994/bemoat-web-starter/pull/172#discussion_r1',
        evidence: 'Exact Founder decision evidence', required_correction_evidence: ['Exact migration'],
      }],
    })

    expect(migrated.state).toMatchObject({
      state: 'FOUNDER_AUTHORIZED_CORRECTION', review_cycle: 3, full_review_count: 1,
      last_reviewed_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570', post_budget_reviews: [],
      founder_correction_authorization: {
        schema_version: 2, authorization_id: expect.any(String), status: 'authorized',
        for_review_number: 3, finding_ids: ['MC-R1-171-001'],
      },
    })
  })

  it('consumes a Review 3 Founder authorization once and binds correction preflight to its HANDOFF', async () => {
    let state: any = {
      state: 'FOUNDER_AUTHORIZED_CORRECTION', review_cycle: 3, full_review_count: 1,
      active_pr: '#172', current_head: 'reviewed-head', last_reviewed_head: 'reviewed-head', post_budget_reviews: [],
      founder_correction_authorization: {
        schema_version: 1, authorization_id: 'founder-171', status: 'authorized', authority: 'Founder',
        scope: 'correction', for_review_number: 3, reviewed_head: 'reviewed-head', finding_ids: ['MC-R1-171-001'],
        action: 'Authorize one bounded correction', authorized_at: '2026-07-26T01:30:29+07:00',
      },
    }
    const writes: any[] = []
    const reservations: string[] = []
    const releases: string[] = []
    const handoffBody = '## HANDOFF\n\n**Target:** Dev / Integration Builder\n\nCorrection work\n\n**Founder correction authorization:** `founder-171`'
    const result = await dispatchFounderAuthorizedCorrection({
      readState: async () => state,
      writeState: async (next: any) => { state = next; writes.push(next) },
      reserveAuthorization: async (authorization: { authorization_id: string }) => {
        reservations.push(authorization.authorization_id)
        return { reservation_id: 'reservation-171' }
      },
      releaseAuthorization: async (reservation: { reservation_id: string }) => { releases.push(reservation.reservation_id) },
      postHandoff: async () => ({
        id: '5080099999',
        html_url: 'https://github.com/boat1994/bemoat-web-starter/issues/171#issuecomment-5080099999',
        created_at: '2026-07-26T01:40:00Z',
        updated_at: '2026-07-26T01:40:00Z',
      }),
      retractHandoff: async (): Promise<void> => undefined,
      handoffBody,
    })

    expect(result.outcome).toBe('DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION')
    expect(writes).toHaveLength(1)
    expect(state).toMatchObject({
      state: 'IN_PROGRESS', review_cycle: 3, full_review_count: 1,
      founder_correction_authorization: {
        status: 'consumed', authorization_id: 'founder-171', handoff_comment_id: '5080099999',
        handoff_binding: {
          schema_version: 1,
          content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          binding_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          correction_base: 'reviewed-head',
          finding_ids: ['MC-R1-171-001'],
        },
      },
    })
    expect(reservations).toEqual(['founder-171'])
    expect(releases).toEqual(['reservation-171'])
    await expect(dispatchFounderAuthorizedCorrection({
      readState: async () => state, writeState: async (): Promise<void> => undefined, postHandoff: async () => ({ id: 'again' }),
      handoffBody: '## HANDOFF\n\nreplay',
    })).rejects.toThrow('unconsumed Founder correction authorization')
  })

  it('allows exactly one concurrent Founder-correction dispatcher to publish a HANDOFF', async () => {
    const original: any = {
      state: 'FOUNDER_AUTHORIZED_CORRECTION', review_cycle: 3, full_review_count: 1,
      active_pr: '#172', current_head: 'reviewed-head', last_reviewed_head: 'reviewed-head', post_budget_reviews: [],
      founder_correction_authorization: {
        schema_version: 2, authorization_id: 'founder-171', status: 'authorized', authority: 'Founder',
        scope: 'correction', for_review_number: 3, reviewed_head: 'reviewed-head', finding_ids: ['MC-R1-171-001'],
        action: 'Authorize one bounded correction', authorized_at: '2026-07-26T01:30:29+07:00',
      },
    }
    let state = structuredClone(original)
    let reserved = false
    const comments: string[] = []
    const dispatch = () => dispatchFounderAuthorizedCorrection({
      readState: async () => state,
      writeState: async (next: any) => { state = next },
      reserveAuthorization: async () => {
        if (reserved) throw new Error('reservation already exists')
        reserved = true
        return { reservation_id: 'winner' }
      },
      releaseAuthorization: async () => { reserved = false },
      postHandoff: async (body: string) => {
        comments.push(body)
        return { id: 'winner', created_at: '2026-07-26T01:40:00Z', updated_at: '2026-07-26T01:40:00Z' }
      },
      retractHandoff: async (): Promise<void> => undefined,
      handoffBody: '## HANDOFF\n\n**Target:** Dev / Integration Builder\n**Founder correction authorization:** `founder-171`',
    })

    const results = await Promise.allSettled([dispatch(), dispatch()])
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((entry) => entry.status === 'rejected')).toHaveLength(1)
    expect(comments).toHaveLength(1)
    expect(state.founder_correction_authorization.status).toBe('consumed')
  })

  it('treats an acknowledged consumed write as success after a write-side transport error', async () => {
    let state: any = {
      state: 'FOUNDER_AUTHORIZED_CORRECTION', review_cycle: 3, full_review_count: 1,
      active_pr: '#172', current_head: 'reviewed-head', last_reviewed_head: 'reviewed-head', post_budget_reviews: [],
      founder_correction_authorization: {
        schema_version: 2, authorization_id: 'founder-171', status: 'authorized', authority: 'Founder',
        scope: 'correction', for_review_number: 3, reviewed_head: 'reviewed-head', finding_ids: ['MC-R1-171-001'],
        action: 'Authorize one bounded correction', authorized_at: '2026-07-26T01:30:29+07:00',
      },
    }
    let released = false
    let retracted = false
    const result = await dispatchFounderAuthorizedCorrection({
      readState: async () => state,
      writeState: async (next: any) => { state = next; throw new Error('response lost after write') },
      reserveAuthorization: async () => ({ reservation_id: 'winner' }),
      releaseAuthorization: async () => { released = true },
      postHandoff: async () => ({ id: 'handoff-1', created_at: 'now', updated_at: 'now' }),
      retractHandoff: async () => { retracted = true },
      handoffBody: '## HANDOFF\n\n**Target:** Dev / Integration Builder\n**Founder correction authorization:** `founder-171`',
    })

    expect(result.outcome).toBe('DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION')
    expect(released).toBe(true)
    expect(retracted).toBe(false)
  })

  it('retains the reservation when post-write verification and HANDOFF rollback are indeterminate', async () => {
    const original: any = {
      state: 'FOUNDER_AUTHORIZED_CORRECTION', review_cycle: 3, full_review_count: 1,
      active_pr: '#172', current_head: 'reviewed-head', last_reviewed_head: 'reviewed-head', post_budget_reviews: [],
      founder_correction_authorization: {
        schema_version: 2, authorization_id: 'founder-171', status: 'authorized', authority: 'Founder',
        scope: 'correction', for_review_number: 3, reviewed_head: 'reviewed-head', finding_ids: ['MC-R1-171-001'],
        action: 'Authorize one bounded correction', authorized_at: '2026-07-26T01:30:29+07:00',
      },
    }
    let reads = 0
    let released = false
    await expect(dispatchFounderAuthorizedCorrection({
      readState: async () => {
        reads += 1
        if (reads >= 3) throw new Error('verification unavailable')
        return original
      },
      writeState: async (): Promise<void> => undefined,
      reserveAuthorization: async () => ({ reservation_id: 'winner' }),
      releaseAuthorization: async () => { released = true },
      postHandoff: async () => ({ id: 'handoff-1', created_at: 'now', updated_at: 'now' }),
      retractHandoff: async () => { throw new Error('rollback unavailable') },
      handoffBody: '## HANDOFF\n\n**Target:** Dev / Integration Builder\n**Founder correction authorization:** `founder-171`',
    })).rejects.toThrow('verified Founder authorization consumption')
    expect(released).toBe(false)
  })

  it('preserves Review 3 history and returns correction delivery to a separate Founder decision', () => {
    const prior: any = {
      state: 'IN_PROGRESS', review_cycle: 3, full_review_count: 1,
      active_task_issue: '#171', active_pr: '#172', current_head: 'reviewed-head',
      last_reviewed_head: 'reviewed-head', post_budget_reviews: [],
      open_blockers: ['MC-R1-171-001'],
      finding_lineage: [{ finding_id: 'MC-R1-171-001', disposition: 'open' }],
      founder_correction_authorization: {
        schema_version: 2, status: 'consumed', authority: 'Founder', scope: 'correction',
        authorization_id: 'founder-171', for_review_number: 3, reviewed_head: 'reviewed-head',
        finding_ids: ['MC-R1-171-001'], handoff_comment_id: '5080099999',
        handoff_binding: { schema_version: 1, content_sha256: 'a'.repeat(64), binding_sha256: 'b'.repeat(64) },
      },
    }
    const proposal = proposeDeliveryReconciliation({
      managedState: prior,
      livePr: { number: '172', headRefOid: 'corrected-head', baseRefName: 'main' },
      activeTaskIssue: '171',
      latestResult: { parsed: { headSha: 'corrected-head', prNumber: '172' } },
    })

    expect(proposal).toMatchObject({
      state: 'BLOCKED_FOR_FOUNDER_DECISION', review_cycle: 3, full_review_count: 1,
      current_head: 'corrected-head', last_reviewed_head: 'reviewed-head', post_budget_reviews: [],
      founder_correction_authorization: prior.founder_correction_authorization,
      finding_lineage: prior.finding_lineage,
      founder_decision: { status: 'pending', scope: 'review', review_number: 4 },
    })
    expect(proposal.next_permitted_action).toMatch(/Founder.*Review 4/i)
  })

  it('delivers Correction 1 to Review 2 while preserving Issue #173 counters 1/1', () => {
    const prior: any = {
      state: 'CORRECTION_REQUIRED_1', review_cycle: 1, full_review_count: 1,
      active_task_issue: '#173', active_pr: '#174', current_head: 'reviewed-head',
      last_reviewed_head: 'reviewed-head', post_budget_reviews: [],
      open_blockers: ['MC-R1-173-001'], finding_lineage: [{ finding_id: 'MC-R1-173-001', disposition: 'open' }],
    }
    const proposal = proposeDeliveryReconciliation({
      managedState: prior,
      livePr: { number: '174', headRefOid: 'corrected-head', baseRefName: 'main' },
      activeTaskIssue: '173',
      latestResult: { parsed: { headSha: 'corrected-head', prNumber: '174' } },
    })

    expect(proposal).toMatchObject({
      state: 'AWAITING_REVIEW_2', review_cycle: 1, full_review_count: 1,
      current_head: 'corrected-head', last_reviewed_head: 'reviewed-head',
      open_blockers: prior.open_blockers, finding_lineage: prior.finding_lineage,
    })
    expect(proposal.next_permitted_action).toMatch(/Review 2/)
  })
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
