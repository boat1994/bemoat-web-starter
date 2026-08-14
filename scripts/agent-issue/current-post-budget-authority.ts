import { parseMissionControlState } from '../mission-control/domain/task-state.ts'
import type { ExactHeadCiAnalysis } from './exact-head-ci.ts'
import {
  validateCurrentAuthorityState,
  validateHistoricalAuthority,
  validatePinnedFounderDecision,
  validateReplacementDispatchSource,
  validateReviewEightCorrectionSource,
} from './current-post-budget-authority-internals.ts'
import {
  reconcilePinnedCurrentPr,
  validatePinnedFindingThread,
  validatePinnedReview7,
  validatePinnedSpecificationResult,
} from './current-post-budget-authority-sources.ts'

export { validatePinnedFounderDecision }

export function recoverCurrentAuthority({
  cwd,
  env,
  issueNumber,
  issueBody,
  comments,
  getDefaultRepo,
  fetchIssueCommentById,
  fetchPullReviewCommentById,
  fetchPrByReference,
  analyzeExactHeadCi,
}: {
  cwd: string
  env: NodeJS.ProcessEnv
  issueNumber: number
  issueBody: string
  comments: Array<Record<string, unknown>>
  getDefaultRepo: (cwd: string) => string | null
  fetchIssueCommentById: (
    cwd: string,
    commentId: string | number,
    env: NodeJS.ProcessEnv,
  ) => { ok: false; reason: string } | { ok: true; comment: unknown }
  fetchPullReviewCommentById: (
    cwd: string,
    commentId: string | number,
    env: NodeJS.ProcessEnv,
  ) => { ok: false; reason: string } | { ok: true; comment: unknown }
  fetchPrByReference: (
    cwd: string,
    reference: string,
    env: NodeJS.ProcessEnv,
  ) => { ok: false; reason: string } | { ok: true; pr: unknown }
  analyzeExactHeadCi: (pr: unknown) => ExactHeadCiAnalysis
}) {
  const parsed = parseMissionControlState(issueBody ?? '')
  const defaultRepo = getDefaultRepo(cwd)
  if (!parsed.valid || !parsed.state || !defaultRepo) return null
  const stateCheck = validateCurrentAuthorityState(parsed.state, issueNumber, defaultRepo)
  if (!stateCheck) return null
  if (!stateCheck.ok) return { ok: false, errors: stateCheck.errors }
  const { authority, decision, dispatch, reviewEightAuthorization, correctionDispatch, phase } = stateCheck

  const founderSource = fetchIssueCommentById(cwd, authority.comment_id, env)
  const handoffSource = fetchIssueCommentById(cwd, authority.historical_handoff_comment_id, env)
  const reviewThreeSource = fetchIssueCommentById(cwd, authority.historical_review_3_source_comment_id, env)
  const specSource = fetchIssueCommentById(cwd, authority.specification_result_comment_id, env)
  const reviewSevenSource = fetchIssueCommentById(cwd, authority.review_7_verdict_comment_id, env)
  const reviewEightHandoffSource = reviewEightAuthorization
    ? fetchIssueCommentById(cwd, reviewEightAuthorization.handoff_comment_id, env)
    : null
  if (!founderSource.ok || !handoffSource.ok || !reviewThreeSource.ok || !specSource.ok || !reviewSevenSource.ok ||
      (reviewEightHandoffSource && !reviewEightHandoffSource.ok)) {
    return { ok: false, errors: ['pinned authority source metadata is unavailable'] }
  }

  const founderCheck = validatePinnedFounderDecision({ authority, source: founderSource, issueNumber, defaultRepo })
  const historicalCheck = validateHistoricalAuthority({
    state: parsed.state,
    authority,
    comments,
    historicalHandoff: handoffSource,
    historicalReviewThree: reviewThreeSource,
    issueNumber,
    defaultRepo,
  })
  const specCheck = validatePinnedSpecificationResult({ authority, source: specSource, issueNumber, defaultRepo })
  const reviewSevenCheck = validatePinnedReview7({ authority, source: reviewSevenSource, issueNumber, defaultRepo })
  const dispatchCheck = phase === 'consumed_current_dispatch'
    ? validateReplacementDispatchSource({ authority, decision, dispatch, comments, issueNumber, defaultRepo })
    : { ok: true, errors: [] }
  const reviewEightCheck = phase === 'consumed_review_eight_dispatch'
    ? validateReviewEightCorrectionSource({
        authorization: reviewEightAuthorization,
        source: reviewEightHandoffSource,
        state: parsed.state,
        issueNumber,
        defaultRepo,
      })
    : { ok: true, errors: [] }

  const earlyErrors = [
    ...founderCheck.errors,
    ...historicalCheck.errors,
    ...specCheck.errors,
    ...reviewSevenCheck.errors,
    ...dispatchCheck.errors,
    ...reviewEightCheck.errors,
  ]
  if (earlyErrors.length > 0 || !reviewSevenCheck.threadUrl) {
    return { ok: false, errors: earlyErrors.length > 0 ? earlyErrors : ['pinned Review 7 does not pin the original finding thread'] }
  }

  if (phase === 'approved_unconsumed') {
    return { ok: false, errors: ['BLOCKED_EXTERNAL: approved migration authority awaits its authorized HANDOFF consumption'] }
  }
  if (phase == null || !['consumed_current_dispatch', 'consumed_review_eight_dispatch'].includes(phase)) {
    return { ok: false, errors: ['BLOCKED_EXTERNAL: consumed historical migration authority is not an active current dispatch'] }
  }

  const prCheck = reconcilePinnedCurrentPr({
    cwd,
    env,
    dispatch: correctionDispatch ?? dispatch,
    state: parsed.state,
    defaultRepo,
    fetchPrByReference,
    analyzeExactHeadCi,
  })
  if (!prCheck.ok) return { ok: false, errors: prCheck.errors }

  const threadId = reviewSevenCheck.threadUrl.match(/#discussion_r([0-9]+)$/)?.[1]
  const threadSource = fetchPullReviewCommentById(cwd, threadId!, env)
  if (!threadSource.ok) {
    return { ok: false, errors: ['pinned finding thread source metadata is unavailable'] }
  }
  const threadCheck = validatePinnedFindingThread({
    authority,
    source: threadSource,
    threadUrl: reviewSevenCheck.threadUrl,
  })
  if (!threadCheck.ok || !threadCheck.finding) {
    return { ok: false, errors: threadCheck.errors }
  }

  return {
    ok: true,
    contract: {
      mode: 'implementation_pr',
      reviewed_head: (correctionDispatch ?? dispatch).implementation_head ?? dispatch.correction_base,
      findings: [threadCheck.finding],
    },
    livePr: prCheck.pr,
  }
}
