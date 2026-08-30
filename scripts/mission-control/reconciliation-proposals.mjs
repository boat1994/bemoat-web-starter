import {
  headsAlign,
  normalizeAuthorityBase,
  normalizeAuthorityHead,
} from './review-verdict-binding.mjs'
import {
  classifyPostBudgetReview4ReopenCorrection,
  isPostBudgetReview4ReopenCorrectionContract,
  validatePostBudgetManagedState,
} from './domain/task-state-authorization.ts'
import { normalizeTransitionIdentity, serializeTransitionIdentity } from './transition-identity.mjs'

const PRE_DELIVERY_STATES = new Set(['READY', 'IN_PROGRESS', 'CORRECTION_REQUIRED_1', 'CORRECTION_REQUIRED_2'])

function exactHeadMatches(left, right) {
  const normalizedLeft = normalizeAuthorityHead(left)
  const normalizedRight = normalizeAuthorityHead(right)
  return Boolean(
    normalizedLeft && normalizedRight &&
    normalizedLeft.length === 40 && normalizedRight.length === 40 &&
    normalizedLeft === normalizedRight,
  )
}

function bindSelectedCurrentResult(state, currentResult) {
  const comment = currentResult?.comment
  if (!comment || comment.id == null || typeof comment.body !== 'string') return state
  return { ...state, latest_result_comment_id: String(comment.id), latest_transition_identity: serializeTransitionIdentity(normalizeTransitionIdentity(comment.body, { role: 'RESULT' })) }
}

function validateReopenDelivery(state, currentResult, { requireCurrentResult = false } = {}) {
  if (!requireCurrentResult && !currentResult?.comment) return state
  const validation = validatePostBudgetManagedState(
    state,
    Array.isArray(state.post_budget_reviews) ? state.post_budget_reviews : [],
    currentResult,
  )
  if (!validation.valid) {
    const error = new Error(`STATE_CONFLICT: ${validation.reason}`)
    error.classification = 'STATE_CONFLICT'
    throw error
  }
  return state
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
  if (isPostBudgetReview4ReopenCorrectionContract(managedState)) {
    const reopen = classifyPostBudgetReview4ReopenCorrection(managedState)
    if (reopen.ok && reopen.phase === 'delivered' && exactHeadMatches(managedState.current_head, head)) {
      return validateReopenDelivery({ ...structuredClone(managedState), current_head: head, updated_at: updatedAt, updated_by: updatedBy }, evidence.latestResult, { requireCurrentResult: true })
    }
    if (!reopen.ok || reopen.phase !== 'dispatched') {
      const error = new Error('STATE_CONFLICT: post-Review 4 reopen correction allows exactly one delivery')
      error.classification = 'STATE_CONFLICT'
      throw error
    }
    const proposal = bindSelectedCurrentResult({ ...structuredClone(managedState), state: 'AWAITING_REVIEW_3', review_cycle: 3, full_review_count: 1, approved_base: approvedBase, active_task_issue: evidence.activeTaskIssue ? `#${evidence.activeTaskIssue}` : managedState.active_task_issue, active_pr: `#${prNumber}`, current_head: head, last_reviewed_head: managedState.last_reviewed_head, founder_correction_authorization: { ...structuredClone(reopen.authorization), correction_deliveries: 1 }, next_permitted_action: `Reviewer performs bounded Delta Review on PR #${prNumber} at exact head ${head}.`, material_change_status: 'none', updated_at: updatedAt, updated_by: updatedBy }, evidence.latestResult)
    return validateReopenDelivery(proposal, evidence.latestResult)
  }
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
