#!/usr/bin/env node

const PRE_DELIVERY_STATES = new Set(['READY', 'IN_PROGRESS'])
const CORE_VERDICTS = new Set([
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
])

const VERDICT_TO_STATE = {
  'CORRECTION REQUIRED': {
    1: 'CORRECTION_REQUIRED_1',
    2: 'CORRECTION_REQUIRED_2',
    3: 'CORRECTION_REQUIRED_3',
  },
  'ELIGIBLE FOR FOUNDER REVIEW': 'ELIGIBLE_FOR_FOUNDER_REVIEW',
  'BLOCKED FOR FOUNDER DECISION': 'BLOCKED_FOR_FOUNDER_DECISION',
  'BLOCKED EXTERNAL': 'BLOCKED_EXTERNAL',
  'STATE CONFLICT': 'STATE_CONFLICT',
}

/**
 * @param {string} body
 */
export function parseRoleCommentBody(body = '') {
  const heading = body.match(/^##\s+(HANDOFF|RESULT|REVIEW_VERDICT)\s*$/m)?.[1] ?? null
  if (!heading) {
    return { role: null, body, prNumber: null, headSha: null, verdict: null, managedStateLine: null }
  }

  const prFromUrl = body.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/)?.[1] ?? null
  const prFromHash = body.match(/\bPR\s*#(\d+)\b/i)?.[1] ?? null
  const headFromState = body.match(/\*\*State:\*\*[^\n]*head\s+`([0-9a-f]{7,40})`/i)?.[1] ?? null
  const headFromPrLine = body.match(/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*·\s*`([0-9a-f]{7,40})`/i)?.[1] ?? null
  const headFromExact = body.match(/\*\*Exact head reviewed:\*\*\s*`([0-9a-f]{7,40})`/i)?.[1] ?? null
  const headSha =
    headFromState ||
    headFromPrLine ||
    headFromExact ||
    (body.match(/head\s+`([0-9a-f]{7,40})`/i)?.[1] ?? null)
  const verdict = body.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null
  const managedStateLine = body.match(/^\*\*Managed state:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null

  return {
    role: heading,
    body,
    prNumber: prFromUrl || prFromHash,
    headSha,
    verdict,
    managedStateLine,
  }
}

/**
 * @param {Array<{ body?: string, createdAt?: string }>} comments
 * @param {'RESULT' | 'REVIEW_VERDICT'} role
 */
export function findLatestRoleComment(comments = [], role) {
  const matches = comments
    .map((comment) => ({ comment, parsed: parseRoleCommentBody(comment.body ?? '') }))
    .filter((entry) => entry.parsed.role === role)

  if (matches.length === 0) return null

  matches.sort((left, right) => {
    const leftTime = Date.parse(left.comment.createdAt ?? '') || 0
    const rightTime = Date.parse(right.comment.createdAt ?? '') || 0
    return rightTime - leftTime
  })

  return matches[0]
}

export function classifyDeliveryLag(managedState, livePr, exactHeadCi, latestResult = null) {
  if (!managedState?.state || !PRE_DELIVERY_STATES.has(managedState.state)) {
    return { lag: false, kind: null, reason: 'state is not pre-delivery' }
  }

  const stalePointers =
    managedState.active_pr == null ||
    managedState.current_head == null ||
    managedState.state !== 'AWAITING_REVIEW_1'

  if (!stalePointers) {
    return { lag: false, kind: null, reason: 'delivery state already recorded' }
  }

  if (!livePr?.number || !livePr.headRefOid) {
    return { lag: true, kind: 'INCOMPLETE_DELIVERY', reason: 'missing live PR evidence' }
  }

  const resultPr = latestResult?.parsed?.prNumber ?? null
  if (latestResult && !resultPr) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'RESULT PR identifier missing' }
  }
  if (resultPr && String(resultPr) !== String(livePr.number)) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'RESULT PR does not match live PR' }
  }

  const resultHead = latestResult?.parsed?.headSha ?? null
  const headsAlign =
    !resultHead || resultHead === livePr.headRefOid || resultHead.startsWith(livePr.headRefOid.slice(0, 7))

  if (!headsAlign) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'RESULT head does not match live PR head' }
  }

  if (exactHeadCi && exactHeadCi.exactHeadVerified === false) {
    return { lag: true, kind: 'INCOMPLETE_DELIVERY', reason: 'exact-head CI not verified' }
  }

  if (!latestResult) {
    return { lag: true, kind: 'INCOMPLETE_DELIVERY', reason: 'delivery RESULT not found' }
  }

  return { lag: true, kind: 'DETERMINISTIC_RECONCILIATION', reason: 'unambiguous delivery evidence' }
}

export function classifyReviewLag(managedState, livePr, latestVerdict = null) {
  if (!managedState?.state || !latestVerdict?.parsed?.verdict) {
    return { lag: false, kind: null, reason: 'no review verdict evidence' }
  }

  const awaitingStates = /^AWAITING_REVIEW_\d+$/
  const correctionStates = /^CORRECTION_REQUIRED_\d+$/
  const verdict = latestVerdict.parsed.verdict
  const reviewedHead = latestVerdict.parsed.headSha

  if (!CORE_VERDICTS.has(verdict)) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'invalid review verdict enum' }
  }

  const verdictPr = latestVerdict.parsed.prNumber ?? null
  if (livePr?.number && !verdictPr) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'REVIEW_VERDICT PR identifier missing' }
  }
  if (verdictPr && livePr?.number && String(verdictPr) !== String(livePr.number)) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'REVIEW_VERDICT PR does not match live PR' }
  }

  if (reviewedHead && livePr?.headRefOid && reviewedHead !== livePr.headRefOid) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'verdict head does not match live PR head' }
  }

  const expectedState = resolveVerdictState(verdict, managedState.review_cycle ?? 0)
  if (managedState.state === expectedState && managedState.last_reviewed_head === reviewedHead) {
    return { lag: false, kind: null, reason: 'review state already recorded' }
  }

  if (awaitingStates.test(managedState.state) || correctionStates.test(managedState.state)) {
    return { lag: true, kind: 'DETERMINISTIC_RECONCILIATION', reason: 'post-review bookkeeping lag' }
  }

  return { lag: false, kind: null, reason: 'state does not indicate review lag' }
}

export function classifyMergeDrift(authorizedHead, liveHead) {
  if (!authorizedHead || !liveHead) {
    return { drift: true, reason: 'missing authorized or live head for merge transition' }
  }
  if (authorizedHead !== liveHead) {
    return { drift: true, reason: 'authorized merge head does not match live PR head' }
  }
  return { drift: false, reason: null }
}

export function isGenuineStateConflict(evidence = {}) {
  if (evidence.competingPrs) return true
  if (evidence.headMismatch) return true
  if (evidence.staleCi) return true
  if ((evidence.stateConflictBlockers ?? []).some((blocker) => blocker.includes('STATE_CONFLICT'))) {
    return true
  }
  return false
}

export function proposeDeliveryReconciliation(evidence) {
  const prNumber = String(evidence.livePr.number)
  const head = evidence.latestResult?.parsed?.headSha || evidence.livePr.headRefOid
  const approvedBase = evidence.approvedBase || evidence.livePr.baseRefName || 'main'

  return {
    state: 'AWAITING_REVIEW_1',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: approvedBase,
    active_task_issue: evidence.activeTaskIssue ? `"#${evidence.activeTaskIssue}"` : null,
    active_pr: `"#${prNumber}"`,
    current_head: head,
    last_reviewed_head: null,
    next_permitted_action: `Reviewer performs bounded Review 1 on PR #${prNumber} at exact head ${head}.`,
    material_change_status: 'none',
  }
}

export function resolveVerdictState(verdict, currentReviewCycle = 0) {
  if (verdict === 'CORRECTION REQUIRED') {
    const nextCycle = Math.min(currentReviewCycle + 1, 3)
    return VERDICT_TO_STATE['CORRECTION REQUIRED'][nextCycle] ?? 'CORRECTION_REQUIRED_3'
  }
  return VERDICT_TO_STATE[verdict] ?? 'STATE_CONFLICT'
}

export function proposeReviewReconciliation(input) {
  const reviewCycle = input.reviewCycle ?? 0
  const nextCycle = Math.min(reviewCycle + 1, 3)
  const nextFullReviewCount =
    input.verdict === 'CORRECTION REQUIRED'
      ? Math.min((input.fullReviewCount ?? reviewCycle) + 1, 3)
      : Math.max(input.fullReviewCount ?? reviewCycle, 1)

  return {
    state: resolveVerdictState(input.verdict, reviewCycle),
    review_cycle: nextCycle,
    full_review_count: input.verdict === 'CORRECTION REQUIRED' ? nextFullReviewCount : Math.max(nextFullReviewCount, 1),
    last_reviewed_head: input.reviewedHead,
    next_permitted_action: nextActionForVerdict(input.verdict, nextCycle),
  }
}

function nextActionForVerdict(verdict, reviewCycle) {
  if (verdict === 'CORRECTION REQUIRED') {
    return `Dev posts correction ## RESULT, then Review ${Math.min(reviewCycle + 1, 3)} on the corrected head.`
  }
  if (verdict === 'ELIGIBLE FOR FOUNDER REVIEW') {
    return 'Founder merge authorization required before merge.'
  }
  if (verdict === 'BLOCKED FOR FOUNDER DECISION') {
    return 'Founder Approve or Decline on remaining Blocker/Critical; no implementation prompt until Approve.'
  }
  if (verdict === 'BLOCKED EXTERNAL') {
    return 'Resolve external blocker before continuing.'
  }
  return 'Mission Control must classify contradictory evidence.'
}

export function founderMergeTransitionAuthorized({ mergeAuthorized = false, migrationAuthorized = false, deployAuthorized = false } = {}) {
  return {
    mergeAllowed: mergeAuthorized,
    migrationAllowed: migrationAuthorized,
    deployAllowed: deployAuthorized,
    boundedSequence: mergeAuthorized && !migrationAuthorized && !deployAuthorized,
  }
}

export function analyzeReconciliation(context) {
  const genuineConflict = isGenuineStateConflict({
    stateConflictBlockers: context.stateConflictBlockers,
    headMismatch: Boolean(
      context.managedState?.current_head &&
        context.livePr?.headRefOid &&
        context.managedState.current_head !== context.livePr.headRefOid,
    ),
    staleCi: context.exactHeadCi?.exactHeadVerified === false && context.exactHeadCi?.olderShaSuccess === true,
  })

  const deliveryLag = classifyDeliveryLag(
    context.managedState,
    context.livePr,
    context.exactHeadCi,
    context.latestResult,
  )
  const reviewLag = classifyReviewLag(context.managedState, context.livePr, context.latestVerdict)

  const result = {
    genuineConflict,
    delivery: deliveryLag,
    review: reviewLag,
    proposal: null,
  }

  if (genuineConflict) {
    return result
  }

  if (deliveryLag.kind === 'DETERMINISTIC_RECONCILIATION' && context.livePr) {
    result.proposal = {
      type: 'delivery',
      fields: proposeDeliveryReconciliation({
        livePr: context.livePr,
        activeTaskIssue: context.activeTaskIssue,
        approvedBase: context.managedState?.approved_base,
        latestResult: context.latestResult,
      }),
    }
  } else if (reviewLag.kind === 'DETERMINISTIC_RECONCILIATION' && context.latestVerdict?.parsed?.verdict) {
    result.proposal = {
      type: 'review',
      fields: proposeReviewReconciliation({
        verdict: context.latestVerdict.parsed.verdict,
        reviewedHead: context.latestVerdict.parsed.headSha || context.livePr?.headRefOid,
        reviewCycle: context.managedState?.review_cycle ?? 0,
        fullReviewCount: context.managedState?.full_review_count ?? 0,
      }),
    }
  }

  return result
}
