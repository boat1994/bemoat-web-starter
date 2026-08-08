import { normalizeAuthorityHead } from './review-verdict-binding.mjs'

function sameValue(left, right) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
      )
    }
    return value
  }
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

function hasLegacyManagedState(state = {}) {
  return (
    Object.hasOwn(state, 'post_budget_review_history') ||
    Object.hasOwn(state, 'founder_authorization') ||
    (state.state === 'STATE_MIGRATION_REQUIRED' && state.review_cycle === 3 &&
      state.full_review_count === 1 && (Object.hasOwn(state, 'founder_decision') ||
        Object.hasOwn(state, 'founder_correction_authorization')))
  )
}

function isReviewThreeCorrectionAuthorization(authorization, state) {
  const reviewedHead = normalizeAuthorityHead(authorization?.reviewed_head)
  return authorization &&
    authorization.status === 'approved' && authorization.authority === 'Founder' &&
    authorization.scope === 'correction' && authorization.for_review_number === 3 &&
    typeof authorization.reviewed_head === 'string' &&
    reviewedHead &&
    reviewedHead === normalizeAuthorityHead(state.last_reviewed_head) &&
    reviewedHead === normalizeAuthorityHead(state.current_head) &&
    Array.isArray(authorization.finding_ids) && authorization.finding_ids.length > 0 &&
    authorization.finding_ids.every((id) => typeof id === 'string' && id.length > 0) &&
    typeof authorization.action === 'string' && authorization.action.length > 0 &&
    typeof authorization.authorized_at === 'string' && authorization.authorized_at.length > 0
}

function correctionAuthorizationId(authorization) {
  return `founder-r3-${normalizeAuthorityHead(authorization.reviewed_head).slice(0, 12)}-${authorization.authorized_at}`
    .replace(/[^a-zA-Z0-9_-]/g, '-')
}

function validateReviewThreeLegacyLineage(state, authorization) {
  if (!Array.isArray(state.finding_lineage) || state.finding_lineage.length === 0) {
    throw new Error('Review 3 Founder correction migration requires complete finding_lineage')
  }
  const authorizedIds = [...authorization.finding_ids].sort()
  const openLineage = state.finding_lineage.filter((finding) => finding?.disposition === 'open')
  const lineageIds = openLineage.map((finding) => finding?.finding_id).sort()
  if (!sameValue(authorizedIds, lineageIds)) {
    throw new Error('Review 3 Founder correction migration finding lineage does not match Founder authority')
  }
  for (const finding of openLineage) {
    if (typeof finding.finding_id !== 'string' || !finding.finding_id ||
        typeof finding.source_thread !== 'string' || !finding.source_thread ||
        typeof finding.evidence !== 'string' || !finding.evidence ||
        !Array.isArray(finding.required_correction_evidence) || finding.required_correction_evidence.length === 0 ||
        finding.required_correction_evidence.some((entry) => typeof entry !== 'string' || !entry)) {
      throw new Error(`Review 3 Founder correction migration has incomplete evidence for ${finding?.finding_id ?? 'unknown finding'}`)
    }
  }
}

/**
 * Exhaustive, ordered reconciliation classification. Only contradictory live
 * authority is a conflict; schema and bookkeeping lag remain repairable.
 */
export function classifyReconciliation(evidence = {}) {
  if (evidence.classification) return evidence.classification
  if (evidence.requiredEvidenceUnavailable) {
    return { outcome: 'BLOCKED_EXTERNAL', reason: 'required live evidence is unavailable' }
  }
  if (
    evidence.authoritativeContradiction ||
    evidence.competingPrs ||
    evidence.headMismatch ||
    evidence.staleCi
  ) {
    return { outcome: 'STATE_CONFLICT', reason: 'authoritative live evidence contradicts' }
  }

  const terminal = evidence.terminal ?? {}
  if (
    terminal.prMerged && !terminal.issueClosed &&
    terminal.reviewedHeadMatches && terminal.currentHeadMatches &&
    typeof terminal.mergeCommit === 'string' && terminal.mergeCommit.length > 0 &&
    terminal.exactHeadCi === true
  ) {
    return {
      outcome: 'STATE_CONFLICT',
      reason: 'merged PR is verified but the managed Issue remains open; merge transport must close the Issue before terminal reconciliation',
    }
  }
  if (terminal.prMerged && (
    !terminal.issueClosed ||
    !terminal.reviewedHeadMatches ||
    !terminal.currentHeadMatches ||
    typeof terminal.mergeCommit !== 'string' || terminal.mergeCommit.length === 0 ||
    terminal.exactHeadCi !== true
  )) {
    return { outcome: 'STATE_CONFLICT', reason: 'terminal evidence is incomplete or does not bind the reviewed head' }
  }
  if (terminal.issueClosed && terminal.prMerged && terminal.reviewedHeadMatches && terminal.currentHeadMatches && terminal.mergeCommit && terminal.exactHeadCi) {
    if (evidence.managedState?.state === 'DONE') {
      return { outcome: 'NO_OP', reason: 'terminal evidence already recorded' }
    }
    return { outcome: 'TERMINAL_REPAIR', reason: 'terminal bookkeeping lags live merge evidence' }
  }

  if (hasLegacyManagedState(evidence.managedState)) {
    return { outcome: 'DETERMINISTIC_MIGRATION', reason: 'legacy managed-state representation is unambiguous' }
  }
  if (evidence.bookkeepingProposal) {
    const proposed = { ...(evidence.managedState ?? {}), ...evidence.bookkeepingProposal }
    if (sameValue(proposed, evidence.managedState ?? {})) {
      return { outcome: 'NO_OP', reason: 'bookkeeping evidence is already recorded' }
    }
    return { outcome: 'BOOKKEEPING_REPAIR', reason: 'unambiguous live evidence is ahead of bookkeeping' }
  }
  return { outcome: 'NO_OP', reason: 'no authoritative evidence changed' }
}

/**
 * Convert the Issue #155 legacy post-budget fields to their canonical shape.
 * Superseded keys are removed only from the proposed replacement state; the
 * caller owns the single durable write and verification.
 */
export function migrateLegacyManagedState(managedState = {}) {
  if (!hasLegacyManagedState(managedState)) {
    return { changed: false, state: managedState }
  }

  const state = structuredClone(managedState)
  if (Object.hasOwn(state, 'post_budget_review_history') && !Array.isArray(state.post_budget_review_history)) {
    throw new Error('legacy post_budget_review_history must be an array')
  }
  const history = state.post_budget_review_history ?? []
  const legacyReviewAuthorization = state.founder_authorization
  const legacyCorrectionAuthorization = state.state === 'STATE_MIGRATION_REQUIRED' &&
    state.review_cycle === 3 && state.full_review_count === 1
    ? (state.founder_decision ?? state.founder_correction_authorization)
    : state.founder_correction_authorization

  if (Object.hasOwn(state, 'post_budget_reviews') && !Array.isArray(state.post_budget_reviews)) {
    throw new Error('canonical post_budget_reviews must be an array')
  }
  const normalizeReview = (entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('post-budget review entries must be mappings')
    }
    return {
      ...structuredClone(entry),
      authorization:
        entry.authorization ??
        (legacyReviewAuthorization?.review_number === entry.review_number &&
        legacyReviewAuthorization?.reviewed_head === entry.reviewed_head
          ? structuredClone(legacyReviewAuthorization)
          : null),
    }
  }
  const reviewsByNumber = new Map()
  for (const entry of [...(state.post_budget_reviews ?? []), ...history]) {
    const normalized = normalizeReview(entry)
    const existing = reviewsByNumber.get(normalized.review_number)
    if (existing && !sameValue(existing, normalized)) {
      throw new Error(`contradictory post-budget review ${normalized.review_number}`)
    }
    reviewsByNumber.set(normalized.review_number, normalized)
  }
  if (reviewsByNumber.size > 0) {
    state.post_budget_reviews = [...reviewsByNumber.values()].sort((left, right) => left.review_number - right.review_number)
  }

  if (
    state.state === 'STATE_MIGRATION_REQUIRED' &&
    state.review_cycle === 3 && state.full_review_count === 1 &&
    (state.post_budget_reviews ?? []).length === 0 && history.length === 0 &&
    isReviewThreeCorrectionAuthorization(legacyCorrectionAuthorization, state)
  ) {
    validateReviewThreeLegacyLineage(state, legacyCorrectionAuthorization)
    state.state = 'FOUNDER_AUTHORIZED_CORRECTION'
    state.founder_correction_authorization = {
      ...structuredClone(legacyCorrectionAuthorization),
      schema_version: 2,
      authorization_id: correctionAuthorizationId(legacyCorrectionAuthorization),
      status: 'authorized',
    }
  } else if (!state.founder_decision && state.founder_correction_authorization) {
    state.founder_decision = structuredClone(state.founder_correction_authorization)
  }

  if (state.state === 'STATE_CONFLICT') {
    const latestReview = state.post_budget_reviews?.at(-1) ?? null
    const decision = state.founder_decision
    const validCorrection =
      latestReview &&
      decision?.status === 'approved' &&
      decision?.authority === 'Founder' &&
      decision?.scope === 'correction' &&
      decision?.for_review_number === latestReview.review_number &&
      decision?.reviewed_head === latestReview.reviewed_head &&
      Array.isArray(decision?.finding_ids) && decision.finding_ids.length > 0 &&
      decision.finding_ids.every((id) => latestReview.finding_dispositions?.some((finding) => finding.finding_id === id))
    if (decision && !validCorrection) {
      throw new Error('invalid Founder correction authorization cannot grant IN_PROGRESS')
    }
    state.state = validCorrection ? 'IN_PROGRESS' : 'BLOCKED_FOR_FOUNDER_DECISION'
  }

  for (const review of state.post_budget_reviews ?? []) {
    if (review.authorization?.status !== 'approved' || review.authorization?.authority !== 'Founder' ||
      review.authorization?.scope !== 'review' || review.authorization?.review_number !== review.review_number ||
      review.authorization?.reviewed_head !== review.reviewed_head) {
      throw new Error(`invalid Founder review authorization for Review ${review.review_number}`)
    }
  }

  // The complete canonical representation is proven before any legacy key is removed.
  delete state.post_budget_review_history
  delete state.founder_authorization
  if (state.state === 'FOUNDER_AUTHORIZED_CORRECTION') delete state.founder_decision
  if (state.state !== 'FOUNDER_AUTHORIZED_CORRECTION') delete state.founder_correction_authorization

  return { changed: true, state }
}

/**
 * Preserve a planning-only task while the canonical guide changes. This is a
 * migration projection, not implementation authority: the planning RESULT,
 * ancestry baseline, counters, and null PR/head fields remain immutable.
 */
export function isSeparatePlanningImplementationAuthorization({
  authorization,
  managedState,
  repository = null,
} = {}) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return false
  const issueNumber = String(managedState?.active_task_issue ?? '').match(/#?(\d+)$/)?.[1] ?? null
  const expectedBaseline = managedState?.planning_authorization_base_sha
  return authorization.status === 'approved' &&
    authorization.authority === 'Founder' &&
    authorization.scope === 'implementation' &&
    authorization.action === 'implement' &&
    String(authorization.task_issue ?? '') === String(issueNumber) &&
    (!repository || authorization.repository === repository) &&
    authorization.base === managedState?.approved_base &&
    authorization.planning_baseline_sha === expectedBaseline &&
    managedState?.workflow_mode === 'planning_no_pr' &&
    managedState?.active_pr == null &&
    managedState?.current_head == null &&
    managedState?.last_reviewed_head == null
}

/**
 * Migrate a planning-only task such as Issue #248 onto a newer merged guide.
 * The function deliberately refuses to normalize an implementation-shaped
 * state or to infer implementation approval from the planning RESULT.
 */
export function migratePlanningOnlyTaskState({
  managedState,
  issueNumber,
  resultCommentId,
  planningBaselineSha,
  guideVersion,
  policySourceSha = null,
  implementationAuthorization = null,
  repository = null,
} = {}) {
  if (!managedState || typeof managedState !== 'object' || Array.isArray(managedState)) {
    throw new Error('STATE_MIGRATION_REQUIRED: planning task state is missing')
  }
  const expectedIssue = String(issueNumber ?? '')
  if (!/^\d+$/.test(expectedIssue) || !/^[0-9a-f]{40}$/i.test(String(planningBaselineSha ?? ''))) {
    throw new Error('STATE_MIGRATION_REQUIRED: planning migration requires an exact Issue and baseline SHA')
  }
  if (managedState.state !== 'BLOCKED_FOR_FOUNDER_DECISION' ||
      managedState.workflow_mode !== 'planning_no_pr' ||
      managedState.review_cycle !== 0 || managedState.full_review_count !== 0 ||
      managedState.active_pr !== null || managedState.current_head !== null || managedState.last_reviewed_head !== null ||
      managedState.active_task_issue !== `#${expectedIssue}` ||
      managedState.planning_authorization_base_sha !== planningBaselineSha ||
      String(managedState.latest_result_comment_id) !== String(resultCommentId)) {
    throw new Error('STATE_CONFLICT: planning migration evidence does not preserve the exact planning RESULT, baseline, counters, mode, or null PR/head')
  }
  if (implementationAuthorization && !isSeparatePlanningImplementationAuthorization({
    authorization: implementationAuthorization,
    managedState,
    repository,
  })) {
    throw new Error('STATE_CONFLICT: planning migration cannot infer implementation approval from a mismatched Founder decision')
  }

  const nextState = {
    ...structuredClone(managedState),
    guide_version: guideVersion,
    guide_source_sha: policySourceSha ?? managedState.guide_source_sha,
    next_permitted_action: 'Separate Founder implementation approval is required for the bounded implementation plan before any HANDOFF.',
  }
  const implementationApproved = isSeparatePlanningImplementationAuthorization({
    authorization: implementationAuthorization,
    managedState: nextState,
    repository,
  })
  return {
    changed: JSON.stringify(nextState) !== JSON.stringify(managedState),
    state: nextState,
    implementationApprovalRequired: !implementationApproved,
  }
}

export function proposedRepair(evidence, classification) {
  if (evidence.proposedState) {
    // Bookkeeping deltas must merge onto the live managed state so additive
    // fields (for example planning_authorization_base_sha) are preserved.
    return {
      ...structuredClone(evidence.managedState ?? {}),
      ...structuredClone(evidence.proposedState),
    }
  }
  const migrated = migrateLegacyManagedState(evidence.managedState ?? {}).state
  if (classification.outcome === 'TERMINAL_REPAIR') {
    return {
      ...migrated,
      state: 'DONE',
      merged_commit_sha: evidence.terminal?.mergeCommit ?? migrated.merged_commit_sha ?? null,
      open_blockers: [],
      next_permitted_action: 'none on this task',
    }
  }
  if (classification.outcome === 'BOOKKEEPING_REPAIR') {
    return { ...migrated, ...evidence.bookkeepingProposal }
  }
  return migrated
}
