#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { createHelpEnvelopeV1, formatTextHelp } from '../../cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
} from '../../cli/command-invocation.mjs'

import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'
import { parseMissionControlState, projectMissionControlStateBlock } from '../../mission-control-state.mjs'
import { writeIssueBodyWithLease } from '../../mission-control-issue-body-cas.mjs'
import {
  CAMPAIGN_EXPANSION_POLICY_VERSION,
  LEGACY_MAX_SLICE,
  expectedSliceKeys,
  selectNextCampaignAction,
  validateCampaignTransition,
} from '../domain/campaign-authority.mjs'
import { sameCampaignValue } from '../domain/campaign-equality.mjs'
import { parseCampaign } from '../domain/campaign-parser.mjs'
import { replaceCampaignBlock } from '../domain/campaign-renderer.mjs'
import { preflightCanonicalBootstrapTask } from '../domain/task-bootstrap-preflight.mjs'
import {
  detectUnaccountedReviewEvidence,
  isReviewRecoveryIncident,
} from '../domain/review-recovery.mjs'
import {
  classifyMergeReviewVerdict,
  parseProductionMergeReviewVerdict,
  resolveMergeReviewVerdictBinding,
} from '../domain/merge-review-verdict.mjs'
import { normalizePaginatedCommitMessages } from '../domain/merge-commit-messages.mjs'
import { classifyHeadBindings } from '../domain/merge-head-bindings.mjs'
import { classifyMergeability } from '../domain/merge-mergeability.mjs'
import { classifyNoAutomaticClosure } from '../domain/merge-no-automatic-closure.mjs'
import { validateNextAction } from '../domain/merge-next-action.mjs'
import { validateBlockerResolutionBindings } from '../domain/merge-blocker-bindings.mjs'
import { validateBlockerResolutionPostconditions } from '../domain/merge-blocker-postconditions.mjs'
import { blockerResolutionCampaignPostconditions } from '../domain/merge-blocker-campaign-postconditions.mjs'
import { renderFinalResultBody } from '../domain/merge-final-result.mjs'
import { classifyCampaignOwnershipEvidence } from '../domain/merge-campaign-ownership.mjs'
import { validateDirectOwnership } from '../domain/merge-direct-ownership.mjs'
import { commentSupersedesId } from '../domain/merge-comment-supersession.mjs'
import {
  SAFE_EXECUTION_BUNDLES,
  SAFE_EXECUTION_BUNDLE_SCOPES,
  validateSafeExecutionBundle,
} from '../domain/merge-safe-execution-bundle.mjs'
import {
  CAMPAIGN_PROJECTION_KINDS,
  hasMeaningfulBindingValue,
  resolveCampaignProjectionKind,
} from '../domain/merge-campaign-projection.mjs'
import { flattenGhPages } from '../domain/merge-gh-pages.mjs'
import {
  AUTHORIZATION_VALIDATION_FAILURE,
  authorizationValidationFailure,
  generateFounderMergeAuthorization,
  parseFounderMergeAuthorization,
  serializeFounderMergeAuthorization,
  validateFounderAuthorizationRecord,
  validateFounderMergeAuthorization,
  validateFounderMergeAuthorizationEvidence,
} from '../domain/merge-founder-authority.mjs'

export {
  AUTHORIZATION_VALIDATION_FAILURE,
  generateFounderMergeAuthorization,
  parseFounderMergeAuthorization,
  parseProductionMergeReviewVerdict,
  resolveMergeReviewVerdictBinding,
  serializeFounderMergeAuthorization,
  validateFounderAuthorizationRecord,
  validateFounderMergeAuthorization,
  validateFounderMergeAuthorizationEvidence,
}
export { normalizePaginatedCommitMessages }
export { flattenGhPages }

const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const MERGE_COMPLETION_BUNDLE_KIND = 'merge-completion'
const MERGE_COMPLETION_AUTHORITY_SCOPE = 'merge'
const BLOCKER_RESOLUTION_MAX_SLICE = 11

export { SAFE_EXECUTION_BUNDLES, SAFE_EXECUTION_BUNDLE_SCOPES, validateSafeExecutionBundle }

function defaultMergeCompletionBundle() {
  return {
    kind: MERGE_COMPLETION_BUNDLE_KIND,
    authority_scope: MERGE_COMPLETION_AUTHORITY_SCOPE,
    terminal_outcome: 'Task DONE and campaign slice DONE; next action selected but not started',
    steps: SAFE_EXECUTION_BUNDLES['merge-completion'],
  }
}

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function blockedExternal(message) {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

function normalizeIssueNumber(value) {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value) {
  return resolvePrNumber(value)
}

async function resolveCampaignMergeRoute({
  deps,
  repo,
  issueNumber,
  prNumber,
  authorization,
  state,
}) {
  const managedCampaignIssue = normalizeIssueNumber(state?.campaign_issue)
  const hasManagedCampaignClaim = hasMeaningfulBindingValue(state?.campaign_issue) ||
    hasMeaningfulBindingValue(state?.campaign_slice)

  if (!hasManagedCampaignClaim) return null
  if (!managedCampaignIssue) {
    throw stateConflict('managed campaign binding has an invalid campaign Issue')
  }

  const managedCampaignSlice = state?.campaign_slice == null ? null : Number(state.campaign_slice)
  const projectionClassification = resolveCampaignProjectionKind(authorization)
  if (!projectionClassification.valid) throw stateConflict(projectionClassification.reason)
  const projectionKind = projectionClassification.projectionKind
  let blockerBinding = null

  if (managedCampaignSlice != null) {
    if (!Number.isInteger(managedCampaignSlice) || managedCampaignSlice <= 0) {
      throw stateConflict('managed campaign binding has an invalid campaign slice')
    }
    if (projectionKind !== CAMPAIGN_PROJECTION_KINDS.SLICE) {
      throw stateConflict('campaign projection kind differs from managed campaign slice binding')
    }
    if (normalizeIssueNumber(authorization.campaign_issue) !== managedCampaignIssue ||
      Number(authorization.campaign_slice) !== managedCampaignSlice) {
      throw stateConflict('campaign authorization tuple differs from managed state')
    }
  } else {
    if (projectionKind !== CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION) {
      throw stateConflict('managed campaign binding requires an exact slice or blocker-resolution tuple')
    }
    blockerBinding = validateBlockerResolutionBindings({ authorization, state })
    if (blockerBinding.campaignIssue !== managedCampaignIssue) {
      throw stateConflict('blocker-resolution campaign Issue binding differs from managed state')
    }
  }

  if (typeof deps.readCampaignOwnership !== 'function') {
    throw blockedExternal('verified durable campaign ownership evidence is unavailable')
  }
  const route = {
    projectionKind,
    campaignIssue: managedCampaignIssue,
    campaignSlice: managedCampaignSlice,
    blockerBinding,
  }
  const ownership = await deps.readCampaignOwnership({
    repo,
    taskIssue: issueNumber,
    prNumber,
    campaignIssue: route.campaignIssue,
    campaignSlice: route.campaignSlice,
    campaignBlockerId: route.blockerBinding?.campaignBlockerId ?? null,
    projectionKind: route.projectionKind,
  })
  const ownershipClassification = classifyCampaignOwnershipEvidence({
    ownership,
    route,
    issueNumber,
    prNumber,
  })
  if (!ownershipClassification.valid) throw stateConflict(ownershipClassification.reason)
  return route
}

export function validateMergeReviewVerdict({ reviewVerdict, expected }) {
  const classification = classifyMergeReviewVerdict({ reviewVerdict, expected })
  if (!classification.valid) throw stateConflict(classification.reason)
  return true
}

function verifyHeadBindings(state, pr, authorization, repo) {
  const result = classifyHeadBindings(state, pr, authorization, repo)
  if (!result.valid) throw stateConflict(result.reason)
  return result.reviewedHead
}

function verifyMergeability(pr) {
  const result = classifyMergeability(pr)
  if (!result.valid) throw stateConflict(result.reason)
  return true
}

function verifyNoAutomaticClosure(pr, issueNumber, repo) {
  const result = classifyNoAutomaticClosure(pr, issueNumber, repo)
  if (!result.valid) throw stateConflict(result.reason)
}

function mergeCommitOid(pr, mergeResult) {
  return pr?.mergeCommit?.oid ?? pr?.mergeCommit?.sha ?? mergeResult?.mergeCommit?.oid ?? mergeResult?.mergeCommit?.sha ?? null
}

function normalizeIssueState(issue) {
  return String(issue?.state ?? '').toUpperCase()
}

function normalizeIssueReason(issue) {
  return String(issue?.stateReason ?? issue?.state_reason ?? '').toUpperCase()
}

function resultCommentId(result) {
  return result?.id ?? result?.commentId ?? null
}

async function completeTerminalCampaignProjection({
  deps,
  repo,
  issueNumber,
  prNumber,
  reviewedHead,
  mergeCommit,
  authorization,
  state,
  authorizationCommentId,
  nextAction,
}) {
  const campaignIssue = normalizeIssueNumber(authorization.campaign_issue ?? state.campaign_issue)
  const campaignSlice = Number(authorization.campaign_slice ?? state.campaign_slice)
  if (!campaignIssue || !Number.isInteger(campaignSlice) || campaignSlice <= 0) {
    throw stateConflict('merge completion requires an exact campaign Issue and slice binding')
  }

  const campaignProjection = await deps.projectCampaignSliceDone({
    repo,
    campaignIssue,
    campaignSlice,
    taskIssue: issueNumber,
    prNumber,
    reviewedHead,
    mergeCommit,
    authorizationCommentId: String(authorizationCommentId),
  })
  if (campaignProjection?.status !== 'DONE') throw stateConflict('campaign slice DONE projection was not confirmed')

  if (!nextAction || nextAction.started !== false || typeof nextAction.action !== 'string' || nextAction.action.length === 0) {
    throw stateConflict('merge completion must select the next campaign action without starting it')
  }

  return { campaignIssue, campaignSlice, nextAction }
}

async function completeTerminalBlockerProjection({
  deps,
  repo,
  issueNumber,
  prNumber,
  reviewedHead,
  mergeCommit,
  campaignIssue,
  campaignBlockerId,
  authorizationCommentId,
  nextAction,
}) {
  const campaignProjection = await deps.projectCampaignBlockerResolved({
    repo,
    campaignIssue,
    campaignBlockerId,
    taskIssue: issueNumber,
    prNumber,
    reviewedHead,
    mergeCommit,
    authorizationCommentId: String(authorizationCommentId),
    nextAction,
  })
  if (campaignProjection?.status !== 'RESOLVED') {
    throw stateConflict('campaign blocker resolution projection was not confirmed')
  }

  if (!nextAction || nextAction.started !== false || typeof nextAction.action !== 'string' || nextAction.action.length === 0) {
    throw stateConflict('blocker resolution must select the next campaign action without starting it')
  }
  if (campaignProjection.postconditions != null) {
    validateBlockerResolutionPostconditions(campaignProjection.postconditions, {
      nextAction,
      requireTask: false,
      expected: { campaignIssue, campaignBlockerId },
    })
  }

  return { campaignIssue, campaignBlockerId, nextAction, postconditions: campaignProjection.postconditions }
}

async function reconcileAfterFailure({ deps, issueNumber, repo, error }) {
  if (typeof deps.reconcile !== 'function') return null
  try {
    return await deps.reconcile(issueNumber, repo, {
      reason: error instanceof Error ? error.message : String(error),
      trigger: 'merge-completion-projection-failure',
    })
  } catch (reconciliationError) {
    if (error && typeof error === 'object') error.reconciliationError = reconciliationError
    return null
  }
}

export async function runFounderAuthorizedMerge({
  issueNumber,
  repo,
  authorizationCommentId,
  executionBundle,
  deps,
}) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0 || !repo || !/^[1-9]\d*$/.test(String(authorizationCommentId))) {
    throw stateConflict('task Issue, repository, and Founder authorization comment ID are required')
  }
  const bundleCheck = validateSafeExecutionBundle(executionBundle ?? defaultMergeCompletionBundle())
  if (!bundleCheck.valid) throw stateConflict(bundleCheck.reason)
  if (bundleCheck.kind !== MERGE_COMPLETION_BUNDLE_KIND || bundleCheck.authority_scope !== MERGE_COMPLETION_AUTHORITY_SCOPE) {
    throw stateConflict('merge transport requires the exact merge-completion bundle and merge authority scope')
  }
  if (!deps || typeof deps.readManagedIssue !== 'function' || typeof deps.readPullRequest !== 'function') {
    throw blockedExternal('merge completion transport dependencies are incomplete')
  }

  let issue = await deps.readManagedIssue(issueNumber, repo)
  const state = issue?.managedState
  const prNumber = normalizePrNumber(state?.active_pr)
  if (!prNumber) throw stateConflict('directly managed task has no active PR terminal ownership')
  let pr = await deps.readPullRequest(prNumber, repo)
  const ownership = validateDirectOwnership({ issueNumber, issue, pr })
  if (!ownership.valid) throw stateConflict(ownership.reason)
  if (
    typeof deps.readIssueComments === 'function' &&
    isReviewRecoveryIncident({ taskIssue: issueNumber, activePr: prNumber })
  ) {
    const [issueComments, prComments] = await Promise.all([
      deps.readIssueComments(repo, issueNumber),
      deps.readIssueComments(repo, prNumber),
    ])
    const rawEvidence = detectUnaccountedReviewEvidence({
      repository: repo,
      taskIssue: issueNumber,
      activePr: prNumber,
      managedState: state,
      issueComments,
      prComments,
    })
    if (!rawEvidence.ok) {
      throw stateConflict(`${rawEvidence.code}: ${rawEvidence.reason}. Use ${rawEvidence.recoveryCommand}.`)
    }
  }
  const bootstrapPreflight = preflightCanonicalBootstrapTask({
    issue,
    pullRequest: pr,
    repository: repo,
  })
  if (!bootstrapPreflight.ok) throw stateConflict(`${bootstrapPreflight.classification ?? 'STATE_CONFLICT'}: ${bootstrapPreflight.reason}`)

  const authorization = await deps.readFounderAuthorization(repo, issueNumber, authorizationCommentId)
  const trustedFounderLogins = await deps.readTrustedFounderLogins(repo)
  const reviewedHead = state.last_reviewed_head
  const reviewCommentId = authorization?.review_verdict_comment_id ?? state.latest_review_verdict_comment_id
  validateFounderMergeAuthorization({
    authorization,
    authorizationCommentId,
    issueNumber,
    prNumber,
    reviewedHead,
    base: state.approved_base,
    repository: repo,
    policyVersion: state.guide_version,
    reviewCommentId,
    policySourceSha: state.guide_source_sha,
    protectedBaseSha: pr.baseRefOid,
    trustedFounderLogins,
  })
  const campaignRoute = await resolveCampaignMergeRoute({
    deps,
    repo,
    issueNumber,
    prNumber,
    authorization,
    state,
  })
  const projectionKind = campaignRoute?.projectionKind ?? null
  const blockerBinding = campaignRoute?.blockerBinding ?? null
  if (typeof deps.readReviewVerdict !== 'function') {
    throw blockedExternal('exact reviewed verdict evidence is unavailable')
  }
  const reviewVerdict = await deps.readReviewVerdict(repo, issueNumber, reviewCommentId)
  validateMergeReviewVerdict({
    reviewVerdict,
    expected: {
      commentId: reviewCommentId,
      exactHead: reviewedHead,
      pr: prNumber,
      base: state.approved_base,
    },
  })
  verifyHeadBindings(state, pr, authorization, repo)
  verifyNoAutomaticClosure(pr, issueNumber, repo)

  const alreadyDone = state.state === 'DONE'
  if (!alreadyDone && state.state !== 'ELIGIBLE_FOR_FOUNDER_REVIEW') {
    throw stateConflict(`managed task state ${state.state ?? 'unknown'} is not eligible for Founder-authorized merge`)
  }

  const requiredProjectionDeps = campaignRoute
    ? [
        projectionKind === CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION
          ? 'projectCampaignBlockerResolved'
          : 'projectCampaignSliceDone',
      ]
    : []
  if (!alreadyDone) {
    requiredProjectionDeps.unshift(
      'markReadyForReview',
      'mergePullRequest',
      'verifyCommitOnProtectedBase',
      'postFinalResult',
      'closeIssueCompleted',
      'writeTaskDone',
    )
  }
  const missingProjectionDeps = requiredProjectionDeps.filter((name) => typeof deps[name] !== 'function')
  if (missingProjectionDeps.length > 0) {
    throw blockedExternal(`merge completion projection dependencies are unavailable: ${missingProjectionDeps.join(', ')}`)
  }

  const campaignIssueForNextAction = campaignRoute?.campaignIssue ?? null
  let nextAction = null
  const readNextActionBeforeMutation = async () => {
    if (!campaignRoute) {
      nextAction = { action: 'none on this task', started: false }
      return nextAction
    }
    if (typeof deps.readNextCampaignAction !== 'function') {
      throw blockedExternal('merge completion next campaign action evidence is unavailable')
    }
    if (!campaignIssueForNextAction) {
      throw stateConflict('merge completion requires an exact campaign Issue binding before selecting the next action')
    }
    nextAction = validateNextAction(
      await deps.readNextCampaignAction({ repo, campaignIssue: campaignIssueForNextAction }),
      { requiredSlice: projectionKind === CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION ? 5 : null },
    )
    return nextAction
  }

  let mutationStarted = false
  let mergeResult = null
  try {
    if (alreadyDone) {
      if (normalizeIssueState(issue) !== 'CLOSED' || normalizeIssueReason(issue) !== 'COMPLETED' || String(pr.state).toUpperCase() !== 'MERGED') {
        throw stateConflict('DONE task does not have the verified closed Issue and merged PR terminal projection')
      }
      const commit = mergeCommitOid(pr, null)
      if (!commit) throw stateConflict('DONE task does not expose a merge commit')
      if (state.merged_commit_sha !== commit) {
        throw stateConflict('DONE task does not bind the verified merge commit')
      }
      if (!/^[1-9]\d*$/.test(String(state.latest_result_comment_id ?? ''))) {
        throw stateConflict('DONE task does not bind a final RESULT comment')
      }
      const onBase = await deps.verifyCommitOnProtectedBase({ repo, base: state.approved_base, commit })
      if (!onBase) throw stateConflict('verified merge commit has not reached the protected base')
      if (campaignRoute && projectionKind !== CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION) {
        if (typeof deps.readNextCampaignAction !== 'function') {
          throw blockedExternal('merge completion next campaign action evidence is unavailable')
        }
        if (!campaignIssueForNextAction) {
          throw stateConflict('merge completion requires an exact campaign Issue binding before selecting the next action')
        }
        nextAction = validateNextAction(
          await deps.readNextCampaignAction({ repo, campaignIssue: campaignIssueForNextAction }),
        )
      }
      if (!campaignRoute) {
        return {
          outcome: 'NO_OP',
          issueNumber,
          prNumber,
          reviewedHead,
          mergeCommit: commit,
          finalResultCommentId: String(state.latest_result_comment_id),
          nextAction: 'none on this task',
        }
      }
      const storedBlockerPostconditions = projectionKind === CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION
        ? state.blocker_resolution_postconditions ?? state.campaign_postconditions
        : null
      if (projectionKind === CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION) {
        if (typeof deps.readCampaignBlockerResolutionPostconditions !== 'function') {
          throw stateConflict('DONE blocker-resolution requires a complete live terminal projection reader')
        }
        const livePostconditions = await deps.readCampaignBlockerResolutionPostconditions({
          repo,
          campaignIssue: blockerBinding.campaignIssue,
          campaignBlockerId: blockerBinding.campaignBlockerId,
          taskIssue: issueNumber,
          prNumber,
          reviewedHead,
          mergeCommit: commit,
          finalResultCommentId: state.latest_result_comment_id,
        })
        validateBlockerResolutionPostconditions(livePostconditions, {
          expected: {
            taskIssue: issueNumber,
            prNumber,
            reviewedHead,
            mergeCommit: commit,
            finalResultCommentId: state.latest_result_comment_id,
            campaignIssue: blockerBinding.campaignIssue,
            campaignBlockerId: blockerBinding.campaignBlockerId,
          },
        })
        if (storedBlockerPostconditions != null) {
          validateBlockerResolutionPostconditions(storedBlockerPostconditions, {
            expected: {
              taskIssue: issueNumber,
              prNumber,
              reviewedHead,
              mergeCommit: commit,
              finalResultCommentId: state.latest_result_comment_id,
              campaignIssue: blockerBinding.campaignIssue,
              campaignBlockerId: blockerBinding.campaignBlockerId,
            },
          })
          if (!sameCampaignValue(storedBlockerPostconditions, livePostconditions)) {
            throw stateConflict('stored and live blocker-resolution terminal projections differ')
          }
        }
        return {
          outcome: 'NO_OP',
          issueNumber,
          prNumber,
          reviewedHead,
          mergeCommit: commit,
          finalResultCommentId: String(state.latest_result_comment_id),
          nextAction: 'already selected; do not start it',
        }
      }
      mutationStarted = true
      let terminal
      try {
        terminal = !campaignRoute
          ? { nextAction }
          : projectionKind === CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION
          ? await completeTerminalBlockerProjection({
              deps,
              repo,
              issueNumber,
              prNumber,
              reviewedHead,
              mergeCommit: commit,
              campaignIssue: blockerBinding.campaignIssue,
              campaignBlockerId: blockerBinding.campaignBlockerId,
              authorizationCommentId,
              nextAction,
            })
          : await completeTerminalCampaignProjection({
              deps,
              repo,
              issueNumber,
              prNumber,
              reviewedHead,
              mergeCommit: commit,
              authorization,
              state,
              authorizationCommentId,
              nextAction,
            })
        if (
          projectionKind === CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION &&
          terminal.postconditions == null
        ) {
          throw stateConflict('blocker-resolution completion postconditions are missing')
        }
      } catch (error) {
        if (
          projectionKind === CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION &&
          /completion postconditions/.test(error instanceof Error ? error.message : String(error))
        ) {
          const reconciliation = await reconcileAfterFailure({ deps, issueNumber, repo, error })
          if (reconciliation?.finalOutcome === 'NO_OP') {
            return {
              outcome: 'NO_OP',
              issueNumber,
              prNumber,
              reviewedHead,
              mergeCommit: commit,
              finalResultCommentId: String(state.latest_result_comment_id),
            }
          }
        }
        throw error
      }
      return {
        outcome: 'NO_OP',
        issueNumber,
        prNumber,
        reviewedHead,
        mergeCommit: commit,
        finalResultCommentId: String(state.latest_result_comment_id),
        nextAction: terminal.nextAction.action,
      }
    }

    if (String(pr.state).toUpperCase() !== 'MERGED') {
      if (normalizeIssueState(issue) !== 'OPEN') throw stateConflict('an unmerged PR cannot belong to an already-closed managed Issue')
      if (String(pr.state).toUpperCase() !== 'OPEN') throw stateConflict('PR must be open before merge')
      verifyMergeability(pr)
      await readNextActionBeforeMutation()
      if (pr.isDraft) {
        mutationStarted = true
        await deps.markReadyForReview(prNumber, repo)
        pr = await deps.readPullRequest(prNumber, repo)
        verifyHeadBindings(state, pr, authorization, repo)
        const currentReviewVerdict = await deps.readReviewVerdict(repo, issueNumber, reviewCommentId)
        validateMergeReviewVerdict({
          reviewVerdict: currentReviewVerdict,
          expected: { commentId: reviewCommentId, exactHead: reviewedHead, pr: prNumber, base: state.approved_base },
        })
        verifyNoAutomaticClosure(pr, issueNumber, repo)
        verifyMergeability(pr)
        if (pr.isDraft) throw stateConflict('Draft PR did not become ready for review')
      }
      mutationStarted = true
      mergeResult = await deps.mergePullRequest({ prNumber, repo, expectedHead: reviewedHead })
      pr = await deps.readPullRequest(prNumber, repo)
      if (pr.headRefOid !== reviewedHead || String(pr.state).toUpperCase() !== 'MERGED') {
        throw stateConflict('merge result does not preserve the authorized expected head')
      }
    } else {
      mutationStarted = true
    }

    const commit = mergeCommitOid(pr, mergeResult)
    if (!commit) throw stateConflict('merged PR does not expose a merge commit')
    const onBase = await deps.verifyCommitOnProtectedBase({ repo, base: state.approved_base, commit })
    if (!onBase) throw stateConflict('verified merge commit has not reached the protected base')
    if (nextAction == null) await readNextActionBeforeMutation()

    const finalResult = await deps.postFinalResult({
      repo,
      issueNumber,
      prNumber,
      reviewedHead,
      base: state.approved_base,
      policyVersion: state.guide_version,
      mergeCommit: commit,
      body: renderFinalResultBody({
        issueNumber,
        prNumber,
        reviewedHead,
        mergeCommit: commit,
        base: state.approved_base,
        policyVersion: state.guide_version,
        projectionKind,
        nextAction: nextAction?.action,
        campaignIssue: blockerBinding?.campaignIssue,
        campaignBlockerId: blockerBinding?.campaignBlockerId,
      }),
    })
    const finalResultId = resultCommentId(finalResult)
    if (!finalResultId || !/^[1-9]\d*$/.test(String(finalResultId))) {
      throw blockedExternal('final RESULT did not return an immutable comment identifier')
    }

    issue = await deps.readManagedIssue(issueNumber, repo)
    if (normalizeIssueState(issue) === 'OPEN') {
      await deps.closeIssueCompleted(issueNumber, repo)
      issue = await deps.readManagedIssue(issueNumber, repo)
    }
    if (normalizeIssueState(issue) !== 'CLOSED' || normalizeIssueReason(issue) !== 'COMPLETED') {
      throw stateConflict('managed task Issue was not closed as completed')
    }

    const taskProjection = await deps.writeTaskDone({
      repo,
      issueNumber,
      prNumber,
      reviewedHead,
      mergeCommit: commit,
      resultCommentId: String(finalResultId),
      expectedState: state,
    })
    if (taskProjection?.state !== 'DONE') throw stateConflict('direct deterministic Task DONE projection was not confirmed')

    const terminal = !campaignRoute
      ? { nextAction }
      : projectionKind === CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION
      ? await completeTerminalBlockerProjection({
          deps,
          repo,
          issueNumber,
          prNumber,
          reviewedHead,
          mergeCommit: commit,
          campaignIssue: blockerBinding.campaignIssue,
          campaignBlockerId: blockerBinding.campaignBlockerId,
          authorizationCommentId,
          nextAction,
        })
      : await completeTerminalCampaignProjection({
          deps,
          repo,
          issueNumber,
          prNumber,
          reviewedHead,
          mergeCommit: commit,
          authorization,
          state,
          authorizationCommentId,
          nextAction,
        })

    return {
      outcome: 'DONE',
      issueNumber,
      prNumber,
      reviewedHead,
      mergeCommit: commit,
      finalResultCommentId: String(finalResultId),
      nextAction: terminal.nextAction.action,
    }
  } catch (error) {
    if (mutationStarted) await reconcileAfterFailure({ deps, issueNumber, repo, error })
    throw error
  }
}

function runGh(args, options = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input: options.input, env: options.env ?? process.env })
  if (result.error || result.status !== 0) {
    throw blockedExternal(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
  }
  return result.stdout.trim()
}

function runNode(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'Mission Control reconciler failed')
  }
  return result.stdout.trim()
}

function parseArgs(argv) {
  const options = { issueNumber: null, repo: null, authorizationCommentId: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--repo' || argument === '--authorization-comment') {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--repo') options.repo = value
      else options.authorizationCommentId = value
      continue
    }
    if (argument.startsWith('-') || options.issueNumber) throw new Error(`unexpected argument: ${argument}`)
    options.issueNumber = Number(argument)
  }
  if (!Number.isInteger(options.issueNumber) || options.issueNumber <= 0 || !options.repo || !options.authorizationCommentId) {
    throw new Error('Usage: pnpm run bemoat:mission-control:merge -- <issue-number> --repo owner/repo --authorization-comment <id>')
  }
  return options
}

function stateBlockReplacement(body, state) {
  try {
    return projectMissionControlStateBlock(body, state)
  } catch (error) {
    throw stateConflict(error instanceof Error ? error.message : String(error))
  }
}

function sameTerminalBinding(left, right) {
  return ['state', 'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head']
    .every((key) => left?.[key] === right?.[key])
}

function campaignParseFailure(parsed, context) {
  const message = `${context}: ${parsed.reason ?? 'invalid campaign projection'}`
  if (parsed.classification === 'BLOCKED_EXTERNAL') throw blockedExternal(message)
  throw stateConflict(message)
}

function createProductionDeps() {
  const readManagedIssue = async (issueNumber, repo) => {
    const issue = JSON.parse(runGh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'number,id,title,body,state,stateReason']))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) throw stateConflict(`Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    return { ...issue, managedState: parsed.state }
  }
  const readPullRequest = async (prNumber, repo) => {
    const pr = JSON.parse(runGh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'number,id,state,isDraft,mergeable,headRefOid,baseRefName,baseRefOid,statusCheckRollup,mergeCommit,url,title,body,closingIssuesReferences',
    ]))
    const commitPages = JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/pulls/${prNumber}/commits?per_page=100`,
    ]))
    return { ...pr, commits: normalizePaginatedCommitMessages(commitPages) }
  }

  const readIssueComment = (repo, issueNumber, commentId) => {
    const comment = JSON.parse(runGh(['api', `repos/${repo}/issues/comments/${commentId}`]))
    const expectedIssueUrl = `https://api.github.com/repos/${repo}/issues/${issueNumber}`
    if (comment.issue_url !== expectedIssueUrl || !comment.user?.login) {
      throw stateConflict(`Issue comment ${commentId} is not bound to Issue #${issueNumber} and an authenticated author`)
    }
    return comment
  }

  const readIssueComments = (repo, issueNumber) => {
    const pages = JSON.parse(runGh([
      'api', '--paginate', '--slurp', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    ]))
    return flattenGhPages(pages)
  }

  const readTrustedFounderLogins = async (repo) => {
    const variable = JSON.parse(runGh(['api', `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`]))
    const value = String(variable.value ?? '').trim()
    const logins = value.split(',').map((login) => login.trim()).filter(Boolean)
    if (logins.length === 0 || logins.some((login) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login))) {
      throw stateConflict('repository Actions variable BEMOAT_FOUNDER_LOGINS must contain a comma-separated list of GitHub logins')
    }
    return logins
  }

  const readCampaignAuthorityEvidence = async (repo, campaignIssue) => {
    const [comments, trustedFounderLogins, mainRef] = await Promise.all([
      Promise.resolve(readIssueComments(repo, campaignIssue)),
      readTrustedFounderLogins(repo),
      Promise.resolve(JSON.parse(runGh(['api', `repos/${repo}/git/ref/heads/main`]))),
    ])
    const currentProtectedBaseSha = mainRef?.object?.sha
    if (!FULL_SHA_RE.test(String(currentProtectedBaseSha ?? ''))) {
      throw blockedExternal('live protected main ref is unavailable while verifying campaign expansion authority')
    }
    return {
      campaignExpansionAuthority: {
        comments,
        trustedFounderLogins,
        currentProtectedBaseSha,
      },
    }
  }

  const deriveCampaignExpansionAuthority = (repo, campaignIssue, evidence) => {
    const envelope = evidence?.campaignExpansionAuthority
    const comments = envelope?.comments
    if (!Array.isArray(comments)) {
      throw blockedExternal('live campaign expansion authority evidence is unavailable')
    }
    const source = comments.find((comment) =>
      /CAMPAIGN EXPANSION/i.test(String(comment?.body ?? '')) &&
      /APPEND SLICES/i.test(String(comment?.body ?? '')),
    )
    if (!source || !source.user?.login || !source.body) {
      throw blockedExternal('Founder campaign expansion authority comment is unavailable')
    }
    const range = String(source.body).match(/APPEND SLICES\s+(\d+)\s*[–-]\s*(\d+)/i)
    const startSlice = Number(range?.[1])
    const authorizedMaxSlice = Number(range?.[2])
    if (
      startSlice !== LEGACY_MAX_SLICE + 1 ||
      authorizedMaxSlice !== BLOCKER_RESOLUTION_MAX_SLICE
    ) {
      throw stateConflict('Founder campaign expansion authority does not bind the contiguous approved range')
    }
    const relatedAuthorityCommentIds = comments
      .filter((comment) => /FOUNDER_(?:DIRECTIVE|ARCHITECTURE_DIRECTIVE)/i.test(String(comment?.body ?? '')))
      .map((comment) => String(comment.id))
      .filter((id) => /^[1-9]\d*$/.test(id))
    if (relatedAuthorityCommentIds.length === 0) {
      throw blockedExternal('related Founder campaign expansion authority comments are unavailable')
    }
    return {
      schema_version: 1,
      decision: 'APPROVED',
      scope: 'campaign_slice_range',
      action: 'append_only_expand',
      source: {
        kind: 'github_issue_comment',
        repository: repo,
        issue: `#${campaignIssue}`,
        comment_id: String(source.id),
        author_login: source.user.login,
        body_sha256: createHash('sha256').update(String(source.body), 'utf8').digest('hex'),
      },
      approved_base: 'main',
      protected_base_sha: String(envelope.currentProtectedBaseSha).toLowerCase(),
      policy_version: CAMPAIGN_EXPANSION_POLICY_VERSION,
      legacy_max_slice: LEGACY_MAX_SLICE,
      authorized_max_slice: authorizedMaxSlice,
      authorized_append_keys: expectedSliceKeys(authorizedMaxSlice).slice(LEGACY_MAX_SLICE),
      append_only: true,
      related_authority_comment_ids: relatedAuthorityCommentIds,
    }
  }

  const readCampaignIssue = async (repo, campaignIssue) => {
    const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
    const evidence = await readCampaignAuthorityEvidence(repo, campaignIssue)
    const parsed = parseCampaign(issue.body, { evidence })
    if (!parsed.present || !parsed.valid) {
      campaignParseFailure(parsed, `campaign Issue #${campaignIssue} has invalid blocker-resolution completion evidence`)
    }
    if (normalizeIssueNumber(parsed.campaign?.campaign_issue) !== campaignIssue) {
      throw stateConflict(`campaign completion evidence is not bound to Campaign Issue #${campaignIssue}`)
    }
    return parsed
  }

  const readCampaignOwnership = async ({
    repo,
    taskIssue,
    prNumber,
    campaignIssue,
    campaignSlice,
    campaignBlockerId,
    projectionKind,
  }) => {
    const parsed = await readCampaignIssue(repo, campaignIssue)
    if (projectionKind === CAMPAIGN_PROJECTION_KINDS.SLICE) {
      const slice = parsed.campaign?.slices?.[String(campaignSlice)]
      if (!slice ||
        normalizeIssueNumber(slice.issue) !== taskIssue ||
        normalizePrNumber(slice.pr) !== prNumber) {
        throw stateConflict(`campaign Slice ${campaignSlice} is not durably allocated to Task Issue #${taskIssue} and PR #${prNumber}`)
      }
      return {
        verified: true,
        evidence_kind: 'campaign-projection',
        projectionKind,
        campaignIssue,
        campaignSlice,
        taskIssue,
        prNumber,
      }
    }

    const blocker = (parsed.campaign?.campaign_blockers ?? [])
      .find((candidate) => candidate?.id === campaignBlockerId)
    if (!blocker ||
      normalizeIssueNumber(blocker.evidence?.issue) !== taskIssue ||
      normalizePrNumber(blocker.evidence?.pr) !== prNumber) {
      throw stateConflict(`campaign blocker ${campaignBlockerId} is not durably allocated to Task Issue #${taskIssue} and PR #${prNumber}`)
    }
    return {
      verified: true,
      evidence_kind: 'campaign-projection',
      projectionKind,
      campaignIssue,
      campaignBlockerId,
      taskIssue,
      prNumber,
    }
  }

  const readNextCampaignAction = async ({ repo, campaignIssue }) => {
    const parsed = await readCampaignIssue(repo, campaignIssue)
    return selectNextCampaignAction(parsed.campaign)
  }

  const readCampaignBlockerResolutionPostconditions = async ({
    repo,
    campaignIssue,
    campaignBlockerId,
    taskIssue,
    prNumber,
    reviewedHead,
    mergeCommit,
    finalResultCommentId,
  }) => {
    const parsed = await readCampaignIssue(repo, campaignIssue)
    const durableNextAction = selectNextCampaignAction(parsed.campaign)
    return {
      task: {
        state: 'DONE',
        task_issue: `#${taskIssue}`,
        canonical_pr: `#${prNumber}`,
        reviewed_head: reviewedHead,
        merge_commit: mergeCommit,
        final_result_comment_id: String(finalResultCommentId),
        open_blockers: [],
        next_permitted_action: 'none on this task',
      },
      campaign: blockerResolutionCampaignPostconditions(
        parsed.campaign,
        campaignBlockerId,
        durableNextAction,
      ),
    }
  }

  const emptyCampaignSlice = () => ({
    status: 'NOT_STARTED',
    issue: null,
    pr: null,
    reviewed_head: null,
    merged_commit: null,
    authority_comment_ids: [],
    blocker_ids: [],
  })

  return {
    readManagedIssue,
    readPullRequest,
    readIssueComments,
    readFounderAuthorization: async (repo, issueNumber, commentId) => {
      const comment = readIssueComment(repo, issueNumber, commentId)
      const parsed = parseFounderMergeAuthorization(comment.body)
      if (parsed.author_login !== comment.user.login) {
        throw authorizationValidationFailure('Founder authorization Markdown author does not match the authenticated live GitHub comment author')
      }
      const superseded = readIssueComments(repo, issueNumber).some((entry) => {
        return String(entry.id) !== String(comment.id) && commentSupersedesId(entry.body, comment.id)
      })
      return {
        ...parsed,
        comment_id: String(comment.id),
        immutable_comment_reference: true,
        comment_sha256: createHash('sha256').update(String(comment.body ?? ''), 'utf8').digest('hex'),
        non_superseded: parsed.non_superseded === true && !superseded,
        superseded_by: superseded ? 'live-issue-comment-evidence' : (parsed.superseded_by ?? null),
      }
    },
    readCampaignBlockerResolutionPostconditions,
    readCampaignOwnership,
    readNextCampaignAction,
    readReviewVerdict: async (repo, issueNumber, commentId) => {
      const comment = readIssueComment(repo, issueNumber, commentId)
      return parseProductionMergeReviewVerdict(comment.body, comment.id)
    },
    readTrustedFounderLogins,
    readCampaignAuthorityEvidence,
    markReadyForReview: async (prNumber, repo) => { runGh(['pr', 'ready', String(prNumber), '--repo', repo]) },
    mergePullRequest: async ({ prNumber, repo, expectedHead }) => {
      runGh(['pr', 'merge', String(prNumber), '--repo', repo, '--merge', '--match-head-commit', expectedHead])
      return {}
    },
    verifyCommitOnProtectedBase: async ({ repo, base, commit }) => {
      const comparison = JSON.parse(runGh(['api', `repos/${repo}/compare/${commit}...${base}`]))
      return comparison.status === 'ahead' || comparison.status === 'identical'
    },
    postFinalResult: async ({ repo, issueNumber, body }) => {
      return JSON.parse(runGh([
        'api', '-X', 'POST', `repos/${repo}/issues/${issueNumber}/comments`, '--input', '-',
      ], { input: JSON.stringify({ body }) }))
    },
    closeIssueCompleted: async (issueNumber, repo) => {
      runGh(['issue', 'close', String(issueNumber), '--repo', repo, '--reason', 'completed'])
    },
    writeTaskDone: async ({ repo, issueNumber, expectedState, mergeCommit, resultCommentId, prNumber, reviewedHead }) => {
      const live = await readManagedIssue(issueNumber, repo)
      if (live.managedState.state === 'DONE' && live.managedState.merged_commit_sha === mergeCommit) return { state: 'DONE' }
      if (!sameTerminalBinding(live.managedState, expectedState)) {
        throw stateConflict('Task DONE CAS/lease precondition changed before direct projection')
      }
      const nextState = {
        ...structuredClone(live.managedState),
        state: 'DONE',
        merged_commit_sha: mergeCommit,
        latest_result_comment_id: String(resultCommentId),
        open_blockers: [],
        next_permitted_action: 'none on this task',
        updated_at: new Date().toISOString(),
        updated_by: 'Founder-authorized merge transport',
      }
      await writeIssueBodyWithLease({
        repo,
        issueNumber,
        expectedBody: live.body,
        nextBody: stateBlockReplacement(live.body, nextState),
        transitionIdentity: `merge-completion:${issueNumber}:${prNumber}:${reviewedHead}:${mergeCommit}`,
        holder: 'mission-control-merge',
        repoFlag: repo,
        deps: { runGh },
      })
      const verified = await readManagedIssue(issueNumber, repo)
      if (verified.managedState.state !== 'DONE' || verified.managedState.merged_commit_sha !== mergeCommit) {
        throw stateConflict('Task DONE direct projection did not survive postcondition verification')
      }
      return { state: 'DONE' }
    },
    projectCampaignSliceDone: async ({ repo, campaignIssue, campaignSlice, taskIssue, prNumber, reviewedHead, mergeCommit, authorizationCommentId }) => {
      const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body,state']))
      const hasExpansionAuthority = /campaign_expansion_authority\s*:/.test(String(issue.body ?? ''))
      const evidence = hasExpansionAuthority ? await readCampaignAuthorityEvidence(repo, campaignIssue) : undefined
      const parsed = parseCampaign(issue.body, { evidence })
      if (!parsed.present || !parsed.valid) campaignParseFailure(parsed, `campaign Issue #${campaignIssue} has invalid projection`)
      const key = String(campaignSlice)
      const priorSlice = parsed.campaign?.slices?.[key]
      if (!priorSlice || (priorSlice.issue != null && normalizeIssueNumber(priorSlice.issue) !== taskIssue)) {
        throw stateConflict(`campaign slice ${key} is not bound to Task Issue #${taskIssue}`)
      }
      const nextCampaign = {
        ...structuredClone(parsed.campaign),
        slices: {
          ...structuredClone(parsed.campaign.slices),
          [key]: {
            ...structuredClone(priorSlice),
            status: 'DONE',
            issue: `#${taskIssue}`,
            pr: `#${prNumber}`,
            reviewed_head: reviewedHead,
            merged_commit: mergeCommit,
            blocker_ids: [],
            authority_comment_ids: [...new Set([...(priorSlice.authority_comment_ids ?? []), String(authorizationCommentId)])],
          },
        },
        updated_at: new Date().toISOString(),
        updated_by: 'Founder-authorized merge transport',
      }
      const transition = validateCampaignTransition(parsed.campaign, nextCampaign, {
        mode: 'lifecycle',
        targetSlice: key,
        evidence,
      })
      if (!transition.valid) {
        throw stateConflict(`${transition.code ?? 'CAMPAIGN_TRANSITION_INVALID'}: ${transition.reason}`)
      }
      const replacement = replaceCampaignBlock(issue.body, nextCampaign, { evidence })
      if (!replacement.unchanged) {
        await writeIssueBodyWithLease({
          repo,
          issueNumber: campaignIssue,
          expectedBody: issue.body,
          nextBody: replacement.body,
          transitionIdentity: `merge-campaign:${campaignIssue}:${key}:${taskIssue}:${mergeCommit}`,
          holder: 'mission-control-merge',
          repoFlag: repo,
          deps: { runGh },
        })
      }
      const verified = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
      const verifiedEvidence = hasExpansionAuthority ? await readCampaignAuthorityEvidence(repo, campaignIssue) : undefined
      const verifiedCampaign = parseCampaign(verified.body, { evidence: verifiedEvidence })
      if (!verifiedCampaign.valid || verifiedCampaign.campaign?.slices?.[key]?.status !== 'DONE') {
        campaignParseFailure(verifiedCampaign, `campaign slice ${key} DONE projection did not survive postcondition verification`)
      }
      return { status: 'DONE', campaignIssue, campaignSlice }
    },
    projectCampaignBlockerResolved: async ({
      repo,
      campaignIssue,
      campaignBlockerId,
      taskIssue,
      prNumber: _prNumber,
      reviewedHead: _reviewedHead,
      mergeCommit,
      authorizationCommentId: _authorizationCommentId,
      nextAction,
    }) => {
      const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body,state']))
      const hasExpansionAuthority = /campaign_expansion_authority\s*:/.test(String(issue.body ?? ''))
      const evidence = await readCampaignAuthorityEvidence(repo, campaignIssue)
      const priorParsed = parseCampaign(issue.body, hasExpansionAuthority ? { evidence } : undefined)
      if (!priorParsed.present || !priorParsed.valid) campaignParseFailure(priorParsed, `campaign Issue #${campaignIssue} has invalid blocker-resolution projection`)

      const priorCampaign = structuredClone(priorParsed.campaign)
      const authority = priorCampaign.campaign_expansion_authority ?? deriveCampaignExpansionAuthority(repo, campaignIssue, evidence)
      const currentMaxSlice = Math.max(...Object.keys(priorCampaign.slices).map(Number))
      const authorizedMaxSlice = Number(authority.authorized_max_slice)
      if (authorizedMaxSlice !== BLOCKER_RESOLUTION_MAX_SLICE) {
        throw stateConflict('blocker-resolution is bounded to the Founder-approved campaign range through Slice 11')
      }
      for (const key of expectedSliceKeys(LEGACY_MAX_SLICE - 3)) {
        if (priorCampaign.slices[key]?.blocker_ids?.includes(campaignBlockerId)) {
          throw stateConflict(`blocker-resolution may not mutate untouched campaign Slice ${key}`)
        }
      }
      const nextSlices = structuredClone(priorCampaign.slices)
      for (const key of expectedSliceKeys(authorizedMaxSlice).slice(currentMaxSlice)) {
        nextSlices[key] = emptyCampaignSlice()
      }
      for (const slice of Object.values(nextSlices)) {
        slice.blocker_ids = slice.blocker_ids.filter((id) => id !== campaignBlockerId)
      }
      const nextCampaign = {
        ...priorCampaign,
        campaign_lifecycle: 'ACTIVE',
        campaign_expansion_authority: authority,
        slices: nextSlices,
        root_script_map: {
          ...priorCampaign.root_script_map,
          validation_status: authorizedMaxSlice > LEGACY_MAX_SLICE
            ? 'PENDING_EXPANDED_IMPLEMENTATION'
            : priorCampaign.root_script_map.validation_status,
        },
        campaign_blockers: priorCampaign.campaign_blockers.filter((blocker) => blocker.id !== campaignBlockerId),
        updated_at: new Date().toISOString(),
        updated_by: 'Founder-authorized merge transport',
      }
      const untouchedSlices = expectedSliceKeys(LEGACY_MAX_SLICE - 3)
        .every((key) => JSON.stringify(priorCampaign.slices[key]) === JSON.stringify(nextCampaign.slices[key]))
      if (!untouchedSlices) {
        throw stateConflict('blocker-resolution changed one or more protected campaign Slices 1–4')
      }
      const transition = validateCampaignTransition(priorCampaign, nextCampaign, {
        mode: 'blocker-resolution',
        blockerId: campaignBlockerId,
        evidence,
      })
      if (!transition.valid) {
        throw stateConflict(`${transition.code ?? 'CAMPAIGN_TRANSITION_INVALID'}: ${transition.reason}`)
      }
      const replacement = replaceCampaignBlock(issue.body, nextCampaign, { evidence })
      if (!replacement.unchanged) {
        await writeIssueBodyWithLease({
          repo,
          issueNumber: campaignIssue,
          expectedBody: issue.body,
          nextBody: replacement.body,
          transitionIdentity: `merge-campaign-blocker:${campaignIssue}:${campaignBlockerId}:${taskIssue}:${mergeCommit}`,
          holder: 'mission-control-merge',
          repoFlag: repo,
          deps: { runGh },
        })
      }
      const verified = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
      const verifiedEvidence = await readCampaignAuthorityEvidence(repo, campaignIssue)
      const verifiedCampaign = parseCampaign(verified.body, { evidence: verifiedEvidence })
      if (!verifiedCampaign.valid || verifiedCampaign.campaign?.campaign_blockers?.some((blocker) => blocker.id === campaignBlockerId)) {
        campaignParseFailure(verifiedCampaign, `campaign blocker ${campaignBlockerId} resolution did not survive postcondition verification`)
      }
      const verifiedSlice = verifiedCampaign.campaign?.slices?.['5']
      if (verifiedSlice?.status !== 'NOT_STARTED' || verifiedSlice.blocker_ids.includes(campaignBlockerId)) {
        throw stateConflict('blocker-resolution changed or failed to preserve Slice 5 NOT_STARTED state')
      }
      return {
        status: 'RESOLVED',
        campaignIssue,
        campaignBlockerId,
        postconditions: {
          campaign: blockerResolutionCampaignPostconditions(
            verifiedCampaign.campaign,
            campaignBlockerId,
            nextAction,
          ),
        },
      }
    },
    selectNextCampaignAction: async ({ repo, campaignIssue }) => {
      const issue = JSON.parse(runGh(['issue', 'view', String(campaignIssue), '--repo', repo, '--json', 'body']))
      const hasExpansionAuthority = /campaign_expansion_authority\s*:/.test(String(issue.body ?? ''))
      const evidence = hasExpansionAuthority ? await readCampaignAuthorityEvidence(repo, campaignIssue) : undefined
      const parsed = parseCampaign(issue.body, { evidence })
      if (!parsed.valid) campaignParseFailure(parsed, 'campaign evidence is unavailable while selecting the next action')
      return selectNextCampaignAction(parsed.campaign)
    },
    reconcile: async (issueNumber, repo) => {
      const stdout = runNode(
        ['../../mission-control-reconcile.mjs', String(issueNumber), '--repo', repo],
        { ...process.env, GH_REPO: repo },
      )
      const finalOutcome = stdout.match(/Mission Control reconciliation\s+(\S+):/)?.[1] ?? null
      const issue = await readManagedIssue(issueNumber, repo)
      return { finalOutcome, state: issue.managedState }
    },
  }
}

export async function runProductionMerge() {
  try {
    const argv = process.argv.slice(2)
    if (argv.includes('--help') || argv.includes('-h')) {
      const invocation = parseCommandInvocation('bemoat:mission-control:merge', argv)
      if (invocation.format === 'json') {
        process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
      } else {
        process.stdout.write(formatTextHelp(invocation.contract))
      }
      return
    }

    const options = parseArgs(argv)
    const result = await runFounderAuthorizedMerge({ ...options, deps: createProductionDeps() })
    process.stdout.write(`Mission Control merge transport ${result.outcome}: PR #${result.prNumber} at ${result.reviewedHead} -> ${result.mergeCommit}; Issue #${result.issueNumber} DONE.\n`)
  } catch (error) {
    if (error instanceof CliInvocationError) {
      process.stderr.write(`ERROR: [${error.classification}] ${error.message}\n`)
      process.exitCode = 1
      return
    }
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

