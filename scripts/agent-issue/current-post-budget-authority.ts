import { parseMissionControlState } from '../mission-control/domain/task-state.ts'
import type {
  AnalyzeExactHeadCi,
  FetchIssueCommentById,
  FetchPrByReference,
  FetchPullReviewCommentById,
  GitHubIssueComment,
} from './authority-domain-types.ts'
import {
  validateCurrentAuthorityState,
  validatePinnedFounderDecision,
  validateReviewEightCorrectionSource,
} from './current-post-budget-authority-internals.ts'
import {
  reconcilePinnedCurrentPr,
  validateHistoricalAuthority,
  validatePinnedFindingThread,
  validatePinnedReview7,
  validatePinnedSpecificationResult,
  validateReplacementDispatchSource,
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
  comments: GitHubIssueComment[]
  getDefaultRepo: (cwd: string) => string | null
  fetchIssueCommentById: FetchIssueCommentById
  fetchPullReviewCommentById: FetchPullReviewCommentById
  fetchPrByReference: FetchPrByReference
  analyzeExactHeadCi: AnalyzeExactHeadCi
}) {
  const parsed = parseMissionControlState(issueBody ?? '')
  const defaultRepo = getDefaultRepo(cwd)
  if (!parsed.valid || !parsed.state || !defaultRepo) return null
  const stateCheck = validateCurrentAuthorityState(parsed.state, issueNumber, defaultRepo)
  if (!stateCheck || !stateCheck.ok || !('authority' in stateCheck)) {
    if (!stateCheck) return null
    return { ok: false, errors: stateCheck.errors }
  }
  const { authority, decision, dispatch, reviewEightAuthorization, correctionDispatch, phase } = stateCheck

  const founderSource = fetchIssueCommentById(cwd, String(authority.comment_id ?? ''), env)
  const handoffSource = fetchIssueCommentById(cwd, String(authority.historical_handoff_comment_id ?? ''), env)
  const reviewThreeSource = fetchIssueCommentById(cwd, String(authority.historical_review_3_source_comment_id ?? ''), env)
  const specSource = fetchIssueCommentById(cwd, String(authority.specification_result_comment_id ?? ''), env)
  const reviewSevenSource = fetchIssueCommentById(cwd, String(authority.review_7_verdict_comment_id ?? ''), env)
  const reviewEightHandoffSource = reviewEightAuthorization
    ? fetchIssueCommentById(cwd, String(reviewEightAuthorization.handoff_comment_id ?? ''), env)
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

  let dispatchCheck: { ok: boolean; errors: string[] } = { ok: true, errors: [] }
  if (phase === 'consumed_current_dispatch') {
    if (!decision || !dispatch) {
      dispatchCheck = { ok: false, errors: ['STATE CONFLICT: replacement dispatch does not bind the authorized replacement base, PR, target, and exact finding set'] }
    } else {
      dispatchCheck = validateReplacementDispatchSource({ authority, decision, dispatch, comments, issueNumber, defaultRepo })
    }
  }

  let reviewEightCheck: { ok: boolean; errors: string[] } = { ok: true, errors: [] }
  if (phase === 'consumed_review_eight_dispatch') {
    if (!reviewEightAuthorization) {
      reviewEightCheck = { ok: false, errors: ['STATE CONFLICT: Review 8 correction HANDOFF source identity or timestamp is inconsistent'] }
    } else {
      reviewEightCheck = validateReviewEightCorrectionSource({
        authorization: reviewEightAuthorization,
        source: reviewEightHandoffSource?.ok ? reviewEightHandoffSource : null,
        state: parsed.state,
        issueNumber,
        defaultRepo,
      })
    }
  }

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

  const activeDispatch = correctionDispatch ?? dispatch
  if (!activeDispatch) {
    return { ok: false, errors: ['BLOCKED_EXTERNAL: consumed historical migration authority has no active current dispatch'] }
  }

  const prCheck = reconcilePinnedCurrentPr({
    cwd,
    env,
    dispatch: activeDispatch,
    state: parsed.state,
    defaultRepo,
    fetchPrByReference,
    analyzeExactHeadCi,
  })
  if (!prCheck.ok) return { ok: false, errors: prCheck.errors }

  const threadId = reviewSevenCheck.threadUrl.match(/#discussion_r([0-9]+)$/)?.[1]
  const threadSource = fetchPullReviewCommentById(cwd, threadId ?? '', env)
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
      reviewed_head: activeDispatch.implementation_head ?? activeDispatch.correction_base ?? '',
      findings: [threadCheck.finding],
    },
    livePr: prCheck.pr,
  }
}
