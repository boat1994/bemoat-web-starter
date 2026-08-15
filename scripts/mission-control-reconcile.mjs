#!/usr/bin/env node
import { runProductionBoundedReconciliation } from './mission-control/workflows/reconcile.mjs'
import { buildTransitionMatchOptions } from './mission-control/transition-match-options.mjs'
import { authorizeCoordinatorTransition } from './mission-control/transition-authorization.mjs'
import { coordinatorOwnedRoutingProjection } from './mission-control/coordinator-projection.mjs'
import { reconcileReviewVerdict as reconcileReviewVerdictTransition } from './mission-control/review-verdict-transition.mjs'
import { integrateReviewVerdict as integrateReviewVerdictTransition } from './mission-control/review-verdict-integration-transition.mjs'
import { assertCompatibleSnapshot as assertCompatibleSnapshotTransition, integrateHandoff as integrateHandoffTransition, integrateResult as integrateResultTransition, resumeProjection as resumeProjectionTransition } from './mission-control/coordinator-transitions.mjs'

export { dispatchManagedTask } from './mission-control/managed-task-dispatch.mjs'
export { reconciliationFailureReason, runBoundedReconciliation } from './mission-control/bounded-reconciliation.mjs'
export { classifyReconciliation, migrateLegacyManagedState, migratePlanningOnlyTaskState, isSeparatePlanningImplementationAuthorization } from './mission-control/reconciliation-classification.mjs'
export { analyzeReconciliation, isGenuineStateConflict } from './mission-control/reconciliation-analysis.mjs'
export { classifyDeliveryLag, classifyReviewLag, proposeDeliveryReconciliation, proposeReviewReconciliation, resolveVerdictState } from './mission-control/reconciliation-proposals.mjs'
export { assertDeltaReviewHeadProjection, assertRoutingOnlyProjection, deriveTransitionFacts, derivesResolvedMaterialBlocker, hasUnchangedReviewedHead, policyObject, resolveEvidenceHead, sameValue } from './mission-control/transition-guards.mjs'
export { assertChildSyncGateReady, CHILD_SYNC_GATE_ISSUES, CHILD_SYNC_GATE_REQUIREMENTS, resolveChildSyncCommandGate, verifyStatePostcondition } from './mission-control/state-verification.mjs'
export { normalizeTransitionIdentity, parseCommentMarker, serializeTransitionIdentity, transitionIdentityMatches } from './mission-control/transition-identity.mjs'
export { isExplicitlyNonAuthoritativeRoleBody, normalizeAuthorityBase, normalizeAuthorityHead, parseLegacyReviewVerdictBinding, parseRoleCommentBody, selectActiveRoleComments, selectLiveReviewVerdictComment } from './mission-control/review-verdict-binding.mjs'
export { classifyTransition, DEFAULT_MC_TRUSTED_ASSOCIATIONS, findMatchingComments, normalizeIssueComments, parsePaginatedGhApiJson, recoverAmbiguousPost, resolveProductionCommentTrust, verifyPostedCommentReadback } from './mission-control/comment-evidence.ts'
export { resolveRoleComment } from './mission-control/comment-resolution.mjs'
export { coordinatorOwnedProjection, coordinatorOwnedRoutingProjection, routingDriftClassification } from './mission-control/coordinator-projection.mjs'
export { buildTransitionMatchOptions } from './mission-control/transition-match-options.mjs'
export { assertManagedActivePrForReviewVerdictReconciliation, assertReviewedHeadContainedInProtectedMain } from './mission-control/authority-head-validation.mjs'
export { buildCorrectionHandoffBinding, dispatchFounderAuthorizedCorrection } from './mission-control/founder-correction-dispatch.mjs'
export { findLatestRoleComment } from './mission-control/role-comment-selection.mjs'
export { classifyMergeDrift } from './mission-control/merge-drift-classification.mjs'
export { projectReviewVerdictState } from './mission-control/review-verdict-projection.ts'
export { founderMergeTransitionAuthorized } from './mission-control/founder-merge-transition-policy.mjs'

/**
 * Canonical comment-first transition coordinator. Role comments are immutable
 * evidence; managed state is the routing projection.
 */
export class Coordinator {
  constructor(transports) {
    this.readState = transports.readState
    this.writeState = transports.writeState
    this.listComments = transports.listComments
    this.postComment = transports.postComment
    this.readIssueBody = transports.readIssueBody ?? null
    this.trustedAuthors = transports.trustedAuthors ?? null
    this.requireTrustedAuthor = transports.requireTrustedAuthor ?? false
    this.trustedAssociations = transports.trustedAssociations ?? null
    this.verifiedHead = transports.verifiedHead ?? null
    this.verifiedBase = transports.verifiedBase ?? null
  }

  authorizeTransition({ role = null, roleBody = '', comment = null, prior = {}, projected = null, policy: rawPolicy = {} } = {}) {
    return authorizeCoordinatorTransition({
      role,
      roleBody,
      comment,
      prior,
      projected,
      policy: rawPolicy,
      verifiedHead: this.verifiedHead,
    })
  }

  _matchOptions(roleBody, role) {
    return buildTransitionMatchOptions({
      roleBody,
      role,
      trustedAuthors: this.trustedAuthors,
      requireTrustedAuthor: this.requireTrustedAuthor,
      trustedAssociations: this.trustedAssociations,
      verifiedHead: this.verifiedHead,
      verifiedBase: this.verifiedBase,
    })
  }

  async _resolveComment(roleBody, role) {
    const { identity, options } = this._matchOptions(roleBody, role)
    const { resolveRoleComment } = await import('./mission-control/comment-resolution.mjs')
    return resolveRoleComment({
      roleBody,
      role,
      identity,
      options,
      listComments: this.listComments,
      postComment: this.postComment,
    })
  }

  _coordinatorOwnedRouting({ identity, comment, role, updatedAt, updatedBy, base, prior, planningAuthorizationBaseSha, preserveState = false }) {
    return coordinatorOwnedRoutingProjection({
      identity,
      comment,
      role,
      updatedAt,
      updatedBy,
      base,
      prior,
      planningAuthorizationBaseSha,
      preserveState,
    })
  }

  async integrateHandoff({ handoffBody, transitionState, updatedAt, updatedBy, planningAuthorizationBaseSha, policy: rawPolicy = {} }) {
    return integrateHandoffTransition(this, {
      handoffBody, transitionState, updatedAt, updatedBy, planningAuthorizationBaseSha, policy: rawPolicy,
    })
  }

  async integrateResult({ resultBody, projectState, verifyPreconditions, updatedAt, updatedBy, policy: rawPolicy = {} }) {
    return integrateResultTransition(this, {
      resultBody, projectState, verifyPreconditions, updatedAt, updatedBy, policy: rawPolicy,
    })
  }

  async reconcileReviewVerdict({ verdictBody, projectReview, routingOnly = false, policy: rawPolicy = {} }) {
    return reconcileReviewVerdictTransition(this, {
      verdictBody,
      projectReview,
      routingOnly,
      policy: rawPolicy,
    })
  }

  async integrateReviewVerdict({ verdictBody, projectState, verifyPreconditions, updatedAt, updatedBy, policy: rawPolicy = {} }) {
    return integrateReviewVerdictTransition(this, {
      verdictBody, projectState, verifyPreconditions, updatedAt, updatedBy, policy: rawPolicy,
    })
  }

  async resumeProjection({ roleBody, role, projectState, planningAuthorizationBaseSha }) {
    return resumeProjectionTransition(this, { roleBody, role, projectState, planningAuthorizationBaseSha })
  }

  async assertCompatibleSnapshot(expectedState) {
    return assertCompatibleSnapshotTransition(this, expectedState)
  }
}

if (process.argv[1]?.endsWith('/mission-control-reconcile.mjs')) {
  runProductionBoundedReconciliation({
    createCoordinator: (transports) => new Coordinator(transports),
    getAnalyzeProgressTracking: () => import('./agent-issue.mjs'),
  }).catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
