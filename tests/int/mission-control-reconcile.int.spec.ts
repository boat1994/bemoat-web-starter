import { describe, expect, it } from 'vitest'
import ts from 'typescript'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped runtime .mjs boundary */
import * as reconcileModule from '../../scripts/mission-control-reconcile.mjs'
import * as coordinatorTransitions from '../../scripts/mission-control/coordinator-transitions.mjs'
import { parseMissionControlState, renderMissionControlState } from '../../scripts/mission-control/domain/task-state.ts'
import * as reviewVerdictProjectionFacade from '../../scripts/mission-control/review-verdict-projection.ts'
import { getPostBudgetReviewEvidenceBlockers } from '../../scripts/mission-control/review-verdict-binding.mjs'

// Shared .mjs scripts expose runtime behavior, not TypeScript declarations. Keep
// the strict-project boundary explicit without changing the production API.
const {
  analyzeReconciliation,
  classifyReconciliation,
  classifyDeliveryLag,
  classifyMergeDrift,
  classifyReviewLag,
  classifyTransition,
  dispatchManagedTask,
  dispatchFounderAuthorizedCorrection,
  isGenuineStateConflict,
  parseRoleCommentBody,
  parseCommentMarker,
  normalizeTransitionIdentity,
  recoverAmbiguousPost,
  verifyStatePostcondition,
  CHILD_SYNC_GATE_ISSUES,
  CHILD_SYNC_GATE_REQUIREMENTS,
  assertChildSyncGateReady,
  resolveChildSyncCommandGate,
  selectActiveRoleComments,
  isExplicitlyNonAuthoritativeRoleBody,
  parsePaginatedGhApiJson,
  normalizeIssueComments,
  findMatchingComments,
  proposeDeliveryReconciliation,
  proposeReviewReconciliation,
  projectReviewVerdictState,
  reconciliationFailureReason,
  runBoundedReconciliation,
  resolveProductionCommentTrust,
  sameValue,
  deriveTransitionFacts,
  assertRoutingOnlyProjection,
  coordinatorOwnedRoutingProjection,
  buildTransitionMatchOptions,
  resolveRoleComment,
} = reconcileModule as unknown as Record<string, (...args: any[]) => any>

const CoordinatorClass = reconcileModule.Coordinator as unknown as new (transports: Record<string, unknown>) => {
  integrateHandoff: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  integrateResult: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  reconcileReviewVerdict: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  resumeProjection: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  assertCompatibleSnapshot: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
}

function hasExecutableBoundary(
  source: string,
  expected: {
    moduleSpecifier: string
    importedNames: string[]
    calledNames: string[]
    calledWithObjectNames?: string[]
    constructedNames?: string[]
  },
) {
  const sourceFile = ts.createSourceFile('boundary-fixture.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)

  const imports = sourceFile.statements
    .filter(ts.isImportDeclaration)
    .filter((statement) => ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === expected.moduleSpecifier)
    .flatMap((statement) => {
      const bindings = statement.importClause?.namedBindings
      return bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map((element) => element.name.text)
        : []
    })
  const calledNames = new Set<string>()
  const calledWithObjectNames = new Set<string>()
  const constructedNames = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      calledNames.add(node.expression.text)
      if (node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        calledWithObjectNames.add(node.expression.text)
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) constructedNames.add(node.expression.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return expected.importedNames.every((name) => imports.includes(name)) &&
    expected.calledNames.every((name) => calledNames.has(name)) &&
    (expected.calledWithObjectNames ?? []).every((name) => calledWithObjectNames.has(name)) &&
    (expected.constructedNames ?? []).every((name) => constructedNames.has(name))
}

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
const FULL_SAMPLE_HEAD = 'abc1234'.padEnd(40, '0')

function authorizedPostBudgetReview4Context(overrides: Record<string, any> = {}) {
  const reviewedHead = 'c'.repeat(40)
  const verdictBody = `## REVIEW_VERDICT

**Task / Issue:** #333
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/366 · \`main\` · \`${reviewedHead}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW

### Immutable finding disposition
- \`MC-R2-004\`: Resolved.
`
  return {
    managedState: {
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 3,
      full_review_count: 1,
      approved_base: 'main',
      active_task_issue: '#333',
      active_pr: '#366',
      current_head: reviewedHead,
      last_reviewed_head: 'd'.repeat(40),
      post_budget_reviews: [] as unknown[],
      founder_decision: {
        status: 'approved',
        authority: 'Founder',
        scope: 'review',
        review_number: 4,
        reviewed_head: reviewedHead,
        action: `Authorize exactly one bounded Review 4 on PR #366 at exact head ${reviewedHead}`,
        authorized_at: '2026-08-19T00:00:00Z',
      },
      open_blockers: ['MC-R2-004'],
    },
    livePr: { number: '366', headRefOid: reviewedHead, baseRefName: 'main' },
    exactHeadCi: { available: true, exactHeadVerified: true, headSha: reviewedHead, ciSha: reviewedHead },
    latestVerdict: {
      parsed: {
        verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
        prNumber: '366',
        headSha: reviewedHead,
        base: 'main',
      },
      comment: { id: '5337047094', body: verdictBody },
    },
    activeTaskIssue: '333',
    stateConflictBlockers: [] as string[],
    ...overrides,
  }
}

describe('mission-control reconcile classifiers', () => {
  it('keeps review verdict projection owned by TypeScript after facade removal', async () => {
    const { existsSync } = await import('node:fs')
    const typed = await import('../../scripts/mission-control/review-verdict-projection.ts')
    const proposalConsumer = await import('../../scripts/mission-control/reconciliation-proposals.mjs')

    expect(existsSync('scripts/mission-control/review-verdict-projection.mjs')).toBe(false)
    expect(proposalConsumer.proposeReviewReconciliation).toBe(typed.proposeReviewReconciliation)
  })

  it('keeps comment evidence owned by TypeScript after facade removal', async () => {
    const { existsSync } = await import('node:fs')
    const typed = await import('../../scripts/mission-control/comment-evidence.ts')

    expect(existsSync('scripts/mission-control/comment-evidence.mjs')).toBe(false)
    expect(Object.keys(typed).length).toBeGreaterThan(0)
  })

  it('exposes the extracted Coordinator transition boundary', () => {
    expect(coordinatorTransitions.integrateHandoff).toBeTypeOf('function')
    expect(coordinatorTransitions.integrateResult).toBeTypeOf('function')
    expect(coordinatorTransitions.resumeProjection).toBeTypeOf('function')
    expect(coordinatorTransitions.assertCompatibleSnapshot).toBeTypeOf('function')
  })

  it('projects a full correction-required verdict with immutable findings and canonical transition bindings', () => {
    const prior: Record<string, unknown> = {
      schema_version: 1,
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      approved_base: 'main',
      active_task_issue: '#231',
      active_pr: '#232',
      current_head: 'reviewed-head',
      last_reviewed_head: null,
      guide_version: '1.2.0',
      guide_source_ref: 'main',
      guide_source_sha: 'guide-sha',
      open_blockers: [],
      follow_up_issues: [],
      next_permitted_action: 'Reviewer performs Review 1.',
      material_change_status: 'none',
      updated_at: 'before',
      updated_by: 'Delivery Coordinator',
      latest_handoff_comment_id: 'handoff-1',
      latest_result_comment_id: 'result-1',
    }

    expect(projectReviewVerdictState({
      prior,
      verdict: 'CORRECTION REQUIRED',
      reviewType: 'full',
      reviewedHead: 'reviewed-head',
      commentId: 'verdict-1',
      transitionIdentity: 'review-identity',
      findings: [{ finding_id: 'MC-R1-231-001', severity: 'Important', disposition: 'open' }],
      updatedAt: '2026-07-31T05:00:00Z',
      updatedBy: 'Reviewer',
    })).toMatchObject({
      state: 'CORRECTION_REQUIRED_1',
      review_cycle: 1,
      full_review_count: 1,
      current_head: 'reviewed-head',
      last_reviewed_head: 'reviewed-head',
      latest_review_verdict_comment_id: 'verdict-1',
      latest_transition_identity: 'review-identity',
      open_blockers: ['MC-R1-231-001'],
      next_permitted_action: expect.stringContaining('correction'),
      latest_handoff_comment_id: 'handoff-1',
      latest_result_comment_id: 'result-1',
    })
  })
  it('preserves the prior projection and fails closed for invalid review inputs', () => {
    const prior: Record<string, unknown> = {
      schema_version: 1,
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      current_head: 'old-head',
      last_reviewed_head: null,
      open_blockers: [],
    }

    expect(projectReviewVerdictState({
      prior,
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewType: 'full',
      reviewedHead: 'ABC1234',
      commentId: 42,
      transitionIdentity: 'identity',
      findings: [{ id: 'ignored-for-eligible' }],
    })).toMatchObject({
      current_head: 'abc1234',
      last_reviewed_head: 'abc1234',
      open_blockers: [],
      latest_review_verdict_comment_id: '42',
    })
    expect(prior).toMatchObject({
      state: 'AWAITING_REVIEW_1',
      current_head: 'old-head',
      open_blockers: [],
    })

    expect(() => projectReviewVerdictState({
      prior,
      verdict: 'NOT A CORE VERDICT',
      reviewType: 'full',
      reviewedHead: 'abc1234',
      commentId: 1,
      transitionIdentity: 'identity',
    })).toThrow('review projection requires a Core verdict')
    expect(() => projectReviewVerdictState({
      prior,
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewType: 'delta',
      reviewedHead: 'abc1234',
      commentId: 1,
      transitionIdentity: 'identity',
    })).toThrow('delta review requires an existing review cycle')
  })

  it.each([
    ['CORRECTION REQUIRED', 'CORRECTION_REQUIRED_1'],
    ['ELIGIBLE FOR FOUNDER REVIEW', 'ELIGIBLE_FOR_FOUNDER_REVIEW'],
    ['BLOCKED FOR FOUNDER DECISION', 'BLOCKED_FOR_FOUNDER_DECISION'],
    ['BLOCKED EXTERNAL', 'BLOCKED_EXTERNAL'],
    ['STATE CONFLICT', 'STATE_CONFLICT'],
  ] as const)('projects each Core verdict without changing its canonical state: %s', (verdict, state) => {
    const projected = projectReviewVerdictState({
      prior: { state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0 },
      verdict,
      reviewType: 'full',
      reviewedHead: ' ABCDEF0123456789ABCDEF0123456789ABCDEF01 ',
      commentId: 9,
      transitionIdentity: { immutable: true },
    })

    expect(projected).toMatchObject({
      state,
      review_cycle: 1,
      full_review_count: 1,
      current_head: 'abcdef0123456789abcdef0123456789abcdef01',
      last_reviewed_head: 'abcdef0123456789abcdef0123456789abcdef01',
      open_blockers: [],
      latest_review_verdict_comment_id: '9',
    })
  })

  it.each([
    [0, 'full', 'ELIGIBLE FOR FOUNDER REVIEW', 'ELIGIBLE_FOR_FOUNDER_REVIEW', 1, 1],
    [1, 'delta', 'CORRECTION REQUIRED', 'CORRECTION_REQUIRED_2', 2, 1],
    [1, 'delta', 'ELIGIBLE FOR FOUNDER REVIEW', 'ELIGIBLE_FOR_FOUNDER_REVIEW', 2, 1],
    [2, 'delta', 'BLOCKED EXTERNAL', 'BLOCKED_EXTERNAL', 3, 1],
  ] as const)('preserves the full/delta review-cycle matrix: cycle %s %s %s', (cycle, reviewType, verdict, state, nextCycle, fullCount) => {
    const fields = proposeReviewReconciliation({
      verdict,
      reviewedHead: ' HEAD123 ',
      reviewCycle: cycle,
      fullReviewCount: cycle === 0 ? 0 : 1,
    })

    expect(fields).toMatchObject({
      state,
      review_cycle: nextCycle,
      full_review_count: fullCount,
      last_reviewed_head: 'head123',
    })
  })

  it('keeps correction at cycle 2 as STATE_CONFLICT with unchanged counters', () => {
    expect(proposeReviewReconciliation({
      verdict: 'CORRECTION REQUIRED',
      reviewedHead: ' HEAD123 ',
      reviewCycle: 2,
      fullReviewCount: 1,
    })).toEqual({
      state: 'STATE_CONFLICT',
      review_cycle: 2,
      full_review_count: 1,
      last_reviewed_head: 'head123',
      next_permitted_action: 'Mission Control must classify contradictory evidence.',
    })
  })

  it.each([
    ['prior managed state', { prior: null }, 'review projection requires prior managed state'],
    ['Core verdict', { verdict: 'NOPE' }, 'review projection requires a Core verdict'],
    ['review type', { reviewType: 'unknown' }, 'review projection requires review type full or delta'],
    ['reviewed head', { reviewedHead: '   ' }, 'review projection requires exact reviewed head'],
    ['full cycle', { reviewType: 'full', prior: { review_cycle: 1, full_review_count: 1 } }, 'full review requires review_cycle 0'],
    ['delta cycle', { reviewType: 'delta', prior: { review_cycle: 0, full_review_count: 0 } }, 'delta review requires an existing review cycle'],
  ] as const)('preserves the exact invalid-input message for %s', (_label, overrides, message) => {
    expect(() => projectReviewVerdictState({
      prior: { state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0 },
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewType: 'full',
      reviewedHead: 'head123',
      commentId: 1,
      transitionIdentity: 'identity',
      ...overrides,
    })).toThrow(message)
  })

  it('deep-clones nested prior state while preserving transition identity reference assignment', () => {
    const transitionIdentity = { contentHash: 'immutable' }
    const prior = {
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      nested: { keep: true },
      open_blockers: ['old'],
    }

    const projected = projectReviewVerdictState({
      prior,
      verdict: 'CORRECTION REQUIRED',
      reviewType: 'full',
      reviewedHead: 'head123',
      commentId: 123,
      transitionIdentity,
      findings: [{ finding_id: 'primary', id: 'fallback' }, { id: 'fallback' }, {}, { finding_id: '' }],
      updatedAt: 'explicit-time',
      updatedBy: 'explicit-updater',
    })

    expect(prior).toEqual({
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      nested: { keep: true },
      open_blockers: ['old'],
    })
    expect(projected.nested).toEqual({ keep: true })
    expect(projected.nested).not.toBe(prior.nested)
    expect(projected.latest_transition_identity).toBe(transitionIdentity)
    expect(projected.latest_review_verdict_comment_id).toBe('123')
    expect(projected.updated_at).toBe('explicit-time')
    expect(projected.updated_by).toBe('explicit-updater')
    expect(projected.open_blockers).toEqual(['primary', 'fallback'])
  })

  it('uses Reviewer and current ISO timestamp defaults when omitted', () => {
    const before = new Date().toISOString()
    const projected = projectReviewVerdictState({
      prior: { state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0 },
      verdict: 'STATE CONFLICT',
      reviewType: 'full',
      reviewedHead: 'head123',
      commentId: 1,
      transitionIdentity: 'identity',
    })
    const after = new Date().toISOString()

    expect(projected.updated_by).toBe('Reviewer')
    expect(projected.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(String(projected.updated_at) >= before).toBe(true)
    expect(String(projected.updated_at) <= after).toBe(true)
  })
  it('explains that merge transport must close a merged PR open Issue before terminal reconciliation', () => {
    expect(classifyReconciliation({
      managedState: { state: 'ELIGIBLE_FOR_FOUNDER_REVIEW' },
      terminal: {
        issueClosed: false,
        prMerged: true,
        reviewedHeadMatches: true,
        currentHeadMatches: true,
        mergeCommit: 'merge-sha',
        exactHeadCi: true,
      },
    })).toEqual({
      outcome: 'STATE_CONFLICT',
      reason: 'merged PR is verified but the managed Issue remains open; merge transport must close the Issue before terminal reconciliation',
    })
  })

  it.each([
    ['STATE_CONFLICT', { authoritativeContradiction: true }, 'authoritative live evidence contradicts'],
    ['BLOCKED_EXTERNAL', { requiredEvidenceUnavailable: true }, 'required live evidence is unavailable'],
  ])('propagates a non-empty finalReason for an initial %s without writing', async (_outcome, evidence, reason) => {
    let writes = 0
    const result = await runBoundedReconciliation({
      readEvidence: async () => evidence,
      writeState: async () => { writes += 1 },
    })

    expect(result).toMatchObject({ finalOutcome: _outcome, finalReason: reason })
    expect(writes).toBe(0)
  })

  it('selects a deterministic production diagnostic fallback without a blank error', () => {
    expect(reconciliationFailureReason({ finalReason: 'verified failure', reason: 'initial failure' }))
      .toBe('verified failure')
    expect(reconciliationFailureReason({ reason: 'initial failure' })).toBe('initial failure')
    expect(reconciliationFailureReason({})).toBe('Mission Control reconciliation failed without a diagnostic')
  })

  it('accepts only a structured RESULT-bound pre-review Founder decision gate at counters 0/0', () => {
    const base: any = {
      schema_version: 1,
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 0,
      full_review_count: 0,
      approved_base: 'main',
      active_task_issue: '#222',
      active_pr: null,
      current_head: null,
      last_reviewed_head: null,
      latest_transition_identity: JSON.stringify({
        taskId: '222',
        phase: 'Investigation',
        role: 'RESULT',
        contentHash: 'a'.repeat(64),
      }),
      latest_result_comment_id: '5131773375',
      guide_version: '1.2.0',
      guide_source_ref: 'main',
      guide_source_sha: '8df91686d715a0ddf0ddf258bf9fa5b060a4af29',
      open_blockers: [],
      follow_up_issues: [],
      next_permitted_action: 'Founder decides the bounded implementation direction.',
      material_change_status: 'none',
      updated_at: '2026-07-30T13:59:01Z',
      updated_by: 'Diagnostic Investigator',
    }

    expect(parseMissionControlState(renderMissionControlState(base))).toMatchObject({ valid: true })

    const freeFormOnly = structuredClone(base)
    delete (freeFormOnly as Record<string, unknown>).latest_transition_identity
    delete (freeFormOnly as Record<string, unknown>).latest_result_comment_id
    expect(parseMissionControlState(renderMissionControlState(freeFormOnly))).toMatchObject({ valid: false })

    const reviewBacked = structuredClone(base)
    reviewBacked.latest_transition_identity = JSON.stringify({
      taskId: '222', phase: 'Review', role: 'REVIEW_VERDICT', contentHash: 'b'.repeat(64),
    })
    expect(parseMissionControlState(renderMissionControlState(reviewBacked))).toMatchObject({ valid: false })

    const activeDelivery = structuredClone(base)
    activeDelivery.active_pr = '#223'
    activeDelivery.current_head = 'c'.repeat(40)
    expect(parseMissionControlState(renderMissionControlState(activeDelivery))).toMatchObject({ valid: false })

    for (const phase of ['Diagnostic — terminal contract', 'Investigation — terminal contract']) {
      const accepted = structuredClone(base)
      accepted.latest_transition_identity = JSON.stringify({
        taskId: '222', phase, role: 'RESULT', contentHash: 'd'.repeat(64),
      })
      expect(parseMissionControlState(renderMissionControlState(accepted))).toMatchObject({ valid: true })
    }

    for (const phase of [
      'Dev (implementation)',
      'Dev (correction)',
      'Delivery',
      'Reviewer',
      'Planning',
      'arbitrary non-empty phase',
    ]) {
      const rejected = structuredClone(base)
      rejected.latest_transition_identity = JSON.stringify({
        taskId: '222', phase, role: 'RESULT', contentHash: 'e'.repeat(64),
      })
      expect(parseMissionControlState(renderMissionControlState(rejected))).toMatchObject({
        valid: false,
        reason: 'pre-review Founder decision gate must bind the active task to a Diagnostic or Investigation RESULT phase',
      })
    }
  })

  it('rejects Review 3 STATE_MIGRATION_REQUIRED legacy shapes at preflight without migration repair', () => {
    const legacy: Record<string, unknown> = {
      schema_version: 1,
      state: 'STATE_MIGRATION_REQUIRED',
      review_cycle: 3,
      full_review_count: 1,
      active_pr: '#172',
      current_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570',
      last_reviewed_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570',
      approved_base: 'main',
      active_task_issue: '#171',
      guide_version: '1.0.0',
      guide_source_ref: 'main',
      guide_source_sha: null,
      open_blockers: ['MC-R1-171-001'],
      follow_up_issues: [],
      next_permitted_action: 'none',
      material_change_status: 'none',
      updated_at: null,
      updated_by: null,
      post_budget_reviews: [],
      founder_decision: {
        status: 'approved', authority: 'Founder', scope: 'correction', for_review_number: 3,
        reviewed_head: '1f05427a8fbb893e726dd0e317ff30a90d7b3570', finding_ids: ['MC-R1-171-001'],
        action: 'Authorize one bounded correction',
        authorized_at: '2026-07-26T01:30:29+07:00',
      },
    }
    const parsed = parseMissionControlState(renderMissionControlState(legacy))
    expect(parsed.valid).toBe(true)
    expect(classifyReconciliation({ managedState: legacy }).outcome).toBe('NO_OP')
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

  it('freezes the complete authorized Founder record in the consumed HANDOFF binding', async () => {
    let state: any = {
      state: 'FOUNDER_AUTHORIZED_CORRECTION', review_cycle: 3, full_review_count: 1,
      active_pr: '#172', current_head: 'reviewed-head', last_reviewed_head: 'reviewed-head', post_budget_reviews: [],
      founder_correction_authorization: {
        schema_version: 2, authorization_id: 'founder-171', status: 'authorized', authority: 'Founder',
        scope: 'correction', for_review_number: 3, reviewed_head: 'reviewed-head', finding_ids: ['MC-R1-171-001'],
        action: 'Authorize one bounded correction', authorized_at: '2026-07-26T01:30:29+07:00',
      },
    }
    const result = await dispatchFounderAuthorizedCorrection({
      readState: async () => state,
      writeState: async (next: any) => { state = next },
      reserveAuthorization: async () => ({ reservation_id: 'winner' }),
      releaseAuthorization: async (): Promise<void> => undefined,
      postHandoff: async () => ({ id: 'handoff-1', created_at: 'now', updated_at: 'now' }),
      retractHandoff: async (): Promise<void> => undefined,
      handoffBody: '## HANDOFF\n\n**Target:** Dev / Integration Builder\n**Founder correction authorization:** `founder-171`',
      updatedAt: '2026-07-26T02:00:00Z',
      updatedBy: 'Mission Control',
    })

    expect(result.state).toMatchObject({
      updated_at: '2026-07-26T02:00:00Z', updated_by: 'Mission Control',
      founder_correction_authorization: {
        handoff_binding: {
          authorization_snapshot: {
            authorization_id: 'founder-171', authority: 'Founder', status: 'authorized',
            action: 'Authorize one bounded correction', authorized_at: '2026-07-26T01:30:29+07:00',
            scope: 'correction', for_review_number: 3, reviewed_head: 'reviewed-head',
            finding_ids: ['MC-R1-171-001'],
          },
        },
      },
    })
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
      latestResult: { parsed: { headSha: 'corrected-head', base: 'main', prNumber: '172' } },
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
      latestResult: { parsed: { headSha: 'corrected-head', base: 'main', prNumber: '174' } },
    })

    expect(proposal).toMatchObject({
      state: 'AWAITING_REVIEW_2', review_cycle: 1, full_review_count: 1,
      current_head: 'corrected-head', last_reviewed_head: 'reviewed-head',
      open_blockers: prior.open_blockers, finding_lineage: prior.finding_lineage,
    })
    expect(proposal.next_permitted_action).toMatch(/Review 2/)
  })

  it('Issue #255: delivery projection keeps canonical issue and PR scalars through YAML round-trip', () => {
    const prior: any = {
      schema_version: 1,
      state: 'CORRECTION_REQUIRED_1',
      review_cycle: 1,
      full_review_count: 1,
      approved_base: 'main',
      active_task_issue: '#255',
      active_pr: '#256',
      current_head: '20fd9bd3587fa0159a2259f203324b6bc5ba1006',
      last_reviewed_head: '20fd9bd3587fa0159a2259f203324b6bc5ba1006',
      workflow_mode: 'implementation_pr',
      guide_version: '1.3.0',
      guide_source_ref: 'main',
      guide_source_sha: '4e18fbaf85b7f87091eb43ed6489b2ed565cf289',
      open_blockers: ['MC-R1-001'],
      follow_up_issues: [],
      next_permitted_action: 'Reviewer performs bounded Review 2.',
      material_change_status: 'none',
      updated_at: '2026-08-02T22:44:00+07:00',
      updated_by: 'Mission Control',
      founder_decision: {
        status: 'approved',
        authority: 'Founder',
        scope: 'issue_255_p0_reliability_implementation',
        action: 'Approve bounded implementation plan',
      },
      latest_handoff_comment_id: '5158958994',
      latest_result_comment_id: '5158896755',
      latest_review_verdict_comment_id: '5158946437',
      latest_transition_identity: 'transition-255-review-1',
    }
    const proposal = proposeDeliveryReconciliation({
      managedState: prior,
      livePr: { number: '256', headRefOid: 'corrected-head', baseRefName: 'main' },
      activeTaskIssue: '255',
      latestResult: { parsed: { headSha: 'corrected-head', base: 'main', prNumber: '256' } },
      updatedAt: '2026-08-02T22:50:00+07:00',
    })

    expect(proposal).toMatchObject({
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      active_task_issue: '#255',
      active_pr: '#256',
      open_blockers: ['MC-R1-001'],
      founder_decision: prior.founder_decision,
    })

    const rendered = renderMissionControlState(proposal)
    const parsed = parseMissionControlState(rendered)
    expect(parsed).toMatchObject({ present: true, valid: true })
    expect(parsed.state).toMatchObject({
      active_task_issue: '#255',
      active_pr: '#256',
      review_cycle: 1,
      full_review_count: 1,
      open_blockers: ['MC-R1-001'],
      founder_decision: prior.founder_decision,
    })
    expect(parsed.state?.active_task_issue).not.toMatch(/["\\]/)
    expect(parsed.state?.active_pr).not.toMatch(/["\\]/)
    expect(rendered).toContain('active_task_issue: "#255"')
    expect(rendered).toContain('active_pr: "#256"')
    expect(rendered).not.toMatch(/\\/)
  })
  it.each([
    ['contradictory authority', { authoritativeContradiction: true }, 'STATE_CONFLICT'],
    ['unavailable evidence', { requiredEvidenceUnavailable: true }, 'BLOCKED_EXTERNAL'],
    ['bookkeeping lag', { bookkeepingProposal: { state: 'AWAITING_REVIEW_1' } }, 'BOOKKEEPING_REPAIR'],
    ['terminal lag', { terminal: { issueClosed: true, prMerged: true, reviewedHeadMatches: true, currentHeadMatches: true, mergeCommit: 'merge-sha', exactHeadCi: true }, managedState: { state: 'ELIGIBLE_FOR_FOUNDER_REVIEW' } }, 'TERMINAL_REPAIR'],
    ['identical evidence', { managedState: { state: 'DONE' }, terminal: { issueClosed: true, prMerged: true, reviewedHeadMatches: true, currentHeadMatches: true, mergeCommit: 'merge-sha', exactHeadCi: true } }, 'NO_OP'],
  ])('strictly classifies %s', (_name, evidence, expected) => {
    expect(classifyReconciliation(evidence).outcome).toBe(expected)
  })

  it.each([
    ['post_budget_review_history', { post_budget_review_history: [] }],
    ['founder_authorization', {
      founder_authorization: {
        status: 'approved', authority: 'Founder', scope: 'review', review_number: 4,
        reviewed_head: 'review-4-head', action: 'Authorize bounded Review 4',
        authorized_at: '2026-07-23T16:30:00Z',
      },
    }],
  ])('rejects obsolete legacy field %s at parse time', (_name, legacyFields) => {
    const parsed = parseMissionControlState(renderMissionControlState({
      schema_version: 1,
      state: 'STATE_CONFLICT',
      review_cycle: 3,
      full_review_count: 1,
      approved_base: 'main',
      active_task_issue: '#155',
      active_pr: '#157',
      current_head: 'review-4-head',
      last_reviewed_head: 'review-4-head',
      guide_version: '1.0.0',
      guide_source_ref: 'main',
      guide_source_sha: null as string | null,
      open_blockers: [] as string[],
      follow_up_issues: [] as string[],
      next_permitted_action: 'none',
      material_change_status: 'none',
      updated_at: null,
      updated_by: null,
      ...legacyFields,
    }))
    const legacyKey = Object.keys(legacyFields)[0]
    expect(parsed).toMatchObject({
      valid: false,
      reason: `obsolete legacy field ${legacyKey} is not supported`,
    })
  })

  it('does not classify legacy-only evidence as repair outcomes when classification is invoked directly', () => {
    expect(classifyReconciliation({ managedState: { post_budget_review_history: [] } }).outcome).toBe('NO_OP')
    expect(classifyReconciliation({
      managedState: { post_budget_review_history: [] },
      bookkeepingProposal: { state: 'AWAITING_REVIEW_1' },
    }).outcome).toBe('BOOKKEEPING_REPAIR')
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

  it('does not attempt bounded repair for legacy-only managed state shapes', async () => {
    const result = await runBoundedReconciliation({
      readEvidence: async () => ({ managedState: { post_budget_review_history: [] as unknown[] } }),
      writeState: async () => { throw new Error('must not write legacy migration repair') },
    })

    expect(result).toMatchObject({
      finalOutcome: 'NO_OP',
      measurements: { state_writes: 0, reconciliation_attempts: 1 },
    })
  })

  it('fails closed after its single verification when a repair remains necessary', async () => {
    let reads = 0
    const result = await runBoundedReconciliation({
      readEvidence: async () => {
        reads += 1
        return {
          managedState: { state: 'READY' },
          bookkeepingProposal: { state: 'AWAITING_REVIEW_1' },
        }
      },
      writeState: async (nextState: any) => nextState,
    })

    expect(reads).toBe(2)
    expect(result).toMatchObject({
      outcome: 'BOOKKEEPING_REPAIR',
      finalOutcome: 'STATE_CONFLICT',
      finalReason: 'bounded repair was not confirmed by the single verification',
      measurements: { state_writes: 1, reconciliation_attempts: 2 },
    })
  })

  it('requires the durable write to return the exact proposed state', async () => {
    await expect(runBoundedReconciliation({
      readEvidence: async () => ({
        managedState: { state: 'READY' },
        bookkeepingProposal: { state: 'AWAITING_REVIEW_1' },
      }),
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
    expect(result.base).toBe('main')
    expect(result.headSha).toBe('abc1234')

    expect(verdict.role).toBe('REVIEW_VERDICT')
    expect(verdict.base).toBe('main')
    expect(verdict.verdict).toBe('ELIGIBLE FOR FOUNDER REVIEW')
    expect(verdict.headSha).toBe('abc1234')
  })

  it('scopes REVIEW_VERDICT prNumber to the canonical PR / base / head field (Issue #175)', () => {
    const verdict = parseRoleCommentBody(`## REVIEW_VERDICT
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/174 · \`main\` · \`abc1234\`
**Verdict:** CORRECTION REQUIRED
**Stop:** Do not modify PR #172 or blocked dependency work.
**Also:** https://github.com/boat1994/bemoat-web-starter/pull/172
`)

    expect(verdict.prNumber).toBe('174')
  })

  it('prefers the full canonical head and normalizes uppercase authority metadata', () => {
    const fullHead = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
    const verdict = parseRoleCommentBody(`## REVIEW_VERDICT
**State:** AWAITING_REVIEW_3 · head \`abcdef0\`
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/174 · \`main\` · \`${fullHead}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
`)

    expect(verdict.headSha).toBe(fullHead.toLowerCase())
  })

  it('persists lowercase authority heads through review projection', () => {
    const fullHead = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
    const projected = projectReviewVerdictState({
      prior: {
        state: 'AWAITING_REVIEW_1',
        review_cycle: 0,
        full_review_count: 0,
      },
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewType: 'full',
      reviewedHead: fullHead,
      commentId: 'verdict-1',
      transitionIdentity: 'review-identity',
    })

    expect(projected.current_head).toBe(fullHead.toLowerCase())
    expect(projected.last_reviewed_head).toBe(fullHead.toLowerCase())
  })

  it('scenario 1: valid delivery does not require conflict before Review 1', () => {
    const lag = classifyDeliveryLag(
      { state: 'IN_PROGRESS', active_pr: null, current_head: null },
      { number: '121', headRefOid: FULL_SAMPLE_HEAD },
      { exactHeadVerified: true },
      { parsed: parseRoleCommentBody(sampleResult.replaceAll('abc1234', FULL_SAMPLE_HEAD)) },
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
      livePr: { number: '121', headRefOid: FULL_SAMPLE_HEAD, baseRefName: 'main' },
      activeTaskIssue: '120',
      latestResult: { parsed: parseRoleCommentBody(sampleResult.replaceAll('abc1234', FULL_SAMPLE_HEAD)) },
    })

    expect(proposal).toMatchObject({
      state: 'AWAITING_REVIEW_1',
      active_pr: '#121',
      current_head: FULL_SAMPLE_HEAD,
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

  it('scenario 6: head drift during merge transition blocks the operation', () => {
    expect(classifyMergeDrift('authorizedhead', 'livehead')).toMatchObject({ drift: true })
    expect(classifyMergeDrift('samehead', 'samehead')).toMatchObject({ drift: false })
    expect(classifyMergeDrift(' ABCDEF ', 'abcdef')).toEqual({ drift: false, reason: null })
    expect(classifyMergeDrift(null, 'livehead')).toEqual({
      drift: true,
      reason: 'missing authorized or live head for merge transition',
    })
    expect(classifyMergeDrift('authorizedhead', '')).toEqual({
      drift: true,
      reason: 'missing authorized or live head for merge transition',
    })
  })

  it('scenario 7: delivery reconciliation never increments review counters', () => {
    const proposal = proposeDeliveryReconciliation({
      livePr: { number: '121', headRefOid: FULL_SAMPLE_HEAD, baseRefName: 'main' },
      activeTaskIssue: '120',
      latestResult: { parsed: parseRoleCommentBody(sampleResult.replaceAll('abc1234', FULL_SAMPLE_HEAD)) },
    })

    expect(proposal.review_cycle).toBe(0)
    expect(proposal.full_review_count).toBe(0)
  })

  it('detects post-review bookkeeping lag from verdict evidence', () => {
    const lag = classifyReviewLag(
      { state: 'AWAITING_REVIEW_1', review_cycle: 0, last_reviewed_head: null },
      { headRefOid: FULL_SAMPLE_HEAD },
      { parsed: parseRoleCommentBody(sampleVerdict.replaceAll('abc1234', FULL_SAMPLE_HEAD)) },
    )

    expect(lag.kind).toBe('DETERMINISTIC_RECONCILIATION')
  })

  it('characterizes authorized post-budget Review 4 lag instead of a false NO_OP', () => {
    const reviewedHead = 'a'.repeat(40)
    const analysis = analyzeReconciliation({
      managedState: {
        state: 'BLOCKED_FOR_FOUNDER_DECISION',
        review_cycle: 3,
        full_review_count: 1,
        approved_base: 'main',
        active_task_issue: '#333',
        active_pr: '#366',
        current_head: reviewedHead,
        last_reviewed_head: 'b'.repeat(40),
        post_budget_reviews: [],
        founder_decision: {
          status: 'approved',
          authority: 'Founder',
          scope: 'review',
          review_number: 4,
          reviewed_head: reviewedHead,
          action: `Authorize exactly one bounded Review 4 on PR #366 at exact head ${reviewedHead}`,
          authorized_at: '2026-08-19T00:00:00Z',
        },
        open_blockers: ['MC-R2-004'],
      },
      livePr: { number: '366', headRefOid: reviewedHead, baseRefName: 'main' },
      exactHeadCi: { available: true, exactHeadVerified: true, headSha: reviewedHead, ciSha: reviewedHead },
      latestVerdict: {
        parsed: {
          verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
          prNumber: '366',
          headSha: reviewedHead,
          base: 'main',
        },
        comment: {
          id: '5337047094',
          body: `## REVIEW_VERDICT

**Task / Issue:** #333
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/366 · \`main\` · \`${reviewedHead}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW

### Immutable finding disposition
- \`MC-R2-004\`: Resolved.
`,
        },
      },
      activeTaskIssue: '333',
      stateConflictBlockers: [],
    })

    expect(analysis.review).toMatchObject({ lag: true, kind: 'DETERMINISTIC_RECONCILIATION' })
    expect(analysis.classification.outcome).toBe('BOOKKEEPING_REPAIR')
    expect(analysis.proposal?.type).toBe('review')
    expect(analysis.proposal?.fields).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 3,
      full_review_count: 1,
      current_head: reviewedHead,
      last_reviewed_head: reviewedHead,
      open_blockers: [],
      post_budget_reviews: [{
        review_number: 4,
        pr_number: '366',
        base: 'main',
        reviewed_head: reviewedHead,
        verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
        verdict_comment_id: '5337047094',
        authorization: expect.objectContaining({ review_number: 4, reviewed_head: reviewedHead }),
        finding_dispositions: [{ finding_id: 'MC-R2-004', disposition: 'resolved' }],
      }],
      finding_lineage: [{ finding_id: 'MC-R2-004', disposition: 'resolved' }],
    })
  })

  const LIVE_REVIEW4_FINDING_IDS = ['MC-R2-004', 'MC-R2-001', 'MC-R2-002', 'MC-R2-003']
  const liveReview4FindingLineage = LIVE_REVIEW4_FINDING_IDS.map((finding_id) => ({ finding_id, disposition: 'resolved' }))

  it('accepts a delivered reopen at a new head when the current RESULT binding is present', () => {
    const predecessorHead = 'bdfb9454f0a34ab68b8b4805742bc4576737c691'
    const lastReviewedHead = 'd3cf0176e07e3ce9c67ab26889742a59281b1f68'
    const synchronizedHead = '2cd4f3a375f227c6607199a4274e887630b970e0'
    const review4 = {
      review_number: 4,
      reviewed_head: lastReviewedHead,
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      authorization: {
        status: 'approved',
        authority: 'Founder',
        scope: 'review',
        review_number: 4,
        reviewed_head: lastReviewedHead,
        action: 'Authorize bounded Review 4',
        authorized_at: '2026-08-19T09:29:00+07:00',
      },
      finding_dispositions: liveReview4FindingLineage,
    }
    const prior = {
      schema_version: 1,
      state: 'IN_PROGRESS',
      review_cycle: 3,
      full_review_count: 1,
      approved_base: 'main',
      active_task_issue: '#333',
      active_pr: '#366',
      current_head: predecessorHead,
      last_reviewed_head: lastReviewedHead,
      post_budget_reviews: [review4],
      founder_correction_authorization: {
        schema_version: 2,
        authorization_id: 'founder-333-review-3',
        status: 'consumed',
        authority: 'Founder',
        scope: 'correction',
        action: 'reopen',
        bundle_kind: 'founder-reopen',
        for_review_number: 3,
        review_cycle: 3,
        reviewed_head: predecessorHead,
        exact_head: predecessorHead,
        old_reviewed_head: lastReviewedHead,
        protected_base_sha: 'a4d58f4b1d520ffe655d0b0fc7443b4927f70330',
        original_result_comment_id: '5331236209',
        authorization_record: {
          exact_head: predecessorHead,
          reviewed_head: predecessorHead,
          old_reviewed_head: lastReviewedHead,
          protected_base_sha: 'a4d58f4b1d520ffe655d0b0fc7443b4927f70330',
        },
        finding_ids: LIVE_REVIEW4_FINDING_IDS,
        authorized_at: '2026-08-19T09:30:00+07:00',
        handoff_comment_id: '5331236000',
        handoff_binding: {
          schema_version: 1,
          content_sha256: 'a'.repeat(64),
          binding_sha256: 'b'.repeat(64),
        },
        delta_review_requirement: true,
        required_next_review: 'Delta Review',
        maximum_correction_deliveries: 1,
        correction_deliveries: 0,
        delta_review_count: 0,
      },
      guide_version: '1.3.0',
      guide_source_ref: 'main',
      guide_source_sha: null as string | null,
      open_blockers: [] as string[],
      finding_lineage: liveReview4FindingLineage,
      follow_up_issues: [] as string[],
      next_permitted_action: 'Execute exactly one bounded correction RESULT, then one Delta Review.',
      material_change_status: 'none',
      updated_at: '2026-08-19T10:00:00Z',
      updated_by: 'Mission Control',
    }

    const proposal = proposeDeliveryReconciliation({
      managedState: prior,
      livePr: { number: '366', headRefOid: synchronizedHead, baseRefName: 'main' },
      activeTaskIssue: '333',
      latestResult: { parsed: { prNumber: '366', base: 'main', headSha: synchronizedHead } },
      updatedAt: '2026-08-23T00:00:00Z',
    })

    expect(proposal).toMatchObject({
      state: 'AWAITING_REVIEW_3',
      review_cycle: 3,
      full_review_count: 1,
      current_head: synchronizedHead,
      last_reviewed_head: lastReviewedHead,
      post_budget_reviews: [review4],
      finding_lineage: prior.finding_lineage,
      founder_correction_authorization: {
        status: 'consumed',
        reviewed_head: predecessorHead,
        correction_deliveries: 1,
      },
    })

    const parsed = parseMissionControlState(renderMissionControlState({
      ...proposal,
      latest_result_comment_id: '5384309331',
      latest_transition_identity: JSON.stringify({
        taskId: '333',
        phase: 'Dev (synchronization)',
        role: 'RESULT',
        contentHash: 'c'.repeat(64),
      }),
    }))
    expect(parsed).toMatchObject({
      present: true,
      valid: true,
    })
  })

  it('keeps the delivered reopen historical same-head path valid without a new RESULT binding', () => {
    const predecessorHead = 'bdfb9454f0a34ab68b8b4805742bc4576737c691'
    const lastReviewedHead = 'd3cf0176e07e3ce9c67ab26889742a59281b1f68'
    const prior = {
      schema_version: 1,
      state: 'AWAITING_REVIEW_3',
      review_cycle: 3,
      full_review_count: 1,
      approved_base: 'main',
      active_task_issue: '#333',
      active_pr: '#366',
      current_head: predecessorHead,
      last_reviewed_head: lastReviewedHead,
      post_budget_reviews: [{
        review_number: 4,
        reviewed_head: lastReviewedHead,
        verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
        authorization: {
          status: 'approved',
          authority: 'Founder',
          scope: 'review',
          review_number: 4,
          reviewed_head: lastReviewedHead,
          action: 'Authorize bounded Review 4',
          authorized_at: '2026-08-19T09:29:00+07:00',
        },
        finding_dispositions: liveReview4FindingLineage,
      }],
      founder_correction_authorization: {
        schema_version: 2,
        authorization_id: 'founder-333-review-3',
        status: 'consumed',
        authority: 'Founder',
        scope: 'correction',
        action: 'reopen',
        bundle_kind: 'founder-reopen',
        for_review_number: 3,
        review_cycle: 3,
        reviewed_head: predecessorHead,
        exact_head: predecessorHead,
        old_reviewed_head: lastReviewedHead,
        protected_base_sha: 'a4d58f4b1d520ffe655d0b0fc7443b4927f70330',
        original_result_comment_id: '5331236209',
        authorization_record: {
          exact_head: predecessorHead,
          reviewed_head: predecessorHead,
          old_reviewed_head: lastReviewedHead,
          protected_base_sha: 'a4d58f4b1d520ffe655d0b0fc7443b4927f70330',
        },
        finding_ids: LIVE_REVIEW4_FINDING_IDS,
        authorized_at: '2026-08-19T09:30:00+07:00',
        handoff_comment_id: '5331236000',
        handoff_binding: {
          schema_version: 1,
          content_sha256: 'a'.repeat(64),
          binding_sha256: 'b'.repeat(64),
        },
        delta_review_requirement: true,
        required_next_review: 'Delta Review',
        maximum_correction_deliveries: 1,
        correction_deliveries: 1,
        delta_review_count: 0,
      },
      guide_version: '1.3.0',
      guide_source_ref: 'main',
      guide_source_sha: null as string | null,
      open_blockers: [] as string[],
      finding_lineage: liveReview4FindingLineage,
      follow_up_issues: [] as string[],
      next_permitted_action: 'Reviewer performs bounded Delta Review.',
      material_change_status: 'none',
      updated_at: '2026-08-23T00:00:00Z',
      updated_by: 'Mission Control',
    }

    expect(parseMissionControlState(renderMissionControlState(prior))).toMatchObject({
      present: true,
      valid: true,
    })
  })

  it('rejects a delivered reopen at a new head when the current RESULT binding is missing or invalid', () => {
    const predecessorHead = 'bdfb9454f0a34ab68b8b4805742bc4576737c691'
    const lastReviewedHead = 'd3cf0176e07e3ce9c67ab26889742a59281b1f68'
    const synchronizedHead = '2cd4f3a375f227c6607199a4274e887630b970e0'
    const state = {
      schema_version: 1,
      state: 'AWAITING_REVIEW_3',
      review_cycle: 3,
      full_review_count: 1,
      approved_base: 'main',
      active_task_issue: '#333',
      active_pr: '#366',
      current_head: synchronizedHead,
      last_reviewed_head: lastReviewedHead,
      post_budget_reviews: [{
        review_number: 4,
        reviewed_head: lastReviewedHead,
        verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
        authorization: {
          status: 'approved',
          authority: 'Founder',
          scope: 'review',
          review_number: 4,
          reviewed_head: lastReviewedHead,
          action: 'Authorize bounded Review 4',
          authorized_at: '2026-08-19T09:29:00+07:00',
        },
        finding_dispositions: liveReview4FindingLineage,
      }],
      founder_correction_authorization: {
        schema_version: 2,
        authorization_id: 'founder-333-review-3',
        status: 'consumed',
        authority: 'Founder',
        scope: 'correction',
        action: 'reopen',
        bundle_kind: 'founder-reopen',
        for_review_number: 3,
        review_cycle: 3,
        reviewed_head: predecessorHead,
        exact_head: predecessorHead,
        old_reviewed_head: lastReviewedHead,
        protected_base_sha: 'a4d58f4b1d520ffe655d0b0fc7443b4927f70330',
        original_result_comment_id: '5331236209',
        authorization_record: {
          exact_head: predecessorHead,
          reviewed_head: predecessorHead,
          old_reviewed_head: lastReviewedHead,
          protected_base_sha: 'a4d58f4b1d520ffe655d0b0fc7443b4927f70330',
        },
        finding_ids: LIVE_REVIEW4_FINDING_IDS,
        authorized_at: '2026-08-19T09:30:00+07:00',
        handoff_comment_id: '5331236000',
        handoff_binding: {
          schema_version: 1,
          content_sha256: 'a'.repeat(64),
          binding_sha256: 'b'.repeat(64),
        },
        delta_review_requirement: true,
        required_next_review: 'Delta Review',
        maximum_correction_deliveries: 1,
        correction_deliveries: 1,
        delta_review_count: 0,
      },
      guide_version: '1.3.0',
      guide_source_ref: 'main',
      guide_source_sha: null as string | null,
      open_blockers: [] as string[],
      finding_lineage: liveReview4FindingLineage,
      follow_up_issues: [] as string[],
      next_permitted_action: 'Reviewer performs bounded Delta Review.',
      material_change_status: 'none',
      updated_at: '2026-08-23T00:00:00Z',
      updated_by: 'Mission Control',
    }

    expect(parseMissionControlState(renderMissionControlState(state))).toMatchObject({
      present: true,
      valid: false,
      reason: 'Review 3 Founder correction authorization binding is invalid',
    })

    const validCurrentBinding = {
      ...state,
      latest_result_comment_id: '5384309331',
      latest_transition_identity: JSON.stringify({
        taskId: '333',
        phase: 'Dev (synchronization)',
        role: 'RESULT',
        contentHash: 'c'.repeat(64),
      }),
    }
    expect(parseMissionControlState(renderMissionControlState(validCurrentBinding))).toMatchObject({
      present: true,
      valid: true,
    })

    const invalidBinding = {
      ...validCurrentBinding,
      latest_transition_identity: JSON.stringify({
        taskId: '333',
        phase: 'Dev (synchronization)',
        role: 'REVIEW_VERDICT',
        contentHash: 'c'.repeat(64),
      }),
    }
    expect(parseMissionControlState(renderMissionControlState(invalidBinding))).toMatchObject({
      present: true,
      valid: false,
      reason: 'Review 3 Founder correction authorization binding is invalid',
    })

    const historicalResultBinding = {
      ...validCurrentBinding,
      latest_result_comment_id: '5331236209',
    }
    expect(parseMissionControlState(renderMissionControlState(historicalResultBinding))).toMatchObject({
      present: true,
      valid: false,
      reason: 'Review 3 Founder correction authorization binding is invalid',
    })

    const invalidHistoricalBinding = {
      ...validCurrentBinding,
      founder_correction_authorization: {
        ...state.founder_correction_authorization,
        exact_head: synchronizedHead,
      },
    }
    expect(parseMissionControlState(renderMissionControlState(invalidHistoricalBinding))).toMatchObject({
      present: true,
      valid: false,
      reason: 'Review 3 Founder correction authorization binding is invalid',
    })

    for (const historicalOverride of [
      { reviewed_head: '1111111111111111111111111111111111111111' },
      { old_reviewed_head: '1111111111111111111111111111111111111111' },
      { protected_base_sha: 'not-a-full-sha' },
    ]) {
      const malformedHistoricalBinding = {
        ...validCurrentBinding,
        founder_correction_authorization: {
          ...state.founder_correction_authorization,
          ...historicalOverride,
        },
      }
      expect(parseMissionControlState(renderMissionControlState(malformedHistoricalBinding))).toMatchObject({
        present: true,
        valid: false,
        reason: 'Review 3 Founder correction authorization binding is invalid',
      })
    }
  })

  it('fails closed without writes when an older active malformed verdict precedes valid Review 4 evidence', async () => {
    const context = authorizedPostBudgetReview4Context()
    const malformedVerdict = {
      id: '5337047000',
      createdAt: '2026-08-19T00:00:00Z',
      body: `## REVIEW_VERDICT

**Task / Issue:** #333
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
`,
    }
    const validVerdict = {
      ...context.latestVerdict.comment,
      createdAt: '2026-08-19T00:01:00Z',
    }
    const comments = [malformedVerdict, validVerdict]

    const blockers = getPostBudgetReviewEvidenceBlockers(
      comments,
      '333',
      '#366',
      context.managedState,
    )
    expect(blockers).toEqual([expect.stringContaining('STATE_CONFLICT')])

    let writes = 0
    const readEvidence = async () => {
      const evidenceBlockers = getPostBudgetReviewEvidenceBlockers(
        comments,
        '333',
        '#366',
        context.managedState,
      )
      const analysis = analyzeReconciliation({
        ...context,
        stateConflictBlockers: evidenceBlockers,
      })
      return {
        managedState: context.managedState,
        classification: analysis.classification,
        bookkeepingProposal: analysis.proposal?.fields ?? null,
      }
    }
    const writeState = async () => {
      writes += 1
      return context.managedState
    }

    const result = await runBoundedReconciliation({ readEvidence, writeState })

    expect(result.finalOutcome).toBe('STATE_CONFLICT')
    expect(result.measurements.state_writes).toBe(0)
    expect(writes).toBe(0)
  })

  it('projects authorized Review 4 once and makes an identical retry deterministic NO_OP', async () => {
    const context = authorizedPostBudgetReview4Context()
    let state = structuredClone(context.managedState)
    let writes = 0
    const readEvidence = async () => {
      const analysis = analyzeReconciliation({ ...context, managedState: state })
      return {
        managedState: state,
        classification: analysis.classification,
        bookkeepingProposal: analysis.proposal?.fields ?? null,
      }
    }
    const writeState = async (next: any, expected: any) => {
      expect(state).toEqual(expected)
      writes += 1
      state = structuredClone(next)
      return structuredClone(state)
    }

    const first = await runBoundedReconciliation({ readEvidence, writeState })
    expect(first.finalOutcome).toBe('NO_OP')
    expect(first.measurements.state_writes).toBe(1)
    expect(writes).toBe(1)
    expect(state).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 3,
      full_review_count: 1,
      post_budget_reviews: [{ review_number: 4 }],
    })

    const retry = await runBoundedReconciliation({ readEvidence, writeState })
    expect(retry.finalOutcome).toBe('NO_OP')
    expect(retry.measurements.state_writes).toBe(0)
    expect(writes).toBe(1)
  })

  it.each([
    ['missing Founder authorization', (context: any) => { context.managedState.founder_decision = null }, 'STATE_CONFLICT'],
    ['missing Review 4 verdict', (context: any) => { context.latestVerdict = null }, 'BLOCKED_EXTERNAL'],
    ['base drift', (context: any) => { context.livePr.baseRefName = 'dev' }, 'STATE_CONFLICT'],
    ['pending exact-head CI', (context: any) => { context.exactHeadCi = { available: true, exactHeadVerified: false } }, 'BLOCKED_EXTERNAL'],
    ['stale exact-head CI', (context: any) => { context.exactHeadCi = { available: true, exactHeadVerified: false, olderShaSuccess: true } }, 'STATE_CONFLICT'],
  ])('fails closed for %s', (label, mutate, expectedOutcome) => {
    const context = authorizedPostBudgetReview4Context()
    mutate(context)
    const analysis = analyzeReconciliation(context)
    expect(analysis.classification.outcome, label).toBe(expectedOutcome)
    expect(analysis.proposal).toBeNull()
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
      livePr: { number: '121', headRefOid: FULL_SAMPLE_HEAD, baseRefName: 'main' },
      exactHeadCi: { exactHeadVerified: true },
      latestResult: { parsed: parseRoleCommentBody(sampleResult.replaceAll('abc1234', FULL_SAMPLE_HEAD)) },
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

describe('review verdict projection boundary', () => {
  const coreVerdicts = [
    ['CORRECTION REQUIRED', 'CORRECTION_REQUIRED_1', 'Dev posts correction ## RESULT, then Review 2 on the corrected head.'],
    ['ELIGIBLE FOR FOUNDER REVIEW', 'ELIGIBLE_FOR_FOUNDER_REVIEW', 'Founder merge authorization required before merge.'],
    ['BLOCKED FOR FOUNDER DECISION', 'BLOCKED_FOR_FOUNDER_DECISION', 'Founder Approve or Decline on remaining Blocker/Critical; no implementation prompt until Approve.'],
    ['BLOCKED EXTERNAL', 'BLOCKED_EXTERNAL', 'Resolve external blocker before continuing.'],
    ['STATE CONFLICT', 'STATE_CONFLICT', 'Mission Control must classify contradictory evidence.'],
  ] as const

  function priorState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schema_version: 1,
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      current_head: 'old-head',
      last_reviewed_head: null,
      open_blockers: [],
      nested: { untouched: ['prior-value'] },
      ...overrides,
    }
  }

  function project(input: Record<string, unknown>) {
    return reviewVerdictProjectionFacade.projectReviewVerdictState(input)
  }

  it.each(coreVerdicts)('projects Core verdict %s to %s with the exact next action', (verdict, state, nextAction) => {
    expect(project({
      prior: priorState(),
      verdict,
      reviewType: 'full',
      reviewedHead: ' ABCDEF0123456789ABCDEF0123456789ABCDEF01 ',
      commentId: 42,
      transitionIdentity: 'identity',
    })).toMatchObject({
      state,
      review_cycle: 1,
      full_review_count: 1,
      current_head: 'abcdef0123456789abcdef0123456789abcdef01',
      last_reviewed_head: 'abcdef0123456789abcdef0123456789abcdef01',
      next_permitted_action: nextAction,
    })
  })

  it.each([
    ['full', 0, true],
    ['full', 1, false],
    ['delta', 0, false],
    ['delta', 1, true],
    ['delta', 2, true],
  ] as const)('enforces the full/delta cycle matrix for %s review at cycle %s', (reviewType, reviewCycle, accepted) => {
    const input = {
      prior: priorState({ review_cycle: reviewCycle, full_review_count: reviewCycle === 0 ? 0 : 1 }),
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewType,
      reviewedHead: 'abc1234',
      commentId: 1,
      transitionIdentity: 'identity',
    }
    if (accepted) {
      expect(project(input).review_cycle).toBe(Math.min(reviewCycle + 1, 3))
    } else {
      expect(() => project(input)).toThrow(
        reviewType === 'full'
          ? 'full review requires review_cycle 0'
          : 'delta review requires an existing review cycle',
      )
    }
  })

  it.each([
    [{}, 'review projection requires prior managed state'],
    [{ prior: priorState(), verdict: 'NOT CORE', reviewType: 'full', reviewedHead: 'abc1234' }, 'review projection requires a Core verdict'],
    [{ prior: priorState(), verdict: 'STATE CONFLICT', reviewType: 'partial', reviewedHead: 'abc1234' }, 'review projection requires review type full or delta'],
    [{ prior: priorState(), verdict: 'STATE CONFLICT', reviewType: 'full', reviewedHead: '   ' }, 'review projection requires exact reviewed head'],
  ] as const)('rejects invalid projection input with the exact message', (input, message) => {
    expect(() => project(input)).toThrow(message)
  })

  it('deep clones nested prior state without mutating input while preserving identity reference assignment', () => {
    const transitionIdentity = { taskId: '333', contentHash: 'identity-hash' }
    const prior = priorState({ nested: { untouched: ['prior-value'], deep: { count: 1 } } })
    const before = structuredClone(prior)
    const projected = project({
      prior,
      verdict: 'CORRECTION REQUIRED',
      reviewType: 'full',
      reviewedHead: 'abc1234',
      commentId: 9001,
      transitionIdentity,
      updatedAt: '2026-08-14T01:00:00.000Z',
      updatedBy: 'Tester',
    })

    expect(prior).toEqual(before)
    expect(projected.nested).not.toBe(prior.nested)
    expect(projected.latest_transition_identity).toBe(transitionIdentity)
    expect(projected.latest_review_verdict_comment_id).toBe('9001')
    expect(projected.updated_at).toBe('2026-08-14T01:00:00.000Z')
    expect(projected.updated_by).toBe('Tester')
  })

  it('uses finding_id precedence, id fallback, and filters empty finding candidates only', () => {
    expect(project({
      prior: priorState(),
      verdict: 'CORRECTION REQUIRED',
      reviewType: 'full',
      reviewedHead: 'abc1234',
      commentId: 1,
      transitionIdentity: 'identity',
      findings: [
        { finding_id: 'finding-id', id: 'ignored-id' },
        { id: 'id-only' },
        { finding_id: '' },
        { id: '' },
        { finding_id: null, id: null },
        {},
        null,
      ],
    }).open_blockers).toEqual(['finding-id', 'id-only'])

    expect(project({
      prior: priorState(),
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewType: 'full',
      reviewedHead: 'abc1234',
      commentId: 1,
      transitionIdentity: 'identity',
      findings: [{ finding_id: 'ignored' }, { id: 'also-ignored' }],
    }).open_blockers).toEqual([])
  })

  it('preserves proposal cycle transitions and edge-case counter semantics', () => {
    const cases = [
      ['CORRECTION REQUIRED', 0, 0, 'CORRECTION_REQUIRED_1', 1, 1],
      ['CORRECTION REQUIRED', 1, 1, 'CORRECTION_REQUIRED_2', 2, 1],
      ['CORRECTION REQUIRED', 2, 1, 'STATE_CONFLICT', 2, 1],
      ['CORRECTION REQUIRED', 3, 9, 'STATE_CONFLICT', 3, 1],
      ['ELIGIBLE FOR FOUNDER REVIEW', 0, 0, 'ELIGIBLE_FOR_FOUNDER_REVIEW', 1, 1],
      ['ELIGIBLE FOR FOUNDER REVIEW', 3, 1, 'ELIGIBLE_FOR_FOUNDER_REVIEW', 3, 1],
    ] as const

    for (const [verdict, reviewCycle, fullReviewCount, state, nextCycle, nextFullReviewCount] of cases) {
      expect(proposeReviewReconciliation({
        verdict,
        reviewedHead: ' ABC1234 ',
        reviewCycle,
        fullReviewCount,
      })).toMatchObject({
        state,
        review_cycle: nextCycle,
        full_review_count: nextFullReviewCount,
        last_reviewed_head: 'abc1234',
      })
    }
  })

  it('keeps the export set and function identity of the canonical TypeScript module', async () => {
    const { existsSync } = await import('node:fs')
    const typed = await import('../../scripts/mission-control/review-verdict-projection.ts')
    expect(existsSync('scripts/mission-control/review-verdict-projection.mjs')).toBe(false)
    expect(Object.keys(reviewVerdictProjectionFacade).sort()).toEqual(Object.keys(typed).sort())
    for (const name of Object.keys(reviewVerdictProjectionFacade) as Array<keyof typeof reviewVerdictProjectionFacade>) {
      expect(reviewVerdictProjectionFacade[name]).toBe(typed[name])
    }
  })
})

describe('mission-control transition idempotency', () => {
  const FULL_RESULT_HEAD = 'deadbeef'.padEnd(40, '0')
  const handoffBody = `## HANDOFF

**Target:** Dev / Builder
**Task / Issue:** #184
**Phase:** Dev (implementation)

Bounded implementation work.
`

  const resultBody = `## RESULT

### Task log
- Timestamp: 2026-07-29T19:00:00+07:00
- Task / Issue: #184
- Phase: Dev (implementation)

**Completed:** Dev (implementation)
**State:** branch \`feature/184\` · base \`main\` · head \`${FULL_RESULT_HEAD}\`
**PR:** https://github.com/boat1994/bemoat-web-starter/pull/186
**Summary:** Transition idempotency implementation
`

  it('normalizes transition identity consistently', () => {
    const first = normalizeTransitionIdentity(handoffBody)
    const second = normalizeTransitionIdentity(handoffBody)
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      taskId: '184',
      phase: 'Dev (implementation)',
      role: 'HANDOFF',
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('assembles matching bindings with verified transport values taking precedence', () => {
    const assembled = buildTransitionMatchOptions({
      roleBody: resultBody,
      role: 'RESULT',
      trustedAuthors: ['boat1994'],
      requireTrustedAuthor: true,
      trustedAssociations: ['OWNER'],
      verifiedBase: 'release',
      verifiedHead: FULL_RESULT_HEAD,
    })

    expect(assembled).toMatchObject({
      identity: normalizeTransitionIdentity(resultBody, { role: 'RESULT' }),
      options: {
        activeOnly: true,
        bindings: {
          taskId: '184',
          phase: 'Dev (implementation)',
          prNumber: '186',
          base: 'release',
          headSha: FULL_RESULT_HEAD,
        },
        trustedAuthors: ['boat1994'],
        requireTrustedAuthor: true,
        trustedAssociations: ['OWNER'],
      },
    })
  })

  it('parses and matches comment markers exactly', () => {
    expect(parseCommentMarker('## HANDOFF\n\nWork')).toBe('HANDOFF')
    expect(parseCommentMarker('## RESULT\n\nDone')).toBe('RESULT')
    expect(parseCommentMarker('## REVIEW_VERDICT\n\nReview')).toBe('REVIEW_VERDICT')
    expect(parseCommentMarker('## OTHER\n\nNope')).toBeNull()
  })

  it('classifies pure transition', () => {
    expect(classifyTransition(0)).toBe('BLOCKED_EXTERNAL')
    expect(classifyTransition(1)).toBe('RESUME_PROJECTION')
    expect(classifyTransition(2)).toBe('STATE_CONFLICT')
  })

  it('keeps transition guard helpers available through the reconcile facade', () => {
    expect(resolveRoleComment).toBeTypeOf('function')
    expect(sameValue({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true)
    expect(deriveTransitionFacts({
      role: 'RESULT',
      roleBody: resultBody,
      prior: { state: 'IN_PROGRESS' },
      projected: { state: 'AWAITING_REVIEW_1' },
    })).toMatchObject({
      changesAuthoritativeState: true,
      producesEvidence: true,
    })
    expect(() => assertRoutingOnlyProjection({
      prior: { state: 'READY' },
      projected: { state: 'IN_PROGRESS' },
    })).toThrow('STATE_CONFLICT')
  })

  it('characterizes coordinator-owned routing over caller projection', () => {
    const identity = normalizeTransitionIdentity(handoffBody, { role: 'HANDOFF' })
    const projected = coordinatorOwnedRoutingProjection({
      prior: {
        state: 'READY',
        latest_handoff_comment_id: 'prior-handoff',
        latest_result_comment_id: 'prior-result',
        latest_transition_identity: 'prior-identity',
        next_permitted_action: 'Mission Control posts HANDOFF',
      },
      base: {
        state: 'CALLER_FORGED_STATE',
        latest_handoff_comment_id: 'caller-forged-handoff',
        latest_result_comment_id: 'caller-forged-result',
      },
      identity,
      comment: { id: 'handoff-1', body: `${handoffBody}\n**Target:** Dev / Builder` },
      role: 'HANDOFF',
      updatedAt: '2026-08-08T00:00:00.000Z',
      updatedBy: 'Tester',
    })

    expect(projected).toMatchObject({
      state: 'IN_PROGRESS',
      latest_handoff_comment_id: 'handoff-1',
      latest_result_comment_id: 'prior-result',
      latest_transition_identity: JSON.stringify(identity),
      next_permitted_action: 'Dev / Builder executes the authorized HANDOFF; do not re-post HANDOFF.',
      updated_at: '2026-08-08T00:00:00.000Z',
      updated_by: 'Tester',
    })
  })

  it('preserves state and prior routing action for a targetless replay', () => {
    const identity = normalizeTransitionIdentity(handoffBody, { role: 'HANDOFF' })
    const projected = coordinatorOwnedRoutingProjection({
      prior: {
        state: 'BLOCKED_FOR_FOUNDER_DECISION',
        next_permitted_action: 'Founder decides the bounded action.',
      },
      base: { state: 'CALLER_FORGED_STATE', next_permitted_action: 'caller action' },
      identity,
      comment: { id: 'handoff-2', body: handoffBody },
      role: 'HANDOFF',
      preserveState: true,
    })

    expect(projected).toMatchObject({
      state: 'CALLER_FORGED_STATE',
      next_permitted_action: 'caller action',
      latest_handoff_comment_id: 'handoff-2',
    })
  })

  it('coordinator injects transports', async () => {
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0, next_permitted_action: 'Mission Control posts HANDOFF' }
    const comments: any[] = []
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => { state = structuredClone(next); return state },
      listComments: async () => comments,
      postComment: async (body: string) => {
        const posted = { id: '1', body }
        comments.push(posted)
        return posted
      },
    })
    const result = await coordinator.integrateHandoff({ handoffBody })
    expect(result.outcome).toBe('DISPATCHED')
    expect(state.state).toBe('IN_PROGRESS')
    expect(state.latest_handoff_comment_id).toBe('1')
    expect(state.latest_transition_identity).toBeTruthy()
    expect(state.next_permitted_action).toMatch(/do not re-post HANDOFF/)
    expect(comments).toHaveLength(1)
  })

  it('recovers an ambiguous POST only through its exact trusted live identity', () => {
    const identity = normalizeTransitionIdentity(handoffBody, { role: 'HANDOFF' })
    const recovery = recoverAmbiguousPost({
      comments: [{
        id: '99',
        body: handoffBody,
        author: 'boat1994',
        author_association: 'OWNER',
      }],
      identity,
      body: handoffBody,
      role: 'HANDOFF',
      postedId: '99',
      ambiguousPost: true,
      matchOptions: {
        trustedAuthors: ['boat1994'],
        trustedAssociations: ['OWNER'],
      },
    })
    expect(recovery.classification).toBe('RESUME_PROJECTION')
    expect(recovery.comment?.id).toBe('99')
    expect(recovery.recovered).toBe(true)
  })

  it('does not recover an older identical comment when the authoritative POST id differs', () => {
    const identity = normalizeTransitionIdentity(handoffBody, { role: 'HANDOFF' })
    const recovery = recoverAmbiguousPost({
      comments: [{
        id: '99',
        body: handoffBody,
        author: 'boat1994',
        author_association: 'OWNER',
      }],
      identity,
      body: handoffBody,
      role: 'HANDOFF',
      postedId: '100',
      ambiguousPost: true,
      matchOptions: {
        trustedAuthors: ['boat1994'],
        trustedAssociations: ['OWNER'],
      },
    })

    expect(recovery.classification).toBe('AMBIGUOUS_RESULT')
    expect(recovery.comment).toBeUndefined()
  })

  it('keeps a possible post with no live match as AMBIGUOUS_RESULT', () => {
    const identity = normalizeTransitionIdentity(handoffBody, { role: 'HANDOFF' })
    const recovery = recoverAmbiguousPost({
      comments: [],
      identity,
      ambiguousPost: true,
    })

    expect(recovery.classification).toBe('AMBIGUOUS_RESULT')
  })

  it('preserves AMBIGUOUS_RESULT when the recovery comment read fails', async () => {
    let recoveryReads = 0
    const postError = Object.assign(new Error('comment POST response was lost'), {
      classification: 'AMBIGUOUS_RESULT',
      mutationPerformed: true,
    })
    const coordinator = new CoordinatorClass({
      readState: async () => ({ state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 }),
      writeState: async () => {
        throw new Error('ambiguous recovery must not write state')
      },
      listComments: async (): Promise<Array<Record<string, unknown>>> => {
        recoveryReads += 1
        if (recoveryReads === 1) return []
        throw new Error('BLOCKED_EXTERNAL: live comment read failed')
      },
      postComment: async () => {
        throw postError
      },
    })

    await expect(coordinator.integrateResult({
      resultBody,
      projectState: (state: Record<string, unknown>) => state,
    })).rejects.toMatchObject({
      classification: 'AMBIGUOUS_RESULT',
      mutationPerformed: true,
    })
    expect(recoveryReads).toBe(2)
  })

  it('maps a RESULT state-read failure after a possible state write to AMBIGUOUS_RESULT', async () => {
    let stateReads = 0
    const coordinator = new CoordinatorClass({
      readState: async () => {
        stateReads += 1
        if (stateReads === 1) return { state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 }
        throw new Error('Issue state read timed out after the write')
      },
      writeState: async () => {
        throw new Error('Issue state write response was lost')
      },
      listComments: async () => [] as any[],
      postComment: async (body: string) => ({ id: 'result-state-read-timeout', body }),
    })

    await expect(coordinator.integrateResult({
      resultBody,
      projectState: (state: Record<string, unknown>) => state,
    })).rejects.toMatchObject({
      classification: 'AMBIGUOUS_RESULT',
      mutationPerformed: true,
    })
  })

  it('maps a REVIEW_VERDICT state-read failure after a possible state write to AMBIGUOUS_RESULT', async () => {
    let stateReads = 0
    const reviewBody = `## REVIEW_VERDICT

### Task log
- Task / Issue: #184
- Phase: Reviewer

**PR / base / head:** PR #186 · \`main\` · \`deadbeef\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Important: bounded regression
`
    const coordinator = new CoordinatorClass({
      readState: async () => {
        stateReads += 1
        if (stateReads === 1) return { state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0 }
        throw new Error('Issue state read timed out after the write')
      },
      writeState: async () => {
        throw new Error('Issue state write response was lost')
      },
      listComments: async () => [] as any[],
      postComment: async (body: string) => ({ id: 'verdict-state-read-timeout', body }),
    })

    await expect((coordinator as any).integrateReviewVerdict({
      verdictBody: reviewBody,
      projectState: (state: Record<string, unknown>) => state,
    })).rejects.toMatchObject({
      classification: 'AMBIGUOUS_RESULT',
      mutationPerformed: true,
    })
  })

  it('recovers from comment-success/state-update-failure plus rerun', async () => {
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0 }
    const comments = [{ id: 'posted-1', body: handoffBody }]
    let postCalls = 0
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any, expected?: any) => {
        if (expected && expected.state !== state.state) {
          throw new Error('STATE_CONFLICT: concurrent Issue write detected')
        }
        state = next
        return structuredClone(state)
      },
      listComments: async () => comments,
      postComment: async () => {
        postCalls += 1
        throw new Error('should not post duplicate')
      },
    })
    // Production path: integrateHandoff rediscovers the live comment instead of posting again.
    const resumed = await coordinator.integrateHandoff({ handoffBody })
    expect(resumed.outcome).toBe('DISPATCHED')
    expect(postCalls).toBe(0)
    expect(state.state).toBe('IN_PROGRESS')
    expect(state.latest_handoff_comment_id).toBe('posted-1')
    expect(state.next_permitted_action).toMatch(/do not re-post HANDOFF/)
    expect(comments).toHaveLength(1)
  })

  it('incompatible concurrent state fail-closed', async () => {
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0, active_pr: null }
    const comments: any[] = []
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async () => {
        // Concurrent writer moved authority incompatibly after comment success.
        state = { state: 'AWAITING_REVIEW_1', review_cycle: 1, full_review_count: 1, active_pr: '"#999"' }
        throw new Error('STATE_CONFLICT: Failed to write durable state to Issue')
      },
      listComments: async () => comments,
      postComment: async (body: string) => {
        const posted = { id: 'result-concurrent', body }
        comments.push(posted)
        return posted
      },
    })
    await expect(coordinator.integrateResult({
      resultBody,
      projectState: () => ({ ...state, state: 'AWAITING_REVIEW_1', active_pr: '"#186"', current_head: FULL_RESULT_HEAD }),
    })).rejects.toThrow('STATE_CONFLICT: incompatible concurrent authority')
  })

  it('rejects competing HANDOFF', async () => {
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0 }
    const comments = [
      { id: '1', body: '## HANDOFF\n\n**Task / Issue:** #184\n**Phase:** A\nFirst' },
      { id: '2', body: '## HANDOFF\n\n**Task / Issue:** #185\n**Phase:** B\nSecond' },
    ]
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => { state = next; return next },
      listComments: async () => comments,
      postComment: async (body: string) => ({ id: '3', body }),
    })
    await expect(coordinator.integrateHandoff({ handoffBody })).rejects.toThrow('competing HANDOFF')
  })

  it('ignores superseded historical HANDOFF when selecting active authority', async () => {
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0 }
    const comments = [
      {
        id: 'old',
        body: '## HANDOFF\n\n[superseded] not authorized\n\n**Task / Issue:** #184\n**Phase:** Old\nHistorical',
      },
      { id: 'active', body: handoffBody },
    ]
    expect(isExplicitlyNonAuthoritativeRoleBody(comments[0].body)).toBe(true)
    expect(selectActiveRoleComments(comments, 'HANDOFF')).toHaveLength(1)
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => { state = structuredClone(next); return state },
      listComments: async () => comments,
      postComment: async () => { throw new Error('should reuse active HANDOFF') },
    })
    const result = await coordinator.integrateHandoff({ handoffBody })
    expect(result.outcome).toBe('DISPATCHED')
    expect((result.comment as { id: string }).id).toBe('active')
    expect(state.latest_handoff_comment_id).toBe('active')
  })

  it('binds task/phase/PR/head lineage when matching comments', () => {
    const identity = normalizeTransitionIdentity(resultBody, { role: 'RESULT' })
    expect(findMatchingComments(
      [{ id: 'right', body: resultBody }],
      identity,
      { activeOnly: true, bindings: { prNumber: '999', headSha: FULL_RESULT_HEAD, taskId: '184' } },
    )).toHaveLength(0)
    expect(findMatchingComments(
      [{ id: 'right', body: resultBody }],
      identity,
      { activeOnly: true, bindings: { prNumber: '186', headSha: FULL_RESULT_HEAD, taskId: '184' } },
    ).map((comment: any) => comment.id)).toEqual(['right'])
  })

  it('rejects untrusted author matches as non-authoritative', () => {
    const identity = normalizeTransitionIdentity(resultBody, { role: 'RESULT' })
    const trust = resolveProductionCommentTrust({
      // Safe only at the test boundary: partial fixture → unknown → ProcessEnv.
      env: {
        NODE_ENV: process.env.NODE_ENV ?? 'test',
        PAYLOAD_SECRET: process.env.PAYLOAD_SECRET ?? 'test',
        BEMOAT_MC_TRUSTED_AUTHORS: 'boat1994',
      } as unknown as NodeJS.ProcessEnv,
    })
    expect(trust).toMatchObject({
      trustedAuthors: ['boat1994'],
      requireTrustedAuthor: true,
    })
    expect(findMatchingComments(
      [{
        id: 'evil',
        body: resultBody,
        author: 'untrusted-bot',
        author_association: 'NONE',
      }],
      identity,
      { activeOnly: true, ...trust },
    )).toHaveLength(0)
    expect(findMatchingComments(
      [{
        id: 'ok',
        body: resultBody,
        author: 'boat1994',
        author_association: 'OWNER',
      }],
      identity,
      { activeOnly: true, ...trust },
    ).map((comment: any) => comment.id)).toEqual(['ok'])
  })

  it('coordinator production trust path does not reuse untrusted comments', async () => {
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0 }
    const comments: any[] = [{
      id: 'evil',
      body: handoffBody,
      author: 'attacker',
      author_association: 'NONE',
    }]
    const trust = resolveProductionCommentTrust({
      // Safe only at the test boundary: partial fixture → unknown → ProcessEnv.
      env: {
        NODE_ENV: process.env.NODE_ENV ?? 'test',
        PAYLOAD_SECRET: process.env.PAYLOAD_SECRET ?? 'test',
        BEMOAT_MC_TRUSTED_AUTHORS: 'boat1994',
      } as unknown as NodeJS.ProcessEnv,
    })
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => { state = structuredClone(next); return state },
      listComments: async () => comments,
      postComment: async (body: string) => {
        const posted = {
          id: 'trusted-new',
          body,
          author: 'boat1994',
          author_association: 'OWNER',
        }
        comments.push(posted)
        return posted
      },
      ...trust,
    })
    const result = await coordinator.integrateHandoff({ handoffBody })
    expect(result.outcome).toBe('DISPATCHED')
    expect((result.comment as { id: string }).id).toBe('trusted-new')
    expect(state.latest_handoff_comment_id).toBe('trusted-new')
  })

  it('ensures RESULT suppression before postconditions', async () => {
    let state: any = { state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 }
    const comments: any[] = []
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => { state = next; return next },
      listComments: async () => comments,
      postComment: async (body: string) => {
        const posted = { id: 'result-1', body }
        comments.push(posted)
        return posted
      },
    })
    await expect(coordinator.integrateResult({
      resultBody,
      projectState: () => ({ ...state, state: 'AWAITING_REVIEW_1' }),
      verifyPreconditions: async () => { throw new Error('preconditions incomplete') },
    })).rejects.toThrow('preconditions incomplete')
    expect(comments).toHaveLength(0)
  })

  it('preserves counters and last_reviewed_head during reconciliation', async () => {
    let state: any = {
      state: 'AWAITING_REVIEW_1', review_cycle: 1, full_review_count: 1,
      last_reviewed_head: FULL_SAMPLE_HEAD, active_pr: '#121', current_head: FULL_SAMPLE_HEAD,
    }
    const verdictBody = `## REVIEW_VERDICT

**Task / Issue:** #120
**Phase:** Reviewer
**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/121 · \`main\` · \`${FULL_SAMPLE_HEAD}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
`
    const comments = [{ id: 'verdict-1', body: verdictBody }]
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => { state = next; return next },
      listComments: async () => comments,
      postComment: async (body: string) => ({ id: 'new', body }),
    })
    const result = await coordinator.reconcileReviewVerdict({
      verdictBody,
      projectReview: () => ({
        state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        review_cycle: 1,
        full_review_count: 1,
        last_reviewed_head: FULL_SAMPLE_HEAD,
      }),
    })
    expect(result.outcome).toBe('RECONCILED')
    expect(state.review_cycle).toBe(1)
    expect(state.full_review_count).toBe(1)
    expect(state.last_reviewed_head).toBe(FULL_SAMPLE_HEAD)
  })

  it('integrates RESULT with exact identity', async () => {
    let state: any = { state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 }
    const comments: any[] = []
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => { state = structuredClone(next); return state },
      listComments: async () => comments,
      postComment: async (body: string) => {
        const posted = { id: 'result-1', body }
        comments.push(posted)
        return posted
      },
    })
    const result = await coordinator.integrateResult({
      resultBody,
      projectState: () => ({
        ...state,
        state: 'AWAITING_REVIEW_1',
        active_pr: '"#186"',
        current_head: FULL_RESULT_HEAD,
        review_cycle: 0,
        full_review_count: 0,
      }),
    })
    expect(result.outcome).toBe('DELIVERED')
    expect(state.state).toBe('AWAITING_REVIEW_1')
    expect(state.latest_result_comment_id).toBe('result-1')
    expect(normalizeTransitionIdentity(comments[0].body).contentHash)
      .toBe(normalizeTransitionIdentity(resultBody).contentHash)
  })

  it('reconciles REVIEW_VERDICT external evidence', async () => {
    let state: any = { state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0, last_reviewed_head: null }
    const verdictBody = sampleVerdict.replaceAll('abc1234', FULL_SAMPLE_HEAD)
    const comments = [{ id: 'v1', body: verdictBody }]
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => { state = next; return next },
      listComments: async () => comments,
      postComment: async (body: string) => ({ id: 'new', body }),
    })
    const result = await coordinator.reconcileReviewVerdict({
      verdictBody,
      projectReview: () => proposeReviewReconciliation({
        verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
        reviewedHead: FULL_SAMPLE_HEAD,
        reviewCycle: 0,
        fullReviewCount: 0,
      }),
    })
    expect(result.outcome).toBe('RECONCILED')
    expect(state.state).toBe('ELIGIBLE_FOR_FOUNDER_REVIEW')
  })

  it('verifies state postcondition exactly', () => {
    expect(() => verifyStatePostcondition(
      { state: 'IN_PROGRESS', review_cycle: 0 },
      { state: 'READY', review_cycle: 0 },
    )).toThrow('postcondition mismatch on state')
    expect(verifyStatePostcondition(
      { state: 'IN_PROGRESS', review_cycle: 1 },
      { state: 'IN_PROGRESS', review_cycle: 1 },
    )).toBe(true)
  })

  it('preserves child harness closures', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dispatchSource = readFileSync(
      join(process.cwd(), 'scripts/mission-control-dispatch.mjs'),
      'utf8',
    )
    const dispatchWorkflowSource = readFileSync(
      join(process.cwd(), 'scripts/mission-control/workflows/dispatch.mjs'),
      'utf8',
    )
    const deliverySource = readFileSync(
      join(process.cwd(), 'scripts/mission-control/workflows/agent-delivery.mjs'),
      'utf8',
    )
    expect(hasExecutableBoundary(dispatchSource, {
      moduleSpecifier: './mission-control/workflows/dispatch.mjs',
      importedNames: ['executeDispatchWorkflow'],
      calledNames: ['executeDispatchWorkflow'],
      calledWithObjectNames: ['executeDispatchWorkflow'],
    })).toBe(true)
    expect(hasExecutableBoundary(dispatchWorkflowSource, {
      moduleSpecifier: '../../mission-control-reconcile.mjs',
      importedNames: [
        'dispatchFounderAuthorizedCorrection',
        'Coordinator',
        'resolveProductionCommentTrust',
      ],
      calledNames: [
        'dispatchFounderAuthorizedCorrection',
        'listLiveComments',
        'resolveProductionCommentTrust',
      ],
      constructedNames: ['Coordinator'],
    })).toBe(true)
    expect(dispatchSource).not.toContain('const comments = []')
    expect(deliverySource).toContain('listLiveComments')
    expect(deliverySource).toContain('parsePaginatedGhApiJson')
    expect(deliverySource).toContain('resolveProductionCommentTrust')
    expect(deliverySource).not.toContain('local-${')
    expect(deliverySource).not.toContain('`local-')
    expect(reconcileModule.Coordinator).toBeTruthy()
    expect(reconcileModule.normalizeTransitionIdentity).toBeTruthy()
    expect(reconcileModule.resolveProductionCommentTrust).toBeTruthy()
  })

  it('rejects comment-only dispatch boundary fixtures', () => {
    const commentOnlyRoot = `
      // import { executeDispatchWorkflow } from './mission-control/workflows/dispatch.mjs'
      // executeDispatchWorkflow({
    `
    const commentOnlyWorkflow = `
      // import { Coordinator, dispatchFounderAuthorizedCorrection, resolveProductionCommentTrust } from '../../mission-control-reconcile.mjs'
      // listLiveComments
      // new Coordinator(
    `

    expect(hasExecutableBoundary(commentOnlyRoot, {
      moduleSpecifier: './mission-control/workflows/dispatch.mjs',
      importedNames: ['executeDispatchWorkflow'],
      calledNames: ['executeDispatchWorkflow'],
      calledWithObjectNames: ['executeDispatchWorkflow'],
    })).toBe(false)
    expect(hasExecutableBoundary(commentOnlyWorkflow, {
      moduleSpecifier: '../../mission-control-reconcile.mjs',
      importedNames: [
        'dispatchFounderAuthorizedCorrection',
        'Coordinator',
        'resolveProductionCommentTrust',
      ],
      calledNames: [
        'dispatchFounderAuthorizedCorrection',
        'listLiveComments',
        'resolveProductionCommentTrust',
      ],
      constructedNames: ['Coordinator'],
    })).toBe(false)
  })

  it('requires #182 and #184 merged/green and fresh child-sync HANDOFF', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    expect(CHILD_SYNC_GATE_ISSUES).toEqual([182, 184])
    expect(CHILD_SYNC_GATE_REQUIREMENTS).toMatchObject({
      requiresLiveChildStateReconstruction: true,
      requiresFreshChildSyncHandoff: true,
    })
    expect(() => assertChildSyncGateReady()).toThrow('child-sync gate blocked')
    expect(assertChildSyncGateReady({
      issues182Merged: true,
      issues184Merged: true,
      liveChildReconstructed: true,
      freshHandoffIssued: true,
    })).toBe(true)
    expect(resolveChildSyncCommandGate({ enforce: false })).toMatchObject({ enforced: false, allowed: true })
    expect(() => resolveChildSyncCommandGate({ enforce: true })).toThrow('child-sync gate blocked')

    const syncSource = readFileSync(join(process.cwd(), 'scripts/sync-boilerplate.mjs'), 'utf8')
    expect(syncSource).toContain('enforceMcTransitionChildSyncGate')
    expect(syncSource).toContain('resolveChildSyncCommandGate')
    expect(syncSource).toContain('--skip-mc-transition-gate')
    expect(syncSource).toContain('BEMOAT_SKIP_MC_TRANSITION_CHILD_SYNC_GATE')

    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    // Child-owned contract: bemoat:boilerplate:sync is mandatory; legacy
    // boilerplate:sync is starter-only and validated only when present.
    expect(packageJson.scripts['bemoat:boilerplate:sync']).toBe('node scripts/sync-boilerplate.mjs')
    if (packageJson.scripts['boilerplate:sync'] !== undefined) {
      expect(packageJson.scripts['boilerplate:sync']).toBe('node scripts/sync-boilerplate.mjs')
    }

    const { enforceMcTransitionChildSyncGate } = await import('../../scripts/sync-boilerplate.mjs') as {
      enforceMcTransitionChildSyncGate: (input?: { argv?: string[], env?: NodeJS.ProcessEnv }) => Record<string, unknown>
    }
    // Default invocation (documented pnpm scripts) must enforce the gate.
    // Safe only at the test boundary: partial fixture → unknown → ProcessEnv.
    expect(() => enforceMcTransitionChildSyncGate({
      argv: [],
      env: {} as unknown as NodeJS.ProcessEnv,
    })).toThrow('child-sync gate blocked')
    expect(() => enforceMcTransitionChildSyncGate({
      argv: ['--harness-only'],
      env: {} as unknown as NodeJS.ProcessEnv,
    })).toThrow('child-sync gate blocked')
    expect(enforceMcTransitionChildSyncGate({
      argv: [],
      env: {
        NODE_ENV: process.env.NODE_ENV ?? 'test',
        PAYLOAD_SECRET: process.env.PAYLOAD_SECRET ?? 'test',
        BEMOAT_CHILD_SYNC_182_MERGED: '1',
        BEMOAT_CHILD_SYNC_184_MERGED: '1',
        BEMOAT_CHILD_SYNC_LIVE_RECONSTRUCTED: '1',
        BEMOAT_CHILD_SYNC_FRESH_HANDOFF: '1',
      } as unknown as NodeJS.ProcessEnv,
    })).toMatchObject({ enforced: true, allowed: true })
    // Explicit documented bypass only.
    expect(enforceMcTransitionChildSyncGate({
      argv: ['--skip-mc-transition-gate'],
      env: {} as unknown as NodeJS.ProcessEnv,
    })).toMatchObject({ enforced: false, allowed: true })
    expect(enforceMcTransitionChildSyncGate({
      argv: [],
      env: {
        BEMOAT_SKIP_MC_TRANSITION_CHILD_SYNC_GATE: '1',
        NODE_ENV: process.env.NODE_ENV ?? 'test',
        PAYLOAD_SECRET: process.env.PAYLOAD_SECRET ?? 'test',
      } as unknown as NodeJS.ProcessEnv,
    })).toMatchObject({ enforced: false, allowed: true })
  })

  it('parses paginated live comment payloads and normalizes ids', () => {
    const parsed = parsePaginatedGhApiJson('[{"id":1,"body":"a"}][{"id":2,"body":"b"}]')
    expect(normalizeIssueComments(parsed).map((comment: any) => comment.id)).toEqual([1, 2])
  })

  it('rejects distinct full heads that collide at the seven-character prefix', () => {
    const liveHead = `abcdef0${'1'.repeat(33)}`
    const conflictingHead = `abcdef0${'2'.repeat(33)}`
    const collisionBody = resultBody.replace(FULL_RESULT_HEAD, conflictingHead)
    const identity = normalizeTransitionIdentity(collisionBody, { role: 'RESULT' })

    expect(findMatchingComments(
      [{ id: 'collision', body: collisionBody }],
      identity,
      { activeOnly: true, bindings: { headSha: liveHead } },
    )).toHaveLength(0)

    expect(classifyDeliveryLag(
      { state: 'IN_PROGRESS', active_pr: null, current_head: null },
      { number: '186', headRefOid: liveHead },
      { exactHeadVerified: true },
      { parsed: { headSha: conflictingHead, prNumber: '186' } },
    )).toMatchObject({
      kind: 'STATE_CONFLICT',
      reason: 'RESULT head does not match live PR head',
    })
  })

  it('does not treat equal abbreviated heads as authoritative without a full SHA', () => {
    const shortHead = 'abcdef0'
    const abbreviatedBody = resultBody.replace(FULL_RESULT_HEAD, shortHead)
    const identity = normalizeTransitionIdentity(abbreviatedBody, { role: 'RESULT' })

    expect(findMatchingComments(
      [{ id: 'short', body: abbreviatedBody, author: 'boat1994', author_association: 'OWNER' }],
      identity,
      { activeOnly: true, bindings: { headSha: shortHead } },
    )).toHaveLength(0)
  })
})

describe('Issue #255 atomic role-transition regressions', () => {
  const issue255ResultBody = `## RESULT

### Task log
- Timestamp: 2026-08-02T22:00:00+07:00
- Task / Issue: #255
- Phase: Dev (implementation)
- Executing role: Dev / Builder

**State:** branch \`fix/255-atomic-role-transitions\` · base \`main\` · head \`255head\`
**PR:** https://github.com/boat1994/bemoat-web-starter/pull/300
**Next:** Reviewer
`

  it('Issue #255: one canonical role comment repairs stale latest_* metadata and rejects caller-supplied lineage', async () => {
    let state: any = {
      state: 'IN_PROGRESS',
      review_cycle: 0,
      full_review_count: 0,
      latest_handoff_comment_id: 'handoff-255',
      latest_result_comment_id: 'stale-result-255',
      latest_review_verdict_comment_id: 'verdict-255',
      latest_transition_identity: 'stale-transition-255',
    }
    const comments = [{ id: 'canonical-result-255', body: issue255ResultBody }]
    const coordinator = new CoordinatorClass({
      readState: async () => structuredClone(state),
      writeState: async (next: any, expected: any) => {
        expect(expected).toMatchObject({ latest_result_comment_id: 'stale-result-255' })
        state = structuredClone(next)
        return structuredClone(state)
      },
      listComments: async () => comments,
      postComment: async () => { throw new Error('canonical RESULT should be reused') },
    })

    const result = await coordinator.integrateResult({
      resultBody: issue255ResultBody,
      projectState: () => ({
        ...state,
        state: 'AWAITING_REVIEW_1',
        active_pr: '#300',
        current_head: '255head',
        latest_handoff_comment_id: 'caller-forged-handoff',
        latest_result_comment_id: 'caller-forged-result',
        latest_review_verdict_comment_id: 'caller-forged-verdict',
        latest_transition_identity: 'caller-forged-transition',
      }),
    })

    expect(result.classification).toBe('REPAIRABLE_DRIFT')
    expect(state).toMatchObject({
      state: 'AWAITING_REVIEW_1',
      latest_handoff_comment_id: 'handoff-255',
      latest_result_comment_id: 'canonical-result-255',
      latest_review_verdict_comment_id: 'verdict-255',
      latest_transition_identity: JSON.stringify(normalizeTransitionIdentity(issue255ResultBody)),
    })
  })

  it('Issue #255: duplicate or competing active role comments fail closed as STATE_CONFLICT', async () => {
    const competing = issue255ResultBody.replace('Phase: Dev (implementation)', 'Phase: Correction 1')
    let state: any = { state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 }
    const comments = [
      { id: 'canonical-result-255', body: issue255ResultBody },
      { id: 'competing-result-255', body: competing },
    ]
    const coordinator = new CoordinatorClass({
      readState: async () => state,
      writeState: async (next: any) => { state = structuredClone(next); return state },
      listComments: async () => comments,
      postComment: async () => { throw new Error('competing role comments must fail closed') },
    })

    await expect(coordinator.integrateResult({ resultBody: issue255ResultBody }))
      .rejects.toThrow(/STATE_CONFLICT: competing role comments/)
  })

  it('Issue #255: timeout after role-comment POST is idempotent on retry', async () => {
    let state: any = { state: 'READY', review_cycle: 0, full_review_count: 0 }
    const comments: any[] = []
    let postAttempts = 0
    let failStateWrite = true
    const coordinator = new CoordinatorClass({
      readState: async () => structuredClone(state),
      writeState: async (next: any) => {
        if (failStateWrite) throw new Error('Issue body write timed out after POST')
        state = structuredClone(next)
        return structuredClone(state)
      },
      listComments: async () => comments,
      postComment: async (body: string) => {
        postAttempts += 1
        const comment = { id: 'handoff-timeout-255', body }
        comments.push(comment)
        throw new Error('role-comment POST timed out after publication')
      },
    })
    const handoffBody = `## HANDOFF

**Target:** Dev / Builder
**Task / Issue:** #255
**Phase:** P0 reliability implementation
`

    await expect(coordinator.integrateHandoff({ handoffBody })).rejects.toThrow(/Issue body write timed out/)
    failStateWrite = false
    const retry = await coordinator.integrateHandoff({ handoffBody })

    expect(retry.outcome).toBe('DISPATCHED')
    expect(postAttempts).toBe(1)
    expect(comments).toHaveLength(1)
    expect(state.latest_handoff_comment_id).toBe('handoff-timeout-255')
  })

  it('Issue #255: genuinely ambiguous durable authority returns STATE CONFLICT', () => {
    expect(classifyReconciliation({ authoritativeContradiction: true })).toMatchObject({
      outcome: 'STATE_CONFLICT',
    })
    expect(analyzeReconciliation({
      managedState: { state: 'IN_PROGRESS', current_head: 'old-head' },
      livePr: { number: '300', headRefOid: 'new-head' },
      stateConflictBlockers: [],
    }).classification).toMatchObject({ outcome: 'STATE_CONFLICT' })
  })

  it('Issue #255: Founder decline plus same-Issue Planning Correction 1 initialization preserves planning lineage', async () => {
    const planningBase = 'a'.repeat(40)
    let state: any = {
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 0,
      full_review_count: 0,
      approved_base: 'main',
      active_task_issue: '#255',
      active_pr: null,
      current_head: null,
      last_reviewed_head: null,
      workflow_mode: 'planning_no_pr',
      planning_authorization_base_sha: planningBase,
      latest_result_comment_id: 'result-255',
      latest_transition_identity: JSON.stringify(normalizeTransitionIdentity(issue255ResultBody)),
      founder_decision: {
        status: 'declined',
        authority: 'Founder',
        scope: 'implementation',
        task_issue: '#255',
        action: 'Require Planning Correction 1',
      },
    }
    const comments = [{ id: 'result-255', body: issue255ResultBody }]
    const handoffBody = `## HANDOFF

### Task log
- Timestamp: 2026-08-02T22:00:00+07:00
- Task / Issue: #255
- Phase: Planning Correction 1 Initialization
- Executing role: Mission Control

**Target:** Planning Investigator
**Objective:** Produce the bounded correction plan on the same Issue.
**Next:** Execute Planning Correction 1.
`
    const coordinator = new CoordinatorClass({
      readState: async () => structuredClone(state),
      writeState: async (next: any) => {
        state = structuredClone(next)
        return structuredClone(state)
      },
      listComments: async () => comments,
      postComment: async (body: string) => {
        const comment = { id: 'handoff-255-correction', body }
        comments.push(comment)
        return comment
      },
    })

    const result = await coordinator.integrateHandoff({
      handoffBody,
      planningAuthorizationBaseSha: planningBase,
      transitionState: (prior: any) => ({
        ...prior,
        state: 'BLOCKED_FOR_FOUNDER_DECISION',
        latest_result_comment_id: 'caller-forged-result',
        latest_transition_identity: 'caller-forged-transition',
        next_permitted_action: 'Execute Planning Correction 1.',
      }),
    })

    expect(result.outcome).toBe('DISPATCHED')
    expect(state).toMatchObject({
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 0,
      full_review_count: 0,
      active_pr: null,
      current_head: null,
      last_reviewed_head: null,
      workflow_mode: 'planning_no_pr',
      planning_authorization_base_sha: planningBase,
      latest_result_comment_id: 'result-255',
      latest_handoff_comment_id: 'handoff-255-correction',
      next_permitted_action: 'Execute Planning Correction 1.',
    })
    expect(state.latest_transition_identity).toBe(JSON.stringify(normalizeTransitionIdentity(handoffBody)))
    expect(state).not.toHaveProperty('state', 'PLANNING')
  })
})

describe('canonical RESULT current-transition selection', () => {
  const CURRENT_HEAD = '2'.repeat(40)
  const HISTORICAL_HEAD_ONE = '3'.repeat(40)
  const HISTORICAL_HEAD_TWO = '4'.repeat(40)

  function resultBody({ phase, head, pr = '366', summary = 'RESULT evidence' }: {
    phase: string
    head: string
    pr?: string
    summary?: string
  }) {
    return `## RESULT

### Task log
- Timestamp: 2026-08-23T12:00:00Z
- Task / Issue: #333
- Phase: ${phase}
- Executing role: Dev / Builder

**State:** branch \`refactor/333-wave-2-pure-domain\` · base \`main\` · head \`${head}\`
**PR:** https://github.com/boat1994/bemoat-web-starter/pull/${pr}
**Summary:** ${summary}
`
  }

  it('ignores historical RESULT comments when resolving a new bound current delivery', async () => {
    const currentBody = resultBody({ phase: 'Dev (synchronization)', head: CURRENT_HEAD })
    const comments = [
      { id: 'historical-one', body: resultBody({ phase: 'Dev (implementation)', head: HISTORICAL_HEAD_ONE }) },
      { id: 'historical-two', body: resultBody({ phase: 'Dev (correction)', head: HISTORICAL_HEAD_TWO, pr: '339' }) },
    ]
    const { identity, options } = buildTransitionMatchOptions({
      roleBody: currentBody,
      role: 'RESULT',
      verifiedBase: 'main',
      verifiedHead: CURRENT_HEAD,
    })
    let postCount = 0

    const result = await resolveRoleComment({
      roleBody: currentBody,
      role: 'RESULT',
      identity,
      options,
      listComments: async () => comments,
      postComment: async (body: string) => {
        postCount += 1
        return { id: 'current-result', body }
      },
    })

    expect(result).toMatchObject({ created: true, comment: { id: 'current-result' } })
    expect(postCount).toBe(1)
  })

  it('fails closed when multiple RESULT comments share current task/PR/base/head evidence', async () => {
    const currentBody = resultBody({ phase: 'Dev (synchronization)', head: CURRENT_HEAD })
    const competingBody = resultBody({
      phase: 'Dev (synchronization)',
      head: CURRENT_HEAD,
      summary: 'competing current RESULT evidence',
    })
    const comments = [
      { id: 'current-one', body: currentBody },
      { id: 'current-two', body: competingBody },
    ]
    const { identity, options } = buildTransitionMatchOptions({
      roleBody: currentBody,
      role: 'RESULT',
      verifiedBase: 'main',
      verifiedHead: CURRENT_HEAD,
    })

    await expect(resolveRoleComment({
      roleBody: currentBody,
      role: 'RESULT',
      identity,
      options,
      listComments: async () => comments,
      postComment: async () => { throw new Error('competing current RESULT must not post') },
    })).rejects.toThrow(/STATE_CONFLICT: competing role comments/)
  })
})
