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

function parseImmutableFindingDispositions(body = '') {
  const section = String(body).match(
    /###\s+Immutable finding disposition\s*\n([\s\S]*?)(?=\n###|\n##|$)/i,
  )?.[1] ?? ''
  const findings = []
  for (const line of section.split('\n')) {
    const match = line.match(/^\s*[-*]\s+((?:`[^`]+`\s*,?\s*)+):\s*(.+?)\s*$/)
    if (!match) continue
    const ids = [...match[1].matchAll(/`([^`]+)`/g)].map((entry) => entry[1].trim()).filter(Boolean)
    const description = match[2].trim()
    const disposition = /\bresolved\b/i.test(description)
      ? 'resolved'
      : /\b(?:open|unresolved|unproven|remain(?:s|ing)?)\b/i.test(description)
        ? 'open'
        : null
    if (!disposition || ids.length === 0) continue
    for (const findingId of ids) findings.push({ finding_id: findingId, disposition })
  }
  return findings
}

function failClosedReviewLag(kind, reason) {
  return { lag: false, kind, reason }
}

function classifyPostBudgetReviewLag(managedState, livePr, latestVerdict, exactHeadCi) {
  if (!livePr?.number || !livePr.headRefOid || !livePr.baseRefName) {
    return failClosedReviewLag('BLOCKED_EXTERNAL', 'post-budget Review 4 requires live PR and base evidence')
  }

  if (!exactHeadCi?.available || exactHeadCi.exactHeadVerified !== true) {
    if (exactHeadCi?.exactHeadVerified === false && exactHeadCi?.olderShaSuccess === true) {
      return failClosedReviewLag('STATE_CONFLICT', 'exact-head CI is stale for the live PR head')
    }
    return failClosedReviewLag('BLOCKED_EXTERNAL', 'exact-head CI is not verified for the live PR head')
  }

  const liveHead = normalizeAuthorityHead(livePr.headRefOid)
  if (!exactHeadMatches(exactHeadCi.headSha, liveHead)) {
    return failClosedReviewLag('STATE_CONFLICT', 'exact-head CI evidence does not bind the live PR head')
  }

  const managedPr = String(managedState.active_pr ?? '').replace(/^#/, '')
  if (!managedPr || managedPr !== String(livePr.number) ||
      normalizeAuthorityBase(managedState.approved_base) !== normalizeAuthorityBase(livePr.baseRefName)) {
    return failClosedReviewLag('STATE_CONFLICT', 'managed PR or approved base does not match the live PR')
  }

  const parsed = latestVerdict?.parsed ?? null
  const verdict = parsed?.verdict
  const reviewedHead = normalizeAuthorityHead(parsed?.headSha)
  const verdictPr = parsed?.prNumber == null ? null : String(parsed.prNumber)
  const verdictBase = normalizeAuthorityBase(parsed?.base)
  if (!verdict || !verdictPr || !reviewedHead || !verdictBase) {
    return failClosedReviewLag('STATE_CONFLICT', 'Review 4 verdict is missing canonical PR/base/head evidence')
  }
  if (verdictPr !== String(livePr.number) || verdictBase !== normalizeAuthorityBase(livePr.baseRefName)) {
    return failClosedReviewLag('STATE_CONFLICT', 'Review 4 verdict PR or base does not match the live PR')
  }
  if (!exactHeadMatches(reviewedHead, liveHead)) {
    return failClosedReviewLag('STATE_CONFLICT', 'Review 4 verdict exact head does not match the live PR')
  }

  const authorization = managedState.founder_decision
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization) ||
      authorization.status !== 'approved' || authorization.authority !== 'Founder' ||
      authorization.scope !== 'review' || authorization.review_number !== 4 ||
      !exactHeadMatches(authorization.reviewed_head, reviewedHead) ||
      typeof authorization.action !== 'string' || !authorization.action.trim() ||
      typeof authorization.authorized_at !== 'string' || !authorization.authorized_at.trim()) {
    return failClosedReviewLag('STATE_CONFLICT', 'Review 4 Founder authorization is missing or not exactly bound')
  }
  const action = authorization.action
  if (!new RegExp(`\\bPR\\s*#${String(livePr.number).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(action) ||
      !action.toLowerCase().includes(reviewedHead)) {
    return failClosedReviewLag('STATE_CONFLICT', 'Review 4 Founder authorization does not bind the live PR and exact head')
  }

  const verdictCommentId = latestVerdict?.comment?.id
  if (!/^\d+$/.test(String(verdictCommentId ?? ''))) {
    return failClosedReviewLag('STATE_CONFLICT', 'Review 4 verdict comment identity is missing')
  }

  const findingDispositions = parseImmutableFindingDispositions(latestVerdict?.comment?.body ?? '')
  const fallbackLineage = Array.isArray(managedState.finding_lineage)
    ? managedState.finding_lineage
      .filter((finding) => finding && typeof finding === 'object' && !Array.isArray(finding))
      .map((finding) => ({
        finding_id: String(finding.finding_id ?? ''),
        disposition: String(finding.disposition ?? ''),
      }))
      .filter((finding) => finding.finding_id && finding.disposition)
    : []
  const immutableFindings = findingDispositions.length > 0 ? findingDispositions : fallbackLineage
  if (immutableFindings.length === 0) {
    return failClosedReviewLag('STATE_CONFLICT', 'Review 4 immutable finding lineage is missing')
  }

  if (!['ELIGIBLE FOR FOUNDER REVIEW', 'BLOCKED FOR FOUNDER DECISION'].includes(verdict)) {
    return failClosedReviewLag('STATE_CONFLICT', `Review 4 verdict ${verdict} cannot be projected from the Founder review gate`)
  }

  return {
    lag: true,
    kind: 'DETERMINISTIC_RECONCILIATION',
    reason: 'authorized post-budget Review 4 evidence is ahead of bookkeeping',
    postBudget: true,
    findingDispositions: immutableFindings,
  }
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

export function classifyReviewLag(managedState, livePr, latestVerdict = null, exactHeadCi = null) {
  const postBudgetCandidate = managedState?.state === 'BLOCKED_FOR_FOUNDER_DECISION' &&
    managedState.review_cycle === 3 &&
    managedState.full_review_count === 1 &&
    Array.isArray(managedState.post_budget_reviews) &&
    managedState.post_budget_reviews.length === 0 &&
    managedState.active_pr &&
    managedState.current_head
  if (!managedState?.state || !latestVerdict?.parsed?.verdict) {
    if (postBudgetCandidate) {
      return failClosedReviewLag('BLOCKED_EXTERNAL', 'post-budget Review 4 verdict evidence is unavailable')
    }
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

  if (postBudgetCandidate) {
    return classifyPostBudgetReviewLag(managedState, livePr, latestVerdict, exactHeadCi)
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
