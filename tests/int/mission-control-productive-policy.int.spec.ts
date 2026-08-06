import { describe, expect, it } from 'vitest'
import {
  isBlockerMaterial,
  isTransitionProductive,
  isFullReconstructionPermitted,
  isDurableRoleCommentJustified,
  requiresDeltaReview,
  isFounderDispatchHandoffAuthority,
  limitTransitions,
} from '../../scripts/mission-control/domain/productive-policy.mjs'

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
})
