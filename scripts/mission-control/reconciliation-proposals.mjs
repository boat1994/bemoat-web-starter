import {
  headsAlign,
  normalizeAuthorityBase,
  normalizeAuthorityHead,
} from './review-verdict-binding.mjs'
export { proposeReviewReconciliation } from './review-verdict-projection.ts'

const PRE_DELIVERY_STATES = new Set(['READY', 'IN_PROGRESS', 'CORRECTION_REQUIRED_1', 'CORRECTION_REQUIRED_2'])
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
  },
  'ELIGIBLE FOR FOUNDER REVIEW': 'ELIGIBLE_FOR_FOUNDER_REVIEW',
  'BLOCKED FOR FOUNDER DECISION': 'BLOCKED_FOR_FOUNDER_DECISION',
  'BLOCKED EXTERNAL': 'BLOCKED_EXTERNAL',
  'STATE CONFLICT': 'STATE_CONFLICT',
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

  const resultHead = normalizeAuthorityHead(latestResult?.parsed?.headSha)
  const liveHead = normalizeAuthorityHead(livePr.headRefOid)
  const headsMatch = !resultHead || headsAlign(resultHead, liveHead)

  if (!headsMatch) {
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
  const reviewedHead = normalizeAuthorityHead(latestVerdict.parsed.headSha)
  const liveHead = normalizeAuthorityHead(livePr?.headRefOid)

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

  if (reviewedHead && liveHead && !headsAlign(reviewedHead, liveHead)) {
    return { lag: false, kind: 'STATE_CONFLICT', reason: 'verdict head does not match live PR head' }
  }

  const expectedState = resolveVerdictState(verdict, managedState.review_cycle ?? 0)
  if (
    managedState.state === expectedState &&
    normalizeAuthorityHead(managedState.last_reviewed_head) === reviewedHead
  ) {
    return { lag: false, kind: null, reason: 'review state already recorded' }
  }

  if (awaitingStates.test(managedState.state) || correctionStates.test(managedState.state)) {
    return { lag: true, kind: 'DETERMINISTIC_RECONCILIATION', reason: 'post-review bookkeeping lag' }
  }

  return { lag: false, kind: null, reason: 'state does not indicate review lag' }
}

export function proposeDeliveryReconciliation(evidence) {
  const prNumber = String(evidence.livePr.number)
  const head = bindDeliveryHead(evidence.latestResult?.parsed?.headSha, evidence.livePr.headRefOid)
  const liveBase = normalizeAuthorityBase(evidence.livePr.baseRefName)
  const resultBase = normalizeAuthorityBase(evidence.latestResult?.parsed?.base)
  const approvedBase = normalizeAuthorityBase(
    evidence.approvedBase ?? evidence.managedState?.approved_base ?? liveBase,
  )
  if (!liveBase || !resultBase || resultBase !== liveBase || approvedBase !== liveBase) {
    const error = new Error('EVIDENCE_CONFLICT: RESULT, approved state, and live PR must agree on the canonical base')
    error.classification = 'EVIDENCE_CONFLICT'
    throw error
  }
  const updatedAt = evidence.updatedAt ?? new Date().toISOString()
  const updatedBy = evidence.updatedBy ?? 'Mission Control'

  const managedState = evidence.managedState
  const correctionAuthorization = managedState?.founder_correction_authorization
  if (managedState?.state === 'IN_PROGRESS' && managedState.review_cycle === 3 &&
      managedState.full_review_count === 1 && correctionAuthorization?.status === 'consumed' &&
      correctionAuthorization?.for_review_number === 3) {
    return {
      ...structuredClone(managedState),
      state: 'BLOCKED_FOR_FOUNDER_DECISION',
      review_cycle: 3,
      full_review_count: 1,
      approved_base: approvedBase,
      active_task_issue: evidence.activeTaskIssue ? `#${evidence.activeTaskIssue}` : managedState.active_task_issue,
      active_pr: `#${prNumber}`,
      current_head: head,
      last_reviewed_head: managedState.last_reviewed_head,
      post_budget_reviews: [],
      founder_decision: {
        status: 'pending',
        authority: 'Founder',
        scope: 'review',
        review_number: 4,
        reviewed_head: head,
        action: 'Founder Approve or Decline a separately bound Review 4 authorization',
      },
      next_permitted_action: `Founder decides whether to authorize Review 4 on PR #${prNumber} at exact head ${head}; no Review 4 is authorized yet.`,
      material_change_status: 'founder_decision_required_for_review_4',
      updated_at: updatedAt,
      updated_by: updatedBy,
    }
  }

  const normalCorrectionTransitions = {
    CORRECTION_REQUIRED_1: 'AWAITING_REVIEW_2',
    CORRECTION_REQUIRED_2: 'AWAITING_REVIEW_3',
  }
  if (managedState && Object.hasOwn(normalCorrectionTransitions, managedState.state)) {
    const nextState = normalCorrectionTransitions[managedState.state]
    const nextReview = managedState.review_cycle + 1
    return {
      ...structuredClone(managedState),
      state: nextState,
      approved_base: approvedBase,
      active_task_issue: evidence.activeTaskIssue ? `#${evidence.activeTaskIssue}` : managedState.active_task_issue,
      active_pr: `#${prNumber}`,
      current_head: head,
      review_cycle: managedState.review_cycle,
      full_review_count: managedState.full_review_count,
      last_reviewed_head: managedState.last_reviewed_head,
      next_permitted_action: `Reviewer performs bounded Review ${nextReview} on PR #${prNumber} at exact head ${head}.`,
      material_change_status: 'none',
      updated_at: updatedAt,
      updated_by: updatedBy,
    }
  }

  return {
    state: 'AWAITING_REVIEW_1',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: approvedBase,
    active_task_issue: evidence.activeTaskIssue ? `#${evidence.activeTaskIssue}` : null,
    active_pr: `#${prNumber}`,
    current_head: head,
    last_reviewed_head: null,
    next_permitted_action: `Reviewer performs bounded Review 1 on PR #${prNumber} at exact head ${head}.`,
    material_change_status: 'none',
    updated_at: updatedAt,
    updated_by: updatedBy,
  }
}

export function resolveVerdictState(verdict, currentReviewCycle = 0) {
  if (verdict === 'CORRECTION REQUIRED') {
    const nextCycle = Math.min(currentReviewCycle + 1, 3)
    return VERDICT_TO_STATE['CORRECTION REQUIRED'][nextCycle] ?? 'STATE_CONFLICT'
  }
  return VERDICT_TO_STATE[verdict] ?? 'STATE_CONFLICT'
}

function bindDeliveryHead(resultHead, liveHead) {
  const normalizedResult = String(resultHead ?? '').trim().toLowerCase()
  const normalizedLive = String(liveHead ?? '').trim().toLowerCase()
  if (!normalizedResult || !normalizedLive) {
    const error = new Error('EVIDENCE_CONFLICT: RESULT and live PR must both provide a head')
    error.classification = 'EVIDENCE_CONFLICT'
    throw error
  }
  if (!headsAlign(normalizedResult, normalizedLive)) {
    const error = new Error('EVIDENCE_CONFLICT: RESULT head does not match verified live PR head')
    error.classification = 'EVIDENCE_CONFLICT'
    throw error
  }
  return normalizedLive
}
