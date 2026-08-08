import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- runtime .mjs boundary */
import * as reconcileModule from '../../scripts/mission-control-reconcile.mjs'

import {
  isBlockerMaterial,
  isTransitionProductive,
  isFullReconstructionPermitted,
  isDurableRoleCommentJustified,
  requiresDeltaReview,
  isFounderDispatchHandoffAuthority,
  limitTransitions,
} from '../../scripts/mission-control/domain/productive-policy.mjs'

const { Coordinator, dispatchFounderAuthorizedCorrection } = reconcileModule as unknown as Record<string, any>

const REVIEWED_HEAD = 'a'.repeat(40)
const CHANGED_HEAD = 'b'.repeat(40)

const RESULT_BODY = `## RESULT

### Task log
- Task / Issue: #292
- Phase: Dev (correction)
`

function verdictBody(head: string) {
  return `## REVIEW_VERDICT

### Task log
- Task / Issue: #292
- Phase: Reviewer

**PR / base / head:** PR #292 · \`main\` · \`${head}\`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
`
}

function createCoordinatorFixture(
  initialState: Record<string, unknown>,
  {
    comments: initialComments = [],
    verifiedHead,
    verifiedBase,
  }: {
    comments?: Array<Record<string, unknown>>
    verifiedHead?: string
    verifiedBase?: string
  } = {},
) {
  let state = structuredClone(initialState)
  const comments = initialComments.map((comment) => structuredClone(comment))
  let postCalls = 0
  let writeCalls = 0
  const coordinator = new Coordinator({
    readState: async () => structuredClone(state),
    writeState: async (next: Record<string, unknown>) => {
      writeCalls += 1
      state = structuredClone(next)
      return structuredClone(state)
    },
    listComments: async () => comments.map((comment) => structuredClone(comment)),
    postComment: async (body: string) => {
      postCalls += 1
      const comment = { id: `runtime-${postCalls}`, body }
      comments.push(comment)
      return comment
    },
    verifiedHead,
    verifiedBase,
  })

  return {
    coordinator,
    comments,
    get state() {
      return state
    },
    get postCalls() {
      return postCalls
    },
    get writeCalls() {
      return writeCalls
    },
  }
}

describe('Productive-Only Mission Control gate correction', () => {
  it('1. A Founder bounded execution instruction proceeds directly as HANDOFF and dispatch authority.', () => {
    expect(isFounderDispatchHandoffAuthority({
      isFounderIssued: true,
      isBoundedExecutionInstruction: true
    })).toBe(true)
  })

  it('2. Mission Control does not create prepare HANDOFF.', () => {
    expect(isDurableRoleCommentJustified({ action: 'prepare_HANDOFF' })).toBe(false)
  })

  it('3. Mission Control does not create review HANDOFF.', () => {
    expect(isDurableRoleCommentJustified({ action: 'review_HANDOFF' })).toBe(false)
  })

  it('4. Mission Control does not create correct HANDOFF for wording-only defects.', () => {
    expect(isDurableRoleCommentJustified({ action: 'correct_HANDOFF', isWordingOnly: true })).toBe(false)
  })

  it('5. AUTHORIZATION versus HANDOFF naming alone does not block execution.', () => {
    expect(isBlockerMaterial('NAMING_MISMATCH')).toBe(false)
  })

  it('6. A missing repeated test path does not block when the approved plan resolves it.', () => {
    expect(isBlockerMaterial('MISSING_REPEATED_TEST_PATH')).toBe(false)
  })

  it('7. Metadata-only correction with unchanged PR head preserves prior semantic review.', () => {
    const correction = { isMetadataOnly: true }
    const context = { hasUnchangedPrHead: true }
    expect(requiresDeltaReview(correction, context)).toBe(true)
  })

  it('8. Metadata-only correction requires delta verification, not full reconstruction.', () => {
    const context = { isMetadataOnly: true, hasUnchangedPrHead: true }
    expect(isFullReconstructionPermitted(context)).toBe(false)
  })

  it('9. A concrete exact-head mismatch still blocks.', () => {
    expect(isBlockerMaterial('PR_HEAD_DRIFT')).toBe(true)
  })

  it('10. A protected-base material conflict still blocks.', () => {
    expect(isBlockerMaterial('PROTECTED_BASE_DRIFT')).toBe(true)
  })

  it('11. Missing exact-head CI still blocks before merge.', () => {
    expect(isBlockerMaterial('MISSING_REQUIRED_CI')).toBe(true)
  })

  it('12. Scope expansion into another slice still blocks.', () => {
    expect(isBlockerMaterial('MATERIAL_SCOPE_EXPANSION')).toBe(true)
  })

  it('13. Production, migration, retained-data, or irreversible actions still require Founder authority.', () => {
    expect(isBlockerMaterial('MIGRATION_REQUIRED')).toBe(true)
    expect(isBlockerMaterial('DELETION_REQUIRED')).toBe(true)
    expect(isBlockerMaterial('IRREVERSIBLE_ACTION')).toBe(true)
  })

  it('14. Repeated non-productive role-comment creation is rejected or suppressed.', () => {
    expect(isDurableRoleCommentJustified({ action: 'PROGRESS_UPDATE' })).toBe(false)
  })

  it('15. The canonical transition-count limit is enforced.', () => {
    expect(limitTransitions({
      handoffCount: 1,
      initialResultCount: 1,
      reviewVerdictCount: 1,
      blockingReviewCount: 1,
      correctionResultCount: 1,
      founderDecisionCount: 1,
      terminalMergeResultCount: 1
    })).toBe(true)

    expect(limitTransitions({
      handoffCount: 2, // invalid
      initialResultCount: 1,
      reviewVerdictCount: 1,
      blockingReviewCount: 1,
      correctionResultCount: 1,
      founderDecisionCount: 1,
      terminalMergeResultCount: 1
    })).toBe(false)
  })

  it('16. A proposed extra transition with no material-risk reason is rejected.', () => {
    expect(isTransitionProductive({
      changesAuthoritativeState: false,
      producesEvidence: false,
      resolvesMaterialBlocker: false,
      authorizesIrreversibleTransition: false
    })).toBe(false)
  })

  it('17. A correction RESULT may proceed without a new HANDOFF when scope is unchanged.', () => {
    // If scope is unchanged, no new durable HANDOFF is justified
    expect(isDurableRoleCommentJustified({ action: 'NEW_HANDOFF_FOR_CORRECTION', isScopeChanged: false })).toBe(false)
  })

  it('18. A materially changed correction still returns to Founder authority.', () => {
    expect(isBlockerMaterial('MATERIAL_SCOPE_EXPANSION')).toBe(true)
  })

  it('19. Coordinator rejects a non-productive transition before posting durable evidence.', async () => {
    const fixture = createCoordinatorFixture({ state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 })

    await expect(fixture.coordinator.integrateResult({
      resultBody: RESULT_BODY,
      projectState: (prior: Record<string, unknown>) => prior,
      policy: {
        transition: {
          changesAuthoritativeState: false,
          producesEvidence: false,
          resolvesMaterialBlocker: false,
          authorizesIrreversibleTransition: false,
        },
      },
    })).rejects.toThrow(/non-productive/i)

    expect(fixture.postCalls).toBe(0)
    expect(fixture.writeCalls).toBe(0)
  })

  it('20. Coordinator accepts a productive evidence transition.', async () => {
    const fixture = createCoordinatorFixture({ state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 })

    const result = await fixture.coordinator.integrateResult({
      resultBody: RESULT_BODY,
      projectState: (prior: Record<string, unknown>) => ({
        ...prior,
        state: 'AWAITING_REVIEW_1',
      }),
      policy: {
        transition: {
          changesAuthoritativeState: true,
          producesEvidence: true,
        },
      },
    })

    expect(result.outcome).toBe('DELIVERED')
    expect(result.policy).toMatchObject({ productive: true })
    expect(fixture.postCalls).toBe(1)
    expect(fixture.writeCalls).toBe(1)
  })

  it('21. Coordinator preserves material blocker gates instead of treating them as productive evidence.', async () => {
    const fixture = createCoordinatorFixture({ state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 })

    await expect(fixture.coordinator.integrateResult({
      resultBody: RESULT_BODY,
      projectState: (prior: Record<string, unknown>) => ({ ...prior, state: 'AWAITING_REVIEW_1' }),
      policy: {
        materialBlockerReason: 'PR_HEAD_DRIFT',
        transition: {
          changesAuthoritativeState: true,
          producesEvidence: true,
          resolvesMaterialBlocker: false,
        },
      },
    })).rejects.toThrow(/PR_HEAD_DRIFT|material blocker/i)

    expect(fixture.postCalls).toBe(0)
    expect(fixture.writeCalls).toBe(0)
  })

  it('22. Founder bounded AUTHORIZATION dispatch resolves directly to one HANDOFF.', async () => {
    const fixture = createCoordinatorFixture({ state: 'READY', review_cycle: 0, full_review_count: 0 })

    const result = await fixture.coordinator.integrateHandoff({
      handoffBody: '## AUTHORIZATION\n\n**Task / Issue:** #292\n**Phase:** Dev (implementation)\n**Target:** bounded correction',
      policy: {
        founderDispatch: {
          isFounderIssued: true,
          isBoundedExecutionInstruction: true,
        },
        transition: {
          changesAuthoritativeState: true,
          producesEvidence: true,
        },
      },
    })

    expect(result.outcome).toBe('DISPATCHED')
    expect(result.policy).toMatchObject({
      dispatchMode: 'FOUNDER_BOUNDED_HANDOFF',
      requiresPreparation: false,
      requiresReadinessReview: false,
      requiresSecondAuthorization: false,
    })
    expect(fixture.comments).toHaveLength(1)
    expect(fixture.writeCalls).toBe(1)
  })

  it('23. Founder correction dispatch still rejects a non-Founder authorization before reservation.', async () => {
    let reservations = 0
    let posts = 0
    let state: Record<string, unknown> = {
      state: 'FOUNDER_AUTHORIZED_CORRECTION',
      review_cycle: 3,
      full_review_count: 1,
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      founder_correction_authorization: {
        schema_version: 2,
        authorization_id: 'attacker-authorization',
        status: 'authorized',
        authority: 'Attacker',
        scope: 'correction',
        for_review_number: 3,
        reviewed_head: REVIEWED_HEAD,
        finding_ids: ['finding-1'],
        action: 'bounded correction',
        authorized_at: '2026-08-06T00:00:00Z',
      },
    }

    await expect(dispatchFounderAuthorizedCorrection({
      readState: async () => structuredClone(state),
      writeState: async (next: Record<string, unknown>) => { state = structuredClone(next); return state },
      reserveAuthorization: async () => { reservations += 1; return { reservation_id: 'reservation-1' } },
      releaseAuthorization: async (): Promise<void> => undefined,
      postHandoff: async () => { posts += 1; return { id: 'handoff-1' } },
      retractHandoff: async (): Promise<void> => undefined,
      handoffBody: '## AUTHORIZATION\n\n**Founder correction authorization:** `attacker-authorization`',
    })).rejects.toThrow(/Founder/i)

    expect(reservations).toBe(0)
    expect(posts).toBe(0)
  })

  it('24. Metadata-only unchanged-head correction selects delta verification and preserves semantic evidence.', async () => {
    const body = verdictBody(REVIEWED_HEAD)
    const initialState = {
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      active_pr: '#292',
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      open_blockers: ['finding-1'],
    }
    const fixture = createCoordinatorFixture(initialState, {
      comments: [{ id: 'verdict-1', body }],
      verifiedHead: REVIEWED_HEAD,
      verifiedBase: 'main',
    })

    const result = await fixture.coordinator.reconcileReviewVerdict({
      verdictBody: body,
      projectReview: (prior: Record<string, unknown>) => structuredClone(prior),
      policy: {
        correction: { isMetadataOnly: true },
        reviewType: 'delta',
      },
    })

    expect(result.policy).toMatchObject({
      verificationMode: 'delta',
      preserveSemanticEvidence: true,
    })
    expect(fixture.state).toMatchObject({
      state: initialState.state,
      review_cycle: initialState.review_cycle,
      full_review_count: initialState.full_review_count,
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      open_blockers: ['finding-1'],
    })
  })

  it('25. Metadata-only unchanged-head correction rejects semantic reconstruction.', async () => {
    const body = verdictBody(REVIEWED_HEAD)
    const fixture = createCoordinatorFixture({
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      active_pr: '#292',
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      open_blockers: ['finding-1'],
    }, {
      comments: [{ id: 'verdict-1', body }],
      verifiedHead: REVIEWED_HEAD,
      verifiedBase: 'main',
    })

    await expect(fixture.coordinator.reconcileReviewVerdict({
      verdictBody: body,
      projectReview: (prior: Record<string, unknown>) => ({ ...prior, state: 'STATE_CONFLICT' }),
      policy: {
        correction: { isMetadataOnly: true },
        reviewType: 'delta',
      },
    })).rejects.toThrow(/routing-only|semantic|metadata/i)

    expect(fixture.writeCalls).toBe(0)
  })

  it('26. A changed-head correction does not preserve old semantic review evidence.', async () => {
    const body = verdictBody(CHANGED_HEAD)
    const fixture = createCoordinatorFixture({
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      active_pr: '#292',
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      open_blockers: ['finding-1'],
    }, {
      comments: [{ id: 'verdict-2', body }],
      verifiedHead: CHANGED_HEAD,
      verifiedBase: 'main',
    })

    const result = await fixture.coordinator.reconcileReviewVerdict({
      verdictBody: body,
      projectReview: (prior: Record<string, unknown>) => ({
        ...prior,
        state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        current_head: CHANGED_HEAD,
        open_blockers: [] as string[],
      }),
      policy: {
        correction: { isMetadataOnly: true },
        reviewType: 'delta',
      },
    })

    expect(result.policy).toMatchObject({
      verificationMode: 'delta',
      preserveSemanticEvidence: false,
    })
    expect(fixture.state).toMatchObject({
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      current_head: CHANGED_HEAD,
      open_blockers: [],
    })
  })

  it('27. An extra transition without a recognized material-risk reason is rejected.', async () => {
    const fixture = createCoordinatorFixture({ state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 })

    await expect(fixture.coordinator.integrateResult({
      resultBody: RESULT_BODY,
      projectState: (prior: Record<string, unknown>) => ({ ...prior, state: 'AWAITING_REVIEW_1' }),
      policy: {
        transition: {
          changesAuthoritativeState: true,
          producesEvidence: true,
        },
        transitionHistory: {
          handoffCount: 2,
          initialResultCount: 1,
          reviewVerdictCount: 1,
          blockingReviewCount: 1,
          correctionResultCount: 1,
          founderDecisionCount: 1,
          terminalMergeResultCount: 1,
        },
      },
    })).rejects.toThrow(/transition budget|material-risk|productive/i)

    expect(fixture.postCalls).toBe(0)
    expect(fixture.writeCalls).toBe(0)
  })

  it('28. Coordinator derives productive facts from runtime evidence instead of trusting asserted flags.', () => {
    const prior = { state: 'IN_PROGRESS', review_cycle: 0, full_review_count: 0 }

    expect(() => new Coordinator({
      readState: async () => structuredClone(prior),
      writeState: async (next: Record<string, unknown>) => structuredClone(next),
      listComments: async (): Promise<Array<Record<string, unknown>>> => [],
      postComment: async () => ({ id: 'unused' }),
    }).authorizeTransition({
      prior,
      projected: prior,
      policy: {
        transition: {
          changesAuthoritativeState: true,
          producesEvidence: true,
        },
      },
    })).toThrow(/non-productive|not observed/i)
  })

  it('29. Normal Coordinator review rejects semantic mutation when unchanged-head evidence must be preserved.', async () => {
    const body = verdictBody(REVIEWED_HEAD)
    const fixture = createCoordinatorFixture({
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      active_pr: '#292',
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      open_blockers: ['finding-1'],
    }, {
      comments: [{ id: 'verdict-3', body }],
      verifiedHead: REVIEWED_HEAD,
      verifiedBase: 'main',
    })

    await expect(fixture.coordinator.integrateReviewVerdict({
      verdictBody: body,
      projectState: (prior: Record<string, unknown>) => ({
        ...prior,
        state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        open_blockers: [] as string[],
      }),
      policy: {
        correction: { isMetadataOnly: true },
        reviewType: 'delta',
      },
    })).rejects.toThrow(/routing-only|semantic|metadata/i)

    expect(fixture.writeCalls).toBe(0)
  })

  it('30. Coordinator validates unchanged-head semantic preservation before posting a new verdict comment.', async () => {
    const body = verdictBody(REVIEWED_HEAD)
    const fixture = createCoordinatorFixture({
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      active_pr: '#292',
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
      open_blockers: ['finding-1'],
    }, {
      verifiedHead: REVIEWED_HEAD,
      verifiedBase: 'main',
    })

    await expect(fixture.coordinator.integrateReviewVerdict({
      verdictBody: body,
      projectState: (prior: Record<string, unknown>) => ({
        ...prior,
        state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
        open_blockers: [] as string[],
      }),
      policy: {
        correction: { isMetadataOnly: true },
        reviewType: 'delta',
      },
    })).rejects.toThrow(/routing-only|semantic|metadata/i)

    expect(fixture.postCalls).toBe(0)
    expect(fixture.writeCalls).toBe(0)
  })

  it('31. Changed-head delta review rejects a projection that retains the prior reviewed head.', () => {
    const prior = {
      state: 'AWAITING_REVIEW_2',
      review_cycle: 1,
      full_review_count: 1,
      current_head: REVIEWED_HEAD,
      last_reviewed_head: REVIEWED_HEAD,
    }
    const coordinator = new Coordinator({
      readState: async () => structuredClone(prior),
      writeState: async (next: Record<string, unknown>) => structuredClone(next),
      listComments: async (): Promise<Array<Record<string, unknown>>> => [],
      postComment: async () => ({ id: 'unused' }),
      verifiedHead: CHANGED_HEAD,
    })

    expect(() => coordinator.authorizeTransition({
      role: 'REVIEW_VERDICT',
      roleBody: verdictBody(CHANGED_HEAD),
      prior,
      projected: prior,
      policy: { reviewType: 'delta' },
    })).toThrow(/changed-head|prior semantic review evidence/i)
  })

  it('32. A material blocker recorded in the managed projection still blocks without a caller-side policy flag.', () => {
    const prior = {
      state: 'IN_PROGRESS',
      review_cycle: 0,
      full_review_count: 0,
      open_blockers: ['PR_HEAD_DRIFT'],
    }
    const coordinator = new Coordinator({
      readState: async () => structuredClone(prior),
      writeState: async (next: Record<string, unknown>) => structuredClone(next),
      listComments: async (): Promise<Array<Record<string, unknown>>> => [],
      postComment: async () => ({ id: 'unused' }),
    })

    expect(() => coordinator.authorizeTransition({
      role: 'RESULT',
      roleBody: RESULT_BODY,
      prior,
      policy: { materialBlockerReason: 'NAMING_MISMATCH' },
    })).toThrow(/PR_HEAD_DRIFT|material blocker/i)
  })

  it('33. A durable transition history over budget is rejected without a caller-side history override.', () => {
    const prior = {
      state: 'IN_PROGRESS',
      review_cycle: 0,
      full_review_count: 0,
      transition_history: {
        handoffCount: 2,
        initialResultCount: 1,
        reviewVerdictCount: 1,
        blockingReviewCount: 1,
        correctionResultCount: 1,
        founderDecisionCount: 1,
        terminalMergeResultCount: 1,
      },
    }
    const coordinator = new Coordinator({
      readState: async () => structuredClone(prior),
      writeState: async (next: Record<string, unknown>) => structuredClone(next),
      listComments: async (): Promise<Array<Record<string, unknown>>> => [],
      postComment: async () => ({ id: 'unused' }),
    })

    expect(() => coordinator.authorizeTransition({
      role: 'RESULT',
      roleBody: RESULT_BODY,
      prior,
      policy: {
        transitionHistory: {
          handoffCount: 1,
          initialResultCount: 1,
          reviewVerdictCount: 1,
          blockingReviewCount: 1,
          correctionResultCount: 1,
          founderDecisionCount: 1,
          terminalMergeResultCount: 1,
        },
      },
    })).toThrow(/transition budget/i)
  })
})
