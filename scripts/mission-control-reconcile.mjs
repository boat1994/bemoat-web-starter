#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.mjs'
import { parseCommandInvocation, resolveCommandIdentity } from './cli/command-invocation.mjs'
import { writeIssueBodyWithLease } from './mission-control-issue-body-cas.mjs'
import { parseMissionControlState, projectMissionControlStateBlock } from './mission-control-state.mjs'
import {
  parseCommentMarker,
  serializeTransitionIdentity,
} from './mission-control/transition-identity.mjs'
import {
  selectLiveReviewVerdictComment,
} from './mission-control/review-verdict-binding.mjs'
import { buildTransitionMatchOptions } from './mission-control/transition-match-options.mjs'
import {
  assertManagedActivePrForReviewVerdictReconciliation,
} from './mission-control/authority-head-validation.mjs'
export { dispatchManagedTask } from './mission-control/managed-task-dispatch.mjs'
import {
  reconciliationFailureReason,
  runBoundedReconciliation,
} from './mission-control/bounded-reconciliation.mjs'
export {
  reconciliationFailureReason,
  runBoundedReconciliation,
} from './mission-control/bounded-reconciliation.mjs'
export {
  classifyReconciliation,
  migrateLegacyManagedState,
  migratePlanningOnlyTaskState,
  isSeparatePlanningImplementationAuthorization,
} from './mission-control/reconciliation-classification.mjs'
export {
  analyzeReconciliation,
  isGenuineStateConflict,
} from './mission-control/reconciliation-analysis.mjs'
export {
  classifyDeliveryLag,
  classifyReviewLag,
  proposeDeliveryReconciliation,
  proposeReviewReconciliation,
  resolveVerdictState,
} from './mission-control/reconciliation-proposals.mjs'
import {
  detectUnaccountedReviewEvidence,
  isReviewRecoveryIncident,
} from './mission-control/domain/review-recovery.mjs'
import {
  classifyTransition,
  findMatchingComments,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  resolveProductionCommentTrust,
} from './mission-control/comment-evidence.mjs'
import { resolveRoleComment } from './mission-control/comment-resolution.mjs'
import {
  authorizeCoordinatorTransition,
} from './mission-control/transition-authorization.mjs'
import {
  coordinatorOwnedRoutingProjection,
  routingDriftClassification,
} from './mission-control/coordinator-projection.mjs'
import {
  assertDeltaReviewHeadProjection,
  assertRoutingOnlyProjection,
  deriveTransitionFacts,
  derivesResolvedMaterialBlocker,
  hasUnchangedReviewedHead,
  policyObject,
  resolveEvidenceHead,
  sameValue,
} from './mission-control/transition-guards.mjs'
import {
  verifyStatePostcondition,
} from './mission-control/state-verification.mjs'
import { reconcileReviewVerdict as reconcileReviewVerdictTransition } from './mission-control/review-verdict-transition.mjs'
export {
  assertDeltaReviewHeadProjection,
  assertRoutingOnlyProjection,
  deriveTransitionFacts,
  derivesResolvedMaterialBlocker,
  hasUnchangedReviewedHead,
  policyObject,
  resolveEvidenceHead,
  sameValue,
}
export {
  assertChildSyncGateReady,
  CHILD_SYNC_GATE_ISSUES,
  CHILD_SYNC_GATE_REQUIREMENTS,
  resolveChildSyncCommandGate,
  verifyStatePostcondition,
} from './mission-control/state-verification.mjs'

/**
 * Atomically consumes the one Founder authority granted after normal Review 3.
 * The durable authorization is bound to the concrete HANDOFF comment identifier;
 * a failed state write retracts that comment instead of allowing replay.
 */
export {
  normalizeTransitionIdentity,
  parseCommentMarker,
  serializeTransitionIdentity,
  transitionIdentityMatches,
}
from './mission-control/transition-identity.mjs'

export {
  isExplicitlyNonAuthoritativeRoleBody,
  normalizeAuthorityBase,
  normalizeAuthorityHead,
  parseLegacyReviewVerdictBinding,
  parseRoleCommentBody,
  selectActiveRoleComments,
  selectLiveReviewVerdictComment,
} from './mission-control/review-verdict-binding.mjs'

export {
  classifyTransition,
  DEFAULT_MC_TRUSTED_ASSOCIATIONS,
  findMatchingComments,
  normalizeIssueComments,
  parsePaginatedGhApiJson,
  recoverAmbiguousPost,
  resolveProductionCommentTrust,
  verifyPostedCommentReadback,
} from './mission-control/comment-evidence.mjs'
export { resolveRoleComment } from './mission-control/comment-resolution.mjs'
export {
  coordinatorOwnedProjection,
  coordinatorOwnedRoutingProjection,
  routingDriftClassification,
} from './mission-control/coordinator-projection.mjs'
export { buildTransitionMatchOptions } from './mission-control/transition-match-options.mjs'

/**
 * Canonical comment-first transition coordinator. Role comments are immutable
 * evidence; managed state is the routing projection.
 */
export class Coordinator {
  /**
   * @param {{
   *   readState: () => Promise<Record<string, unknown>>,
   *   writeState: (next: Record<string, unknown>, expected?: Record<string, unknown>) => Promise<Record<string, unknown>>,
   *   listComments: () => Promise<Array<{ body?: string, id?: string | number }>>,
   *   postComment: (body: string) => Promise<{ id?: string | number, body?: string }>,
   *   readIssueBody?: () => Promise<string>,
   *   trustedAuthors?: string[] | null,
   *   requireTrustedAuthor?: boolean,
   *   trustedAssociations?: string[] | null,
   *   verifiedHead?: string | null,
   *   verifiedBase?: string | null,
   * }} transports
   */
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

  /**
   * Authoritative Productive-Only gate for coordinator transitions. The
   * result is ephemeral policy evidence; durable state remains owned by the
   * existing projection and CAS transport.
   */
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

  /**
   * Comment-first READY -> IN_PROGRESS HANDOFF integration.
   */
  async integrateHandoff({ handoffBody, transitionState, updatedAt, updatedBy, planningAuthorizationBaseSha, policy: rawPolicy = {} }) {
    if (!/^## (?:HANDOFF|AUTHORIZATION)\s*$/m.test(handoffBody ?? '')) {
      throw new Error('integrateHandoff requires one HANDOFF or AUTHORIZATION role comment')
    }
    const original = await this.readState()
    const planningCorrectionInitialization = original?.state === 'BLOCKED_FOR_FOUNDER_DECISION' &&
      original?.workflow_mode === 'planning_no_pr' &&
      original?.review_cycle === 0 &&
      original?.full_review_count === 0 &&
      original?.active_pr == null &&
      original?.current_head == null &&
      original?.last_reviewed_head == null &&
      original?.founder_decision?.status === 'declined' &&
      /Planning Correction 1 Initialization/i.test(handoffBody)
    if (original?.state !== 'READY' && !planningCorrectionInitialization) {
      throw new Error(`integrateHandoff requires READY, received ${original?.state ?? 'missing state'}`)
    }
    this.authorizeTransition({ role: 'HANDOFF', roleBody: handoffBody, prior: original, policy: rawPolicy })
    const { identity, comment, recovered } = await this._resolveComment(handoffBody, 'HANDOFF')
    const callerProjection = typeof transitionState === 'function'
      ? transitionState(original)
      : (transitionState ?? structuredClone(original))
    const projected = this._coordinatorOwnedRouting({
      identity,
      comment,
      role: 'HANDOFF',
      updatedAt,
      updatedBy,
      base: callerProjection,
      prior: original,
      preserveState: planningCorrectionInitialization,
      planningAuthorizationBaseSha,
    })
    const policy = this.authorizeTransition({
      role: 'HANDOFF',
      roleBody: handoffBody,
      comment,
      prior: original,
      projected,
      policy: rawPolicy,
    })
    const written = await this.writeState(projected, original)
    verifyStatePostcondition(projected, written, [
      'state', 'latest_transition_identity', 'latest_handoff_comment_id', 'next_permitted_action',
    ])
    return {
      outcome: 'DISPATCHED',
      classification: routingDriftClassification({ prior: original, identity, comment, role: 'HANDOFF' }),
      state: written,
      comment,
      identity,
      recovered: Boolean(recovered),
      policy,
    }
  }

  /**
   * Comment-first RESULT integration with precondition gating.
   */
  async integrateResult({ resultBody, projectState, verifyPreconditions, updatedAt, updatedBy, policy: rawPolicy = {} }) {
    if (parseCommentMarker(resultBody) !== 'RESULT') {
      throw new Error('integrateResult requires a RESULT role comment')
    }
    if (typeof verifyPreconditions === 'function') {
      await verifyPreconditions()
    }
    const original = await this.readState()
    this.authorizeTransition({ role: 'RESULT', roleBody: resultBody, prior: original, policy: rawPolicy })
    const { identity, comment, created, recovered } = await this._resolveComment(resultBody, 'RESULT')
    const callerProjection = typeof projectState === 'function' ? projectState(original) : projectState
    const projected = this._coordinatorOwnedRouting({
      identity,
      comment,
      role: 'RESULT',
      updatedAt,
      updatedBy,
      base: callerProjection,
      prior: original,
    })
    const policy = this.authorizeTransition({
      role: 'RESULT',
      roleBody: resultBody,
      comment,
      prior: original,
      projected,
      policy: rawPolicy,
    })
    try {
      const written = await this.writeState(projected, original)
      verifyStatePostcondition(projected, written)
      return {
        outcome: 'DELIVERED',
        classification: routingDriftClassification({ prior: original, identity, comment, role: 'RESULT' }),
        state: written,
        comment,
        identity,
        created,
        recovered: Boolean(recovered),
        policy,
      }
    } catch (error) {
      if (!created) throw error
      let live
      try {
        live = await this.readState()
      } catch (readError) {
        const ambiguous = new Error(
          `AMBIGUOUS_RESULT: unable to verify Issue state after RESULT comment and state write: ${
            readError instanceof Error ? readError.message : String(readError)
          }`,
          { cause: error },
        )
        ambiguous.classification = 'AMBIGUOUS_RESULT'
        ambiguous.mutationPerformed = true
        if (typeof error?.legacyClassification === 'string') {
          ambiguous.legacyClassification = error.legacyClassification
        }
        throw ambiguous
      }
      if (sameValue(live, original)) {
        return {
          outcome: 'RECOVERABLE_ROUTING_DRIFT',
          classification: 'REPAIRABLE_DRIFT',
          state: original,
          comment,
          identity,
          recovered: Boolean(recovered),
          error: error instanceof Error ? error.message : String(error),
        }
      }
      if (sameValue(live, projected)) {
        verifyStatePostcondition(projected, live)
        return { outcome: 'DELIVERED', state: live, comment, identity, created }
      }
      throw new Error(
        `STATE_CONFLICT: incompatible concurrent authority after comment post: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Routing-only REVIEW_VERDICT projection preserving counters and heads.
   */
  async reconcileReviewVerdict({ verdictBody, projectReview, routingOnly = false, policy: rawPolicy = {} }) {
    return reconcileReviewVerdictTransition(this, {
      verdictBody,
      projectReview,
      routingOnly,
      policy: rawPolicy,
    })
  }

  /** Comment-first reviewer completion with a verified durable projection. */
  async integrateReviewVerdict({ verdictBody, projectState, verifyPreconditions, updatedAt, updatedBy, policy: rawPolicy = {} }) {
    if (parseCommentMarker(verdictBody) !== 'REVIEW_VERDICT') {
      throw new Error('integrateReviewVerdict requires a REVIEW_VERDICT role comment')
    }
    if (typeof verifyPreconditions === 'function') await verifyPreconditions()
    const original = await this.readState()
    const preflightPolicy = this.authorizeTransition({
      role: 'REVIEW_VERDICT',
      roleBody: verdictBody,
      prior: original,
      policy: rawPolicy,
    })

    const { identity: requestedIdentity, options: matchOptions } = this._matchOptions(verdictBody, 'REVIEW_VERDICT')
    const existingComments = await this.listComments()
    const existingMatches = findMatchingComments(existingComments, requestedIdentity, matchOptions)
    const replayCandidate = existingMatches.length === 1 &&
      original?.latest_transition_identity === serializeTransitionIdentity(requestedIdentity) &&
      String(original?.latest_review_verdict_comment_id ?? '') === String(existingMatches[0].id)

    const projectForComment = (candidateComment) => {
      const callerProjection = typeof projectState === 'function'
        ? projectState(original, candidateComment, requestedIdentity)
        : projectState
      return this._coordinatorOwnedRouting({
        identity: requestedIdentity,
        comment: candidateComment,
        role: 'REVIEW_VERDICT',
        base: callerProjection,
        prior: original,
        updatedAt,
        updatedBy: updatedBy ?? 'Reviewer',
      })
    }

    if (!replayCandidate) {
      const prospectiveComment = { id: '__prospective_review_verdict__', body: verdictBody }
      const prospectiveProjected = projectForComment(prospectiveComment)
      const prospectivePolicy = this.authorizeTransition({
        role: 'REVIEW_VERDICT',
        roleBody: verdictBody,
        comment: prospectiveComment,
        prior: original,
        projected: prospectiveProjected,
        policy: rawPolicy,
      })
      if (prospectivePolicy.preserveSemanticEvidence) {
        assertRoutingOnlyProjection({
          prior: original,
          projected: prospectiveProjected,
          reason: 'metadata-only REVIEW_VERDICT projection',
        })
      }
    }

    const { identity, comment, created, recovered } = await this._resolveComment(verdictBody, 'REVIEW_VERDICT')
    const serializedIdentity = serializeTransitionIdentity(identity)
    if (
      original?.latest_transition_identity === serializedIdentity &&
      String(original?.latest_review_verdict_comment_id ?? '') === String(comment.id)
    ) {
      return { outcome: 'REVIEWED', state: original, comment, identity, created: false, replayed: true, policy: preflightPolicy }
    }
    const projected = projectForComment(comment)
    const policy = this.authorizeTransition({
      role: 'REVIEW_VERDICT',
      roleBody: verdictBody,
      comment,
      prior: original,
      projected,
      policy: rawPolicy,
    })
    if (policy.preserveSemanticEvidence) {
      assertRoutingOnlyProjection({
        prior: original,
        projected,
        reason: 'metadata-only REVIEW_VERDICT projection',
      })
    }
    try {
      const written = await this.writeState(projected, original)
      verifyStatePostcondition(projected, written, [
        'state', 'review_cycle', 'full_review_count', 'current_head', 'last_reviewed_head',
        'latest_transition_identity', 'latest_review_verdict_comment_id', 'open_blockers',
      ])
      return {
        outcome: 'REVIEWED',
        classification: routingDriftClassification({ prior: original, identity, comment, role: 'REVIEW_VERDICT' }),
        state: written,
        comment,
        identity,
        created,
        recovered: Boolean(recovered),
        policy,
      }
    } catch (error) {
      if (!created) throw error
      let live
      try {
        live = await this.readState()
      } catch (readError) {
        const ambiguous = new Error(
          `AMBIGUOUS_RESULT: unable to verify Issue state after REVIEW_VERDICT comment and state write: ${
            readError instanceof Error ? readError.message : String(readError)
          }`,
          { cause: error },
        )
        ambiguous.classification = 'AMBIGUOUS_RESULT'
        ambiguous.mutationPerformed = true
        if (typeof error?.legacyClassification === 'string') {
          ambiguous.legacyClassification = error.legacyClassification
        }
        throw ambiguous
      }
      if (sameValue(live, projected)) return {
        outcome: 'REVIEWED',
        classification: routingDriftClassification({ prior: original, identity, comment, role: 'REVIEW_VERDICT' }),
        state: live,
        comment,
        identity,
        created,
        recovered: Boolean(recovered),
      }
      if (sameValue(live, original)) {
        return {
          outcome: 'RECOVERABLE_ROUTING_DRIFT',
          classification: 'REPAIRABLE_DRIFT',
          state: original,
          comment,
          identity,
          created,
          recovered: Boolean(recovered),
          error: String(error),
        }
      }
      throw new Error(`STATE_CONFLICT: incompatible concurrent authority after verdict post: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  /**
   * Resume projection when comment exists but state update previously failed.
   */
  async resumeProjection({ roleBody, role, projectState, planningAuthorizationBaseSha }) {
    const { identity, options } = this._matchOptions(roleBody, role)
    const comments = await this.listComments()
    const matches = findMatchingComments(comments, identity, options)
    const classification = classifyTransition(matches.length)
    if (classification !== 'RESUME_PROJECTION') {
      throw new Error(`${classification}: cannot resume projection`)
    }
    const original = await this.readState()
    const callerProjection = typeof projectState === 'function' ? projectState(original) : projectState
    const projected = this._coordinatorOwnedRouting({
      identity,
      comment: matches[0],
      role,
      base: callerProjection,
      prior: original,
      planningAuthorizationBaseSha,
    })
    const written = await this.writeState(projected, original)
    verifyStatePostcondition(projected, written)
    return { outcome: 'RESUMED', state: written, comment: matches[0], identity }
  }

  /**
   * Fail closed when concurrent incompatible state is observed.
   */
  async assertCompatibleSnapshot(expectedState) {
    const live = await this.readState()
    const incompatibleKeys = ['state', 'active_pr', 'review_cycle', 'full_review_count']
    for (const key of incompatibleKeys) {
      if (expectedState?.[key] !== undefined && !sameValue(live?.[key], expectedState[key])) {
        throw new Error(`STATE_CONFLICT: incompatible concurrent state change on ${key}`)
      }
    }
    return live
  }
}

export {
  buildCorrectionHandoffBinding,
  dispatchFounderAuthorizedCorrection,
} from './mission-control/founder-correction-dispatch.mjs'

/**
 * @param {Array<{ body?: string, createdAt?: string }>} comments
 * @param {'RESULT' | 'REVIEW_VERDICT'} role
 */
export { findLatestRoleComment } from './mission-control/role-comment-selection.mjs'

export { classifyMergeDrift } from './mission-control/merge-drift-classification.mjs'

/**
 * Build the complete reviewer-owned durable projection.  The executable
 * facade supplies only evidence already bound to the live Issue/PR/comment;
 * this pure function never reads transport state or posts comments.
 */
export { projectReviewVerdictState } from './mission-control/review-verdict-projection.mjs'

export { founderMergeTransitionAuthorized } from './mission-control/founder-merge-transition-policy.mjs'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env,
  })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`)
  }
  return result.stdout.trim()
}

function parseReconcileArgs(argv) {
  const options = { issue: null, repo: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--repo') {
      const repo = argv[++index]
      if (!repo) throw new Error('--repo requires a value')
      options.repo = repo
      continue
    }
    if (argument.startsWith('-') || options.issue) throw new Error(`unexpected argument: ${argument}`)
    options.issue = argument
  }
  if (!options.issue || !/^[1-9]\d*$/.test(options.issue)) {
    throw new Error('Usage: pnpm run bemoat:mission-control:reconcile -- <issue-number> [--repo owner/repo]')
  }
  return options
}

function stateBlockReplacement(body, state) {
  return projectMissionControlStateBlock(body, state)
}

export {
  assertManagedActivePrForReviewVerdictReconciliation,
  assertReviewedHeadContainedInProtectedMain,
}
from './mission-control/authority-head-validation.mjs'

async function runProductionReviewVerdictReconciliation(options) {
  const repoArgs = options.repo ? ['--repo', options.repo] : []
  const issueArgs = ['issue', 'view', options.issue, '--json', 'body,state', ...repoArgs]
  const issue = JSON.parse(run('gh', issueArgs))
  const parsedIssue = parseMissionControlState(issue.body)
  if (!parsedIssue.present || !parsedIssue.valid) {
    throw new Error(`STATE_CONFLICT: invalid managed state: ${parsedIssue.reason ?? 'missing state block'}`)
  }
  const state = parsedIssue.state
  if (state.state !== 'ELIGIBLE_FOR_FOUNDER_REVIEW') return null
  if (!state.active_pr || !state.current_head || !state.last_reviewed_head) {
    throw new Error('STATE_CONFLICT: eligible managed state is missing exact PR/head lineage')
  }

  const prNumber = String(state.active_pr).replace(/^#/, '')
  const repo = options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  const pr = JSON.parse(run('gh', [
    'pr', 'view', prNumber, '--json', 'number,headRefOid,baseRefName,state', ...repoArgs,
  ]))
  assertManagedActivePrForReviewVerdictReconciliation({
    state,
    pr,
    repo,
    runGh: (args, ghOptions) => run('gh', args, ghOptions),
  })

  const comments = normalizeIssueComments(parsePaginatedGhApiJson(
    run('gh', ['api', '--paginate', `repos/${repo}/issues/${options.issue}/comments`]),
  ))
  if (isReviewRecoveryIncident({ taskIssue: options.issue, activePr: prNumber })) {
    const prComments = normalizeIssueComments(parsePaginatedGhApiJson(
      run('gh', ['api', '--paginate', `repos/${repo}/issues/${prNumber}/comments`]),
    ))
    const rawEvidence = detectUnaccountedReviewEvidence({
      repository: repo,
      taskIssue: options.issue,
      activePr: prNumber,
      managedState: state,
      issueComments: comments,
      prComments,
    })
    if (!rawEvidence.ok) {
      throw new Error(`${rawEvidence.code}: ${rawEvidence.reason}. Use ${rawEvidence.recoveryCommand}.`)
    }
  }
  const verdictComment = selectLiveReviewVerdictComment({
    comments,
    issueNumber: options.issue,
    livePr: pr,
  })

  let expectedBody = issue.body
  const readState = async () => {
    const live = JSON.parse(run('gh', issueArgs))
    const liveState = parseMissionControlState(live.body)
    if (!liveState.present || !liveState.valid) {
      throw new Error(`STATE_CONFLICT: invalid managed state: ${liveState.reason ?? 'missing state block'}`)
    }
    expectedBody = live.body
    return liveState.state
  }
  const listComments = async () => normalizeIssueComments(parsePaginatedGhApiJson(
    run('gh', ['api', '--paginate', `repos/${repo}/issues/${options.issue}/comments`]),
  ))
  const writeState = async (nextState, expectedState) => {
    const live = JSON.parse(run('gh', ['issue', 'view', options.issue, '--json', 'body', ...repoArgs]))
    const liveState = parseMissionControlState(live.body)
    if (!liveState.valid || !sameValue(liveState.state, expectedState) || live.body !== expectedBody) {
      throw new Error('STATE_CONFLICT: concurrent Issue write detected before verdict reconciliation')
    }
    const nextBody = stateBlockReplacement(live.body, nextState)
    await writeIssueBodyWithLease({
      repo,
      issueNumber: options.issue,
      expectedBody: live.body,
      nextBody,
      transitionIdentity: nextState?.latest_transition_identity ?? null,
      holder: 'mission-control-reconcile-review-verdict',
      repoFlag: options.repo,
      deps: { runGh: (args, ghOptions) => run('gh', args, ghOptions) },
    })
    const verified = JSON.parse(run('gh', ['issue', 'view', options.issue, '--json', 'body', ...repoArgs]))
    const verifiedState = parseMissionControlState(verified.body)
    if (!verifiedState.valid || !sameValue(verifiedState.state, nextState)) {
      throw new Error('STATE_CONFLICT: verdict reconciliation projection could not be verified')
    }
    expectedBody = verified.body
    return verifiedState.state
  }

  const coordinator = new Coordinator({
    readState,
    writeState,
    listComments,
    postComment: async () => {
      throw new Error('STATE_CONFLICT: routing reconciliation must not post a REVIEW_VERDICT')
    },
    ...resolveProductionCommentTrust(),
  })
  const result = await coordinator.reconcileReviewVerdict({
    verdictBody: verdictComment.body,
    routingOnly: true,
    projectReview: (prior) => structuredClone(prior),
  })
  const verified = await readState()
  if (String(verified.latest_review_verdict_comment_id ?? '') !== String(verdictComment.id) ||
      verified.latest_transition_identity !== serializeTransitionIdentity(result.identity)) {
    throw new Error('STATE_CONFLICT: verdict reconciliation readback did not match live comment lineage')
  }
  return { ...result, state: verified }
}

async function runProductionBoundedReconciliation() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    const command = resolveCommandIdentity({
      fallback: 'bemoat:mission-control:reconcile',
      env: process.env,
      entrypoint: 'scripts/mission-control-reconcile.mjs',
    })
    const invocation = parseCommandInvocation(command, argv)
    const help = invocation.format === 'json'
      ? `${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`
      : formatTextHelp(invocation.contract)
    process.stdout.write(help)
    return
  }
  const options = parseReconcileArgs(argv)
  const reviewVerdictResult = await runProductionReviewVerdictReconciliation(options)
  if (reviewVerdictResult) {
    process.stdout.write(
      `Mission Control REVIEW_VERDICT reconciliation ${reviewVerdictResult.outcome}: comment ${reviewVerdictResult.comment.id}\n`,
    )
    return
  }
  const repoArgs = options.repo ? ['--repo', options.repo] : []
  const { analyzeProgressTracking } = await import('./agent-issue.mjs')
  const { parseMissionControlState } = await import('./mission-control-state.mjs')
  let expectedBody = null

  const readEvidence = async () => {
    const issue = JSON.parse(run('gh', ['issue', 'view', options.issue, '--json', 'body,state', ...repoArgs]))
    const state = parseMissionControlState(issue.body)
    if (!state.present || !state.valid) throw new Error(`invalid managed state: ${state.reason ?? 'missing state block'}`)
    expectedBody = issue.body
    const activePr = String(state.state.active_pr ?? '').replace(/^#/, '')
    if (activePr && isReviewRecoveryIncident({ taskIssue: options.issue, activePr })) {
      const repository = options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
      const issueComments = normalizeIssueComments(parsePaginatedGhApiJson(
        run('gh', ['api', '--paginate', `repos/${repository}/issues/${options.issue}/comments`]),
      ))
      const prComments = normalizeIssueComments(parsePaginatedGhApiJson(
        run('gh', ['api', '--paginate', `repos/${repository}/issues/${activePr}/comments`]),
      ))
      const rawEvidence = detectUnaccountedReviewEvidence({
        repository,
        taskIssue: options.issue,
        activePr,
        managedState: state.state,
        issueComments,
        prComments,
      })
      if (!rawEvidence.ok) {
        throw new Error(`${rawEvidence.code}: ${rawEvidence.reason}. Use ${rawEvidence.recoveryCommand}.`)
      }
    }
    const analysis = analyzeProgressTracking({
      activeIssueBody: issue.body,
      activeIssueNumber: options.issue,
      activeIssueState: issue.state,
    })
    const reconciliation = analysis.report.reconciliation
    if (!reconciliation) throw new Error('production preflight did not produce reconciliation evidence')
    const bookkeepingFields =
      reconciliation.proposal?.type === 'review' || reconciliation.proposal?.type === 'delivery'
        ? reconciliation.proposal.fields
        : null
    return {
      managedState: state.state,
      classification: reconciliation.classification,
      bookkeepingProposal: bookkeepingFields,
      // Keep proposedState as the merged bookkeeping view for proposedRepair callers.
      proposedState: bookkeepingFields
        ? { ...structuredClone(state.state), ...structuredClone(bookkeepingFields) }
        : (reconciliation.proposal?.fields ?? null),
    }
  }

  const writeState = async (nextState, expectedState) => {
    const live = JSON.parse(run('gh', ['issue', 'view', options.issue, '--json', 'body', ...repoArgs]))
    const liveState = parseMissionControlState(live.body)
    if (!liveState.valid || !sameValue(liveState.state, expectedState) || live.body !== expectedBody) {
      throw new Error('STATE_CONFLICT: concurrent Issue write detected before reconciliation repair')
    }
    const observedBody = live.body
    const nextBody = stateBlockReplacement(observedBody, nextState)
    const repo = options.repo || run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    await writeIssueBodyWithLease({
      repo,
      issueNumber: options.issue,
      expectedBody: observedBody,
      nextBody,
      transitionIdentity: nextState?.latest_transition_identity ?? null,
      holder: 'mission-control-reconcile',
      repoFlag: options.repo,
      deps: { runGh: (args, ghOptions) => run('gh', args, ghOptions) },
    })
    const verified = JSON.parse(run('gh', ['issue', 'view', options.issue, '--json', 'body', ...repoArgs]))
    const verifiedState = parseMissionControlState(verified.body)
    if (!verifiedState.valid || !sameValue(verifiedState.state, nextState)) {
      throw new Error('STATE_CONFLICT: concurrent Issue write detected after reconciliation repair')
    }
    expectedBody = verified.body
    return verifiedState.state
  }

  const result = await runBoundedReconciliation({ readEvidence, writeState })
  if (['STATE_CONFLICT', 'BLOCKED_EXTERNAL'].includes(result.finalOutcome)) {
    throw new Error(reconciliationFailureReason(result))
  }
  process.stdout.write(`Mission Control reconciliation ${result.finalOutcome}: ${result.measurements.reconciliation_attempts} attempt(s), ${result.measurements.state_writes} durable write(s)\n`)
}

if (process.argv[1]?.endsWith('/mission-control-reconcile.mjs')) {
  runProductionBoundedReconciliation().catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
