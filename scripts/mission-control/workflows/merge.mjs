#!/usr/bin/env node
import { createHelpEnvelopeV1, formatTextHelp } from '../../cli/command-help.mjs'
import { parseCommandInvocation } from '../../cli/command-invocation.mjs'

import { sameCampaignValue } from '../domain/campaign-equality.mjs'
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
import { validateBlockerResolutionPostconditions } from '../domain/merge-blocker-postconditions.mjs'
import { renderFinalResultBody } from '../domain/merge-final-result.mjs'
import { normalizeIssueNumber, normalizePrNumber } from '../domain/merge-issue-references.mjs'
import { resultCommentId } from '../domain/merge-result-comment-id.mjs'
import { blockedExternal, stateConflict } from '../domain/merge-errors.mjs'
import { validateDirectOwnership } from '../domain/merge-direct-ownership.mjs'
import { mergeCommitOid } from '../domain/merge-commit-oid.mjs'
import { normalizeIssueReason, normalizeIssueState } from '../domain/merge-issue-state.mjs'
import { parseMergeCliArgs } from '../domain/merge-cli-args.mjs'
import {
  renderMergeError,
  renderMergeSuccess,
} from '../domain/merge-cli-result-rendering.mjs'
import {
  SAFE_EXECUTION_BUNDLES,
  SAFE_EXECUTION_BUNDLE_SCOPES,
  validateSafeExecutionBundle,
} from '../domain/merge-safe-execution-bundle.mjs'
import {
  CAMPAIGN_PROJECTION_KINDS,
} from '../domain/merge-campaign-projection.mjs'
import { resolveCampaignMergeRoute } from '../domain/merge-campaign-admission.mjs'
import { flattenGhPages } from '../domain/merge-gh-pages.mjs'
import {
  AUTHORIZATION_VALIDATION_FAILURE,
  generateFounderMergeAuthorization,
  parseFounderMergeAuthorization,
  serializeFounderMergeAuthorization,
  validateFounderAuthorizationRecord,
  validateFounderMergeAuthorization,
  validateFounderMergeAuthorizationEvidence,
} from '../domain/merge-founder-authority.mjs'
import { createProductionMergeDeps } from '../adapters/merge-github.mjs'

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
export { normalizeIssueReason, normalizeIssueState }

const MERGE_COMPLETION_BUNDLE_KIND = 'merge-completion'
const MERGE_COMPLETION_AUTHORITY_SCOPE = 'merge'

export { SAFE_EXECUTION_BUNDLES, SAFE_EXECUTION_BUNDLE_SCOPES, validateSafeExecutionBundle }

function defaultMergeCompletionBundle() {
  return {
    kind: MERGE_COMPLETION_BUNDLE_KIND,
    authority_scope: MERGE_COMPLETION_AUTHORITY_SCOPE,
    terminal_outcome: 'Task DONE and campaign slice DONE; next action selected but not started',
    steps: SAFE_EXECUTION_BUNDLES['merge-completion'],
  }
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

    const options = parseMergeCliArgs(argv)
    const result = await runFounderAuthorizedMerge({ ...options, deps: createProductionMergeDeps() })
    process.stdout.write(renderMergeSuccess(result))
  } catch (error) {
    const rendering = renderMergeError(error)
    process[rendering.stream].write(rendering.output)
    process.exitCode = rendering.exitCode
  }
}
