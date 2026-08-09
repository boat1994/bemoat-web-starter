const postBudgetReviewVerdicts = new Set([
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
])

function isFounderAuthorization(value, scope) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    value.status === 'approved' && value.authority === 'Founder' && value.scope === scope &&
    typeof value.action === 'string' && value.action.length > 0 &&
    typeof value.authorized_at === 'string' && value.authorized_at.length > 0
}

function authorizationFingerprint(authorization) {
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

function validateBoundReviewAuthorization(authorization, review) {
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

export function validateBoundCorrectionAuthorization(authorization, latestReview) {
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
    latestReview.finding_dispositions.map((finding) => finding.finding_id),
  )
  if ([...authorizedFindingIds].some((findingId) => !reviewFindingIds.has(findingId))) {
    return { valid: false, reason: 'post-budget correction authorization finding_ids must stay within the latest completed review scope' }
  }
  return { valid: true }
}

export function validateFounderCorrectionAuthorization(authorization, state, expectedStatus, expectedCycle) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization) ||
      authorization.authority !== 'Founder' || authorization.scope !== 'correction' ||
      authorization.for_review_number !== expectedCycle || typeof authorization.action !== 'string' || !authorization.action ||
      typeof authorization.authorized_at !== 'string' || !authorization.authorized_at) {
    return { valid: false, reason: `Review ${expectedCycle} Founder correction authorization is required` }
  }
  if (![1, 2].includes(authorization.schema_version) || typeof authorization.authorization_id !== 'string' || !authorization.authorization_id) {
    return { valid: false, reason: `Review ${expectedCycle} Founder correction authorization requires schema_version and authorization_id` }
  }
  // A founder correction can either bind an exact reviewed head (for identical retries/reopens where no unreviewed work exists),
  // OR it can authorize a drifted live head by binding current_head, while last_reviewed_head remains the old one.
  // It always requires a last_reviewed_head (must happen after a review).
  if (authorization.status !== expectedStatus || !state.last_reviewed_head ||
      (authorization.reviewed_head !== state.last_reviewed_head && authorization.reviewed_head !== state.current_head) ||
      (state.current_head !== authorization.reviewed_head) ||
      !Array.isArray(authorization.finding_ids) ||
      authorization.finding_ids.length === 0 || authorization.finding_ids.some((id) => typeof id !== 'string' || !id)) {
    return { valid: false, reason: `Review ${expectedCycle} Founder correction authorization binding is invalid` }
  }
  if (expectedStatus === 'consumed' && (typeof authorization.handoff_comment_id !== 'string' || !authorization.handoff_comment_id)) {
    return { valid: false, reason: `consumed Review ${expectedCycle} Founder correction authorization requires handoff_comment_id` }
  }
  if (expectedStatus === 'consumed' && authorization.schema_version === 2) {
    const binding = authorization.handoff_binding
    if (!binding || binding.schema_version !== 1 ||
        typeof binding.content_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(binding.content_sha256) ||
        typeof binding.binding_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(binding.binding_sha256)) {
      return { valid: false, reason: `consumed Review ${expectedCycle} Founder correction authorization requires an immutable HANDOFF binding` }
    }
  }
  return { valid: true }
}

export function validatePostBudgetReviews(state) {
  if (!Object.hasOwn(state, 'post_budget_reviews')) {
    return { valid: true, reviews: [] }
  }
  if (!Array.isArray(state.post_budget_reviews)) {
    return { valid: false, reason: 'post_budget_reviews must be an array' }
  }

  const reviewAuthorizationFingerprints = new Set()

  for (const [index, review] of state.post_budget_reviews.entries()) {
    if (typeof review !== 'object' || review === null || Array.isArray(review)) {
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
    if (!reviewAuthorization.valid) {
      return { valid: false, reason: reviewAuthorization.reason }
    }
    if (reviewAuthorizationFingerprints.has(reviewAuthorization.fingerprint)) {
      return { valid: false, reason: `post-budget review authorization for Review ${review.review_number} cannot replay a prior review authorization` }
    }
    reviewAuthorizationFingerprints.add(reviewAuthorization.fingerprint)
    if (!Array.isArray(review.finding_dispositions) || review.finding_dispositions.some((finding) =>
      typeof finding !== 'object' || finding === null || Array.isArray(finding) ||
      typeof finding.finding_id !== 'string' || finding.finding_id.length === 0 ||
      typeof finding.disposition !== 'string' || finding.disposition.length === 0
    )) {
      return { valid: false, reason: `post-budget Review ${review.review_number} requires valid finding dispositions` }
    }
  }

  return { valid: true, reviews: state.post_budget_reviews }
}

export function validatePreReviewFounderDecisionGate(state) {
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
