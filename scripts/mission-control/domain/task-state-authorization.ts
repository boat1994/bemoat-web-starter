import { normalizeAuthorityBase, parseRoleCommentBody } from '../review-verdict-binding.mjs'
import { normalizeTransitionIdentity, transitionIdentityMatches } from '../transition-identity.mjs'

type JsonRecord = Record<string, unknown>
type PostBudgetReviewValidation =
  | { valid: true; reviews: JsonRecord[] }
  | { valid: false; reason: string }
type BoundReviewAuthorizationResult =
  | { valid: true; fingerprint: string }
  | { valid: false; reason: string }

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const postBudgetReviewVerdicts = new Set([
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
])

function isFounderAuthorization(value: unknown, scope: string): value is JsonRecord {
  return isRecord(value) &&
    value.status === 'approved' && value.authority === 'Founder' && value.scope === scope &&
    typeof value.action === 'string' && value.action.length > 0 &&
    typeof value.authorized_at === 'string' && value.authorized_at.length > 0
}

function authorizationFingerprint(authorization: JsonRecord) {
  return JSON.stringify({
    status: authorization.status,
    authority: authorization.authority,
    scope: authorization.scope,
    action: authorization.action,
    authorized_at: authorization.authorized_at,
    review_number: authorization.review_number ?? authorization.for_review_number ?? null,
    reviewed_head: authorization.reviewed_head ?? null,
    finding_ids: authorization.finding_ids ?? null,
  })
}

function validateBoundReviewAuthorization(
  authorization: unknown,
  review: JsonRecord,
): BoundReviewAuthorizationResult {
  if (!isFounderAuthorization(authorization, 'review')) {
    return { valid: false, reason: `post-budget review authorization is required for Review ${review.review_number}` }
  }
  if (!Number.isInteger(authorization.review_number) || authorization.review_number !== review.review_number) {
    return { valid: false, reason: `post-budget review authorization must bind to Review ${review.review_number}` }
  }
  if (typeof authorization.reviewed_head !== 'string' || authorization.reviewed_head.length === 0 ||
      authorization.reviewed_head !== review.reviewed_head) {
    return { valid: false, reason: `post-budget review authorization must bind to reviewed head for Review ${review.review_number}` }
  }
  return { valid: true, fingerprint: authorizationFingerprint(authorization) }
}

export function validateBoundCorrectionAuthorization(authorization: unknown, latestReview: JsonRecord) {
  if (!isFounderAuthorization(authorization, 'correction')) {
    return { valid: false, reason: 'post-budget correction authorization is required for IN_PROGRESS' }
  }
  if (!Number.isInteger(authorization.for_review_number) ||
      authorization.for_review_number !== latestReview.review_number) {
    return { valid: false, reason: 'post-budget correction authorization must bind to the latest completed post-budget review number' }
  }
  if (typeof authorization.reviewed_head !== 'string' || authorization.reviewed_head.length === 0 ||
      authorization.reviewed_head !== latestReview.reviewed_head) {
    return { valid: false, reason: 'post-budget correction authorization must bind to the latest completed post-budget reviewed head' }
  }
  if (!Array.isArray(authorization.finding_ids) || authorization.finding_ids.length === 0 ||
      authorization.finding_ids.some((findingId) => typeof findingId !== 'string' || findingId.length === 0)) {
    return { valid: false, reason: 'post-budget correction authorization must name at least one finding_id' }
  }
  const authorizedFindingIds = new Set(authorization.finding_ids)
  const reviewFindingIds = new Set(
      (latestReview.finding_dispositions as JsonRecord[]).map((finding: JsonRecord) => finding.finding_id),
  )
  if ([...authorizedFindingIds].some((findingId) => !reviewFindingIds.has(findingId))) {
    return { valid: false, reason: 'post-budget correction authorization finding_ids must stay within the latest completed review scope' }
  }
  return { valid: true }
}

/** Validate the trusted-derived current RESULT projection against selected live comment evidence. */
function hasCurrentResultBinding(state: JsonRecord, authorization: unknown, currentResult: unknown) {
  const taskId = String(state.active_task_issue ?? '').trim().replace(/^#/, '')
  if (!taskId || !/^\d+$/.test(taskId) || typeof state.active_pr !== 'string' || !/^#?[1-9]\d*$/.test(state.active_pr.trim()) || typeof state.current_head !== 'string' || !/^[0-9a-f]{40}$/i.test(state.current_head.trim()) || typeof state.latest_result_comment_id !== 'string' || !/^[1-9]\d*$/.test(state.latest_result_comment_id.trim()) || typeof state.latest_transition_identity !== 'string' || !state.latest_transition_identity.trim()) return false
  if (!isRecord(authorization) || !isRecord(currentResult) || !isRecord(currentResult.comment) || !isRecord(currentResult.parsed) || typeof currentResult.comment.body !== 'string') return false
  const commentBody = currentResult.comment.body
  const commentId = String(currentResult.comment.id ?? '').trim()
  const commentParsed = parseRoleCommentBody(commentBody); const selectedParsed = currentResult.parsed
  const commentIdentity = normalizeTransitionIdentity(commentBody, { role: 'RESULT' })
  if (!/^[1-9]\d*$/.test(commentId) || commentId !== state.latest_result_comment_id.trim() || commentParsed.role !== 'RESULT' || selectedParsed.role !== 'RESULT' || String(selectedParsed.prNumber ?? '') !== String(commentParsed.prNumber ?? '') || normalizeAuthorityBase(selectedParsed.base) !== normalizeAuthorityBase(commentParsed.base) || String(selectedParsed.headSha ?? '').trim().toLowerCase() !== String(commentParsed.headSha ?? '').trim().toLowerCase()) return false
  let persistedIdentity: unknown
  try { persistedIdentity = JSON.parse(state.latest_transition_identity) } catch { return false }
  if (!isRecord(persistedIdentity) || !transitionIdentityMatches(persistedIdentity, commentIdentity)) return false
  const originalResultId = String(authorization.original_result_comment_id ?? '').trim()
  if (!/^[1-9]\d*$/.test(originalResultId) || originalResultId === state.latest_result_comment_id.trim()) return false
  const activePr = String(state.active_pr ?? '').trim().replace(/^#/, '')
  const currentHead = String(state.current_head ?? '').trim().toLowerCase()
  return commentIdentity.taskId === taskId && commentParsed.prNumber != null && String(commentParsed.prNumber).trim() === activePr && normalizeAuthorityBase(commentParsed.base) === normalizeAuthorityBase(state.approved_base) && /^[0-9a-f]{40}$/.test(currentHead) && /^[0-9a-f]{40}$/.test(String(commentParsed.headSha ?? '').trim().toLowerCase()) && String(commentParsed.headSha).trim().toLowerCase() === currentHead && typeof commentIdentity.phase === 'string' && commentIdentity.phase.trim().length > 0 && typeof commentIdentity.contentHash === 'string' && /^[0-9a-f]{64}$/.test(commentIdentity.contentHash)
}

function hasHistoricalDeliveredCorrectionBinding(authorization: unknown, state: JsonRecord) {
  if (!isRecord(authorization) || typeof state.last_reviewed_head !== 'string') return false
  const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : ''
  const lastReviewedHead = state.last_reviewed_head.trim().toLowerCase()
  const reviewedHead = normalize(authorization.reviewed_head)
  const exactHead = normalize(authorization.exact_head)
  const oldReviewedHead = normalize(authorization.old_reviewed_head)
  const protectedBase = normalize(authorization.protected_base_sha)
  const authorizationRecord = isRecord(authorization.authorization_record)
    ? authorization.authorization_record
    : null
  const recordedProtectedBase = normalize(authorizationRecord?.protected_base_sha)
  const recordedExactHead = normalize(authorizationRecord?.exact_head)
  const recordedReviewedHead = normalize(authorizationRecord?.reviewed_head)
  const recordedOldReviewedHead = normalize(authorizationRecord?.old_reviewed_head)
  return /^[0-9a-f]{40}$/.test(reviewedHead) &&
    exactHead === reviewedHead &&
    /^[0-9a-f]{40}$/.test(lastReviewedHead) &&
    oldReviewedHead === lastReviewedHead &&
    /^[0-9a-f]{40}$/.test(protectedBase) &&
    recordedProtectedBase === protectedBase &&
    recordedExactHead === exactHead &&
    recordedReviewedHead === reviewedHead &&
    recordedOldReviewedHead === oldReviewedHead
}

export function validateFounderCorrectionAuthorization(
  authorization: unknown,
  state: JsonRecord,
  expectedStatus: string,
  expectedCycle: number,
  currentResult: unknown = null,
) {
  if (!isRecord(authorization) ||
      authorization.authority !== 'Founder' || authorization.scope !== 'correction' ||
      authorization.for_review_number !== expectedCycle || typeof authorization.action !== 'string' || !authorization.action ||
      typeof authorization.authorized_at !== 'string' || !authorization.authorized_at) {
    return { valid: false, reason: `Review ${expectedCycle} Founder correction authorization is required` }
  }
  if ((authorization.schema_version !== 1 && authorization.schema_version !== 2) || typeof authorization.authorization_id !== 'string' || !authorization.authorization_id) {
    return { valid: false, reason: `Review ${expectedCycle} Founder correction authorization requires schema_version and authorization_id` }
  }
  // A founder correction can either bind an exact reviewed head (for identical retries/reopens where no unreviewed work exists),
  // OR it can authorize a drifted live head by binding current_head, while last_reviewed_head remains the old one.
  // It always requires a last_reviewed_head (must happen after a review).
  const deliveredReopenWithCurrentResult = expectedStatus === 'consumed' &&
    expectedCycle === 3 &&
    (() => {
      const reopen = classifyPostBudgetReview4ReopenCorrection(state)
      return reopen.ok && reopen.phase === 'delivered' &&
        isRecord(authorization) && state.current_head !== authorization.reviewed_head &&
        hasHistoricalDeliveredCorrectionBinding(authorization, state) &&
        hasCurrentResultBinding(state, authorization, currentResult)
    })()
  if (authorization.status !== expectedStatus || !state.last_reviewed_head ||
      (!deliveredReopenWithCurrentResult && (
        (authorization.reviewed_head !== state.last_reviewed_head && authorization.reviewed_head !== state.current_head) ||
        state.current_head !== authorization.reviewed_head
      )) ||
      !Array.isArray(authorization.finding_ids) ||
      authorization.finding_ids.length === 0 || authorization.finding_ids.some((id: unknown) => typeof id !== 'string' || !id)) {
    return { valid: false, reason: `Review ${expectedCycle} Founder correction authorization binding is invalid` }
  }
  if (expectedStatus === 'consumed' && (typeof authorization.handoff_comment_id !== 'string' || !authorization.handoff_comment_id)) {
    return { valid: false, reason: `consumed Review ${expectedCycle} Founder correction authorization requires handoff_comment_id` }
  }
  if (expectedStatus === 'consumed' && authorization.schema_version === 2) {
    const binding = isRecord(authorization.handoff_binding) ? authorization.handoff_binding : null
    if (!binding || binding.schema_version !== 1 ||
        typeof binding.content_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(binding.content_sha256) ||
        typeof binding.binding_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(binding.binding_sha256)) {
      return { valid: false, reason: `consumed Review ${expectedCycle} Founder correction authorization requires an immutable HANDOFF binding` }
    }
  }
  return { valid: true }
}

export function validateObsoleteIssue155LegacyFields(state: JsonRecord): { valid: true } | { valid: false; reason: string } {
  for (const key of ['post_budget_review_history', 'founder_authorization'] as const) {
    if (Object.hasOwn(state, key)) return { valid: false, reason: `obsolete legacy field ${key} is not supported` }
  }
  return { valid: true }
}

export function validatePostBudgetReviews(state: JsonRecord): PostBudgetReviewValidation {
  if (!Object.hasOwn(state, 'post_budget_reviews')) {
    return { valid: true, reviews: [] }
  }
  if (!Array.isArray(state.post_budget_reviews)) {
    return { valid: false, reason: 'post_budget_reviews must be an array' }
  }

  const reviewAuthorizationFingerprints = new Set()

  for (const [index, review] of (state.post_budget_reviews as unknown[]).entries()) {
    if (!isRecord(review)) {
      return { valid: false, reason: 'post-budget review entries must be mappings' }
    }
    if (review.review_number !== index + 4) {
      return { valid: false, reason: 'post-budget review numbers must be contiguous from Review 4' }
    }
    if (typeof review.reviewed_head !== 'string' || review.reviewed_head.length === 0 ||
        typeof review.verdict !== 'string' || !postBudgetReviewVerdicts.has(review.verdict)) {
      return { valid: false, reason: 'post-budget review number, head, or verdict is invalid' }
    }
    const reviewAuthorization = validateBoundReviewAuthorization(review.authorization, review)
    if (reviewAuthorization.valid === false) {
      return { valid: false, reason: reviewAuthorization.reason }
    }
    if (reviewAuthorizationFingerprints.has(reviewAuthorization.fingerprint)) {
      return { valid: false, reason: `post-budget review authorization for Review ${review.review_number} cannot replay a prior review authorization` }
    }
    reviewAuthorizationFingerprints.add(reviewAuthorization.fingerprint)
    if (!Array.isArray(review.finding_dispositions) || review.finding_dispositions.some((finding: unknown) =>
      !isRecord(finding) ||
      typeof finding.finding_id !== 'string' || finding.finding_id.length === 0 ||
      typeof finding.disposition !== 'string' || finding.disposition.length === 0
    )) {
      return { valid: false, reason: `post-budget Review ${review.review_number} requires valid finding dispositions` }
    }
  }

  return { valid: true, reviews: state.post_budget_reviews as JsonRecord[] }
}

export type PostBudgetReview4ReopenPhase =
  | 'authorized'
  | 'dispatched'
  | 'delivered'
  | 'delta_reviewed'

function isReopenCorrectionContract(authorization: unknown): authorization is JsonRecord {
  if (!isRecord(authorization) ||
      authorization.authority !== 'Founder' ||
      authorization.scope !== 'correction') {
    return false
  }
  if (authorization.action !== 'reopen' || authorization.bundle_kind !== 'founder-reopen') {
    return false
  }
  if (authorization.for_review_number !== 3 || authorization.review_cycle !== 3) return false
  if (authorization.delta_review_requirement !== true) return false
  if (authorization.required_next_review !== 'Delta Review') return false
  if (authorization.maximum_correction_deliveries !== 1) return false
  if (!Array.isArray(authorization.finding_ids) || authorization.finding_ids.length === 0 ||
      authorization.finding_ids.some((findingId) => typeof findingId !== 'string' || findingId.length === 0)) {
    return false
  }
  return true
}

export function isPostBudgetReview4ReopenCorrectionContract(state: unknown): state is JsonRecord {
  if (!isRecord(state) || state.review_cycle !== 3 || state.full_review_count !== 1) return false
  const reviews = state.post_budget_reviews
  if (!Array.isArray(reviews) || reviews.length !== 1 || !isRecord(reviews[0]) || reviews[0].review_number !== 4) {
    return false
  }
  return isReopenCorrectionContract(state.founder_correction_authorization)
}

export function classifyPostBudgetReview4ReopenCorrection(state: unknown):
  | { ok: false }
  | { ok: true; phase: PostBudgetReview4ReopenPhase; authorization: JsonRecord } {
  if (!isPostBudgetReview4ReopenCorrectionContract(state)) return { ok: false }
  const authorization = state.founder_correction_authorization as JsonRecord
  const deliveries = authorization.correction_deliveries
  const deltas = authorization.delta_review_count
  if (state.state === 'FOUNDER_AUTHORIZED_CORRECTION' && authorization.status === 'authorized' &&
      deliveries === 0 && deltas === 0) {
    return { ok: true, phase: 'authorized', authorization }
  }
  if (state.state === 'IN_PROGRESS' && authorization.status === 'consumed' &&
      deliveries === 0 && deltas === 0) {
    return { ok: true, phase: 'dispatched', authorization }
  }
  if (state.state === 'AWAITING_REVIEW_3' && authorization.status === 'consumed' &&
      deliveries === 1 && deltas === 0) {
    return { ok: true, phase: 'delivered', authorization }
  }
  if ((state.state === 'ELIGIBLE_FOR_FOUNDER_REVIEW' || state.state === 'BLOCKED_FOR_FOUNDER_DECISION') &&
      authorization.status === 'consumed' && deliveries === 1 && deltas === 1) {
    return { ok: true, phase: 'delta_reviewed', authorization }
  }
  return { ok: false }
}

export function validatePostBudgetManagedState(
  state: JsonRecord,
  reviews: JsonRecord[],
  currentResult: unknown = null,
): { valid: true } | { valid: false; reason: string } {
  if (reviews.length === 0) return { valid: true }
  const latestPostBudgetReview = reviews.at(-1)!
  const reopenCorrection = classifyPostBudgetReview4ReopenCorrection(state)
  if (state.review_cycle !== 3 || state.full_review_count !== 1) {
    return { valid: false, reason: 'post-budget history must preserve the normal review budget counters at 3/1' }
  }
  const historicalReviewedHead = state.last_reviewed_head === latestPostBudgetReview.reviewed_head
  const reopenDeltaAdvancedHead = reopenCorrection.ok && reopenCorrection.phase === 'delta_reviewed' &&
    state.last_reviewed_head === state.current_head &&
    reopenCorrection.authorization.reviewed_head === state.current_head
  if (!historicalReviewedHead && !reopenDeltaAdvancedHead) {
    return { valid: false, reason: 'last_reviewed_head must match the latest completed post-budget review' }
  }
  if (state.state === 'IN_PROGRESS') {
    if (reopenCorrection.ok && reopenCorrection.phase === 'dispatched') {
      const authorization = validateFounderCorrectionAuthorization(
        state.founder_correction_authorization,
        state,
        'consumed',
        3,
        currentResult,
      )
      if (!authorization.valid) {
        return { valid: false, reason: authorization.reason ?? 'consumed Founder correction authorization is invalid' }
      }
    } else {
      if (typeof latestPostBudgetReview.verdict !== 'string' ||
          !['CORRECTION REQUIRED', 'BLOCKED FOR FOUNDER DECISION'].includes(latestPostBudgetReview.verdict)) {
        return { valid: false, reason: 'post-budget verdict does not authorize a correction transition' }
      }
      const reviewEightCorrection = isRecord(state.founder_review_8_correction_authorization)
        ? state.founder_review_8_correction_authorization
        : null
      const correctionAuthorization = latestPostBudgetReview.review_number === 8 && reviewEightCorrection
        ? {
            valid: reviewEightCorrection.status === 'consumed' &&
              reviewEightCorrection.authority === 'Founder' &&
              reviewEightCorrection.scope === 'correction' &&
              reviewEightCorrection.for_review_number === 8 &&
              reviewEightCorrection.reviewed_head === latestPostBudgetReview.reviewed_head &&
              Array.isArray(reviewEightCorrection.finding_ids) &&
              reviewEightCorrection.finding_ids.length > 0,
            reason: 'Review 8 correction authorization must bind the latest completed review',
          }
        : validateBoundCorrectionAuthorization(state.founder_decision, latestPostBudgetReview)
      if (!correctionAuthorization.valid) {
        return {
          valid: false,
          reason: correctionAuthorization.reason ?? 'post-budget correction authorization is invalid',
        }
      }
    }
    if (typeof state.active_pr !== 'string' || typeof state.current_head !== 'string') {
      return { valid: false, reason: 'post-budget correction requires active_pr and current_head' }
    }
  }
  if (reopenCorrection.ok && (reopenCorrection.phase === 'delivered' || reopenCorrection.phase === 'delta_reviewed')) {
    const authorization = validateFounderCorrectionAuthorization(
      state.founder_correction_authorization,
      state,
      'consumed',
      3,
      currentResult,
    )
    if (!authorization.valid) {
      return { valid: false, reason: authorization.reason ?? 'consumed Founder correction authorization is invalid' }
    }
  }
  return { valid: true }
}

export function validatePreReviewFounderDecisionGate(state: JsonRecord) {
  if (state.active_pr !== null || state.current_head !== null || state.last_reviewed_head !== null) {
    return { valid: false, reason: 'pre-review Founder decision gate cannot bind an active PR or head' }
  }
  if (typeof state.latest_result_comment_id !== 'string' || !/^[1-9]\d*$/.test(state.latest_result_comment_id)) {
    return { valid: false, reason: 'pre-review Founder decision gate requires a bound RESULT comment id' }
  }
  if (typeof state.latest_transition_identity !== 'string' || !state.latest_transition_identity) {
    return { valid: false, reason: 'pre-review Founder decision gate requires a bound RESULT transition identity' }
  }

  let identity
  try {
    identity = JSON.parse(state.latest_transition_identity)
  } catch {
    return { valid: false, reason: 'pre-review Founder decision gate RESULT transition identity is invalid' }
  }
  const taskIssue = String(state.active_task_issue ?? '').match(/#(\d+)$/)?.[1] ?? null
  const isDiagnosticPhase =
    typeof identity?.phase === 'string' && /^(Diagnostic|Investigation)(?:\b|\s|[-—:(])/.test(identity.phase.trim())
  if (
    !identity || typeof identity !== 'object' || Array.isArray(identity) ||
    identity.role !== 'RESULT' || identity.taskId !== taskIssue ||
    !isDiagnosticPhase ||
    typeof identity.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(identity.contentHash)
  ) {
    return { valid: false, reason: 'pre-review Founder decision gate must bind the active task to a Diagnostic or Investigation RESULT phase' }
  }
  return { valid: true }
}
