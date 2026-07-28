import { createHash } from 'node:crypto'

function sameSet(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function databaseId(comment) {
  const explicit = comment?.databaseId ?? comment?.database_id ?? comment?.id
  if (explicit != null && /^[1-9]\d*$/.test(String(explicit))) return String(explicit)
  return String(comment?.url ?? comment?.html_url ?? '').match(/#issuecomment-(\d+)$/)?.[1] ?? null
}

function referenceNumber(value) {
  const normalized = String(value ?? '').trim()
  return normalized.match(/^"?#(\d+)"?$/)?.[1] ?? normalized.match(/^(\d+)$/)?.[1] ?? null
}

function normalizedMarkdownValue(value) {
  return value.replace(/`/g, '').trim()
}

function uniqueMarkdownField(body, label, errors) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...body.matchAll(new RegExp(`^- \\*\\*${escaped}:\\*\\*\\s*(.+?)\\s*$`, 'gmi'))]
  if (matches.length !== 1) {
    errors.push(`STATE CONFLICT: S8 decision field ${label} must appear exactly once`)
    return null
  }
  return normalizedMarkdownValue(matches[0][1])
}

function requireEqual(errors, actual, expected, message) {
  if (actual !== expected) errors.push(`STATE CONFLICT: ${message}`)
}

function validatePostBudgetReviews(state, findingIds, errors) {
  const reviews = state.post_budget_reviews
  if (!Array.isArray(reviews) || reviews.length !== 4 ||
      reviews.some((review, index) => review?.review_number !== index + 4)) {
    errors.push('STATE CONFLICT: current correction requires the exact completed Review 4–7 sequence')
    return null
  }
  for (const review of reviews) {
    const authorization = review.authorization
    if (!authorization || authorization.status !== 'approved' || authorization.authority !== 'Founder' ||
        authorization.scope !== 'review' || authorization.review_number !== review.review_number ||
        authorization.reviewed_head !== review.reviewed_head) {
      errors.push(`STATE CONFLICT: Review ${review.review_number} authorization is missing or inconsistent`)
    }
    const verdictCommentId = String(review.verdict_comment_id ?? '')
    const verdictUrlId = String(review.verdict_url ?? '').match(/#issuecomment-(\d+)$/)?.[1] ?? null
    if (!/^[1-9]\d*$/.test(verdictCommentId) || verdictUrlId !== verdictCommentId) {
      errors.push(`STATE CONFLICT: Review ${review.review_number} verdict identity is missing or inconsistent`)
    }
    for (const token of [review.review_number, review.reviewed_head, ...findingIds]) {
      if (!authorization?.action?.includes(String(token))) {
        errors.push(`STATE CONFLICT: Review ${review.review_number} authorization action is inconsistent`)
        break
      }
    }
    const dispositionIds = (Array.isArray(review.finding_dispositions) ? review.finding_dispositions : [])
      .filter((entry) => entry.disposition === 'open')
      .map((entry) => entry.finding_id)
    if (!sameSet(dispositionIds, findingIds)) {
      errors.push(`STATE CONFLICT: Review ${review.review_number} finding lineage is inconsistent`)
    }
  }
  return reviews[3]
}

export function selectCorrectionAuthorityContext(state) {
  if (!state) return { kind: 'unmanaged' }
  const hasCurrentEvidence = (Array.isArray(state.post_budget_reviews) && state.post_budget_reviews.length > 0) ||
    state.founder_decision != null || state.founder_migration_authority != null
  if (hasCurrentEvidence) return { kind: 'current_post_budget_s8' }
  if (state.founder_correction_authorization != null || state.review_cycle === 3) {
    return { kind: 'historical_review_3' }
  }
  return { kind: 'managed_without_correction_authority' }
}

export function verifyCurrentPostBudgetS8Authority({
  state,
  contract,
  repository,
  issueNumber,
  s8Comment,
  reviewSevenComment,
  historicalProof,
  currentVerdict,
}) {
  const errors = []
  const findingIds = contract?.findings?.map((finding) => finding.id) ?? []
  if (contract?.schema_version !== 2 || contract?.mode !== 'implementation_pr') {
    errors.push('STATE CONFLICT: current correction requires a schema-v2 implementation_pr contract')
  }
  if (state?.review_cycle !== 3 || state?.full_review_count !== 1) {
    errors.push('STATE CONFLICT: post-budget correction must preserve counters 3/1')
  }
  if (state?.state !== 'BLOCKED_FOR_FOUNDER_DECISION') {
    errors.push('STATE CONFLICT: current correction requires BLOCKED_FOR_FOUNDER_DECISION state')
  }
  if (!state?.current_head || state.current_head !== state.last_reviewed_head || state.current_head !== contract?.reviewed_head) {
    errors.push('STATE CONFLICT: current correction contract does not bind current_head and last_reviewed_head')
  }
  if (!sameSet(state?.open_blockers, findingIds)) {
    errors.push('STATE CONFLICT: current correction finding set does not match open blockers')
  }
  const currentVerdictBody = currentVerdict?.body ?? ''
  for (const token of [contract?.reviewed_head, ...findingIds]) {
    if (!token || !currentVerdictBody.includes(String(token))) {
      errors.push(`STATE CONFLICT: current correction contract transport is missing ${token ?? 'required identity'}`)
    }
  }

  const reviewSeven = validatePostBudgetReviews(state, findingIds, errors)
  if (reviewSeven) {
    if (reviewSeven.verdict !== 'CORRECTION REQUIRED' || reviewSeven.reviewed_head !== contract?.reviewed_head) {
      errors.push('STATE CONFLICT: Review 7 verdict does not bind the current correction head')
    }
    requireEqual(
      errors,
      databaseId(reviewSevenComment),
      String(reviewSeven.verdict_comment_id),
      'Review 7 verdict comment identity is inconsistent',
    )
    if (!/\*\*Verdict:\*\*\s*CORRECTION REQUIRED/i.test(reviewSevenComment?.body ?? '') ||
        !(reviewSevenComment?.body ?? '').includes(contract?.reviewed_head ?? '')) {
      errors.push('STATE CONFLICT: Review 7 verdict comment semantics are inconsistent')
    }
    if (!reviewSevenComment?.author || reviewSevenComment.authorAssociation !== 'OWNER' ||
        !reviewSevenComment.createdAt || reviewSevenComment.updatedAt !== reviewSevenComment.createdAt) {
      errors.push('STATE CONFLICT: Review 7 verdict canonical metadata is inconsistent')
    }
  }

  const decision = state?.founder_decision
  if (!decision || decision.status !== 'approved' || decision.authority !== 'Founder' ||
      decision.scope !== 'correction' || decision.for_review_number !== 7 ||
      decision.reviewed_head !== contract?.reviewed_head || !sameSet(decision.finding_ids, findingIds)) {
    errors.push('STATE CONFLICT: current Founder correction decision is missing or inconsistent')
  }

  const migration = state?.founder_migration_authority
  if (!migration || migration.schema_version !== 3 || migration.status !== 'approved' ||
      migration.authority !== 'Founder' || migration.scope !== 'correction') {
    errors.push('STATE CONFLICT: S8 migration authority is missing or malformed')
    return { ok: false, errors, proof: null }
  }
  for (const token of [
    migration.specification_result_comment_id,
    migration.review_7_verdict_comment_id,
    migration.comment_id,
  ]) {
    if (!token || !currentVerdictBody.includes(String(token))) {
      errors.push(`STATE CONFLICT: current correction contract transport is missing authority source ${token ?? 'identity'}`)
    }
  }

  requireEqual(errors, repository?.nameWithOwner, migration.canonical_repository, 'S8 canonical repository is inconsistent')
  requireEqual(errors, repository?.databaseId, String(migration.repository_id), 'S8 repository database identity is inconsistent')
  requireEqual(errors, String(issueNumber), referenceNumber(migration.issue), 'S8 issue identity is inconsistent')
  requireEqual(errors, referenceNumber(state.active_pr), referenceNumber(migration.pr), 'S8 PR identity is inconsistent')
  requireEqual(errors, migration.correction_base, contract?.reviewed_head, 'S8 correction base is inconsistent')
  if (!sameSet(migration.finding_ids, findingIds)) {
    errors.push('STATE CONFLICT: S8 finding set is inconsistent')
  }

  requireEqual(errors, databaseId(s8Comment), String(migration.comment_id), 'S8 comment identity is inconsistent')
  requireEqual(errors, s8Comment?.author, migration.author_login, 'S8 comment author is inconsistent')
  requireEqual(errors, s8Comment?.authorAssociation, migration.author_association, 'S8 comment author association is inconsistent')
  requireEqual(errors, s8Comment?.createdAt, migration.created_at, 'S8 comment creation timestamp is inconsistent')
  requireEqual(errors, s8Comment?.updatedAt, migration.updated_at, 'S8 comment update timestamp is inconsistent')
  requireEqual(
    errors,
    createHash('sha256').update(s8Comment?.body ?? '').digest('hex'),
    migration.content_sha256,
    'S8 comment content hash is inconsistent',
  )

  const s8Body = s8Comment?.body ?? ''
  const s8Fields = {
    decision: uniqueMarkdownField(s8Body, 'Decision', errors),
    authority: uniqueMarkdownField(s8Body, 'Authority', errors),
    repository: uniqueMarkdownField(s8Body, 'Canonical repository', errors),
    repositoryId: uniqueMarkdownField(s8Body, 'Repository ID', errors),
    issue: uniqueMarkdownField(s8Body, 'Issue', errors),
    pr: uniqueMarkdownField(s8Body, 'PR', errors),
    specification: uniqueMarkdownField(s8Body, 'Specification RESULT comment', errors),
    reviewSeven: uniqueMarkdownField(s8Body, 'Review 7 verdict comment', errors),
    correctionBase: uniqueMarkdownField(s8Body, 'Correction base', errors),
    findingIds: uniqueMarkdownField(s8Body, 'Finding IDs', errors),
    historicalReview: uniqueMarkdownField(s8Body, 'Historical Review 3 authority source comment', errors),
    historicalHandoff: uniqueMarkdownField(s8Body, 'Historical HANDOFF comment', errors),
    historicalAuthorization: uniqueMarkdownField(s8Body, 'Historical authorization ID', errors),
    historicalHead: uniqueMarkdownField(s8Body, 'Historical reviewed head', errors),
    historicalFindingIds: uniqueMarkdownField(s8Body, 'Historical finding IDs', errors),
    historicalAction: uniqueMarkdownField(s8Body, 'Historical action', errors),
    historicalAuthorizedAt: uniqueMarkdownField(s8Body, 'Historical authorization timestamp', errors),
    approvedAction: uniqueMarkdownField(s8Body, 'Approved action', errors),
  }
  requireEqual(errors, s8Fields.decision, 'APPROVED', 'S8 decision is not approved')
  requireEqual(errors, s8Fields.authority, 'Founder', 'S8 semantic authority is inconsistent')
  requireEqual(errors, s8Fields.repository, migration.canonical_repository, 'S8 body repository is inconsistent')
  requireEqual(errors, s8Fields.repositoryId, String(migration.repository_id), 'S8 body repository ID is inconsistent')
  requireEqual(errors, s8Fields.issue, migration.issue, 'S8 body issue is inconsistent')
  requireEqual(errors, s8Fields.pr, migration.pr, 'S8 body PR is inconsistent')
  requireEqual(errors, s8Fields.specification, String(migration.specification_result_comment_id), 'S8 specification source is inconsistent')
  requireEqual(errors, s8Fields.reviewSeven, String(migration.review_7_verdict_comment_id), 'S8 Review 7 source is inconsistent')
  requireEqual(errors, s8Fields.correctionBase, migration.correction_base, 'S8 body correction base is inconsistent')
  requireEqual(errors, s8Fields.findingIds, `[${(migration.finding_ids ?? []).join(', ')}]`, 'S8 body finding set is inconsistent')
  requireEqual(errors, s8Fields.historicalReview, String(migration.historical_review_3_source_comment_id), 'S8 historical Review 3 source is inconsistent')
  requireEqual(errors, s8Fields.historicalHandoff, String(migration.historical_handoff_comment_id), 'S8 historical HANDOFF source is inconsistent')
  requireEqual(errors, s8Fields.historicalAuthorization, migration.historical_authorization_id, 'S8 historical authorization is inconsistent')
  requireEqual(errors, s8Fields.historicalHead, migration.historical_reviewed_head, 'S8 historical head is inconsistent')
  requireEqual(errors, s8Fields.historicalFindingIds, `[${(migration.historical_finding_ids ?? []).join(', ')}]`, 'S8 historical finding set is inconsistent')
  requireEqual(errors, s8Fields.historicalAction, migration.historical_action, 'S8 historical action is inconsistent')
  requireEqual(errors, s8Fields.historicalAuthorizedAt, migration.historical_authorized_at, 'S8 historical authorization timestamp is inconsistent')
  for (const token of [migration.specification_result_comment_id, migration.correction_base, ...findingIds, 'Review 7']) {
    if (!s8Fields.approvedAction?.includes(String(token))) {
      errors.push(`STATE CONFLICT: S8 approved action is missing ${token}`)
    }
  }
  for (const token of [migration.specification_result_comment_id, migration.correction_base, ...findingIds, 'Review 7']) {
    if (!migration.approved_action?.includes(String(token))) {
      errors.push(`STATE CONFLICT: versioned migration approved action is missing ${token}`)
    }
  }

  if (!historicalProof || historicalProof.kind !== 'historical_review_3' ||
      historicalProof.authorizationId !== migration.historical_authorization_id ||
      historicalProof.reviewedHead !== migration.historical_reviewed_head ||
      historicalProof.handoffDatabaseId !== String(migration.historical_handoff_comment_id) ||
      !sameSet(historicalProof.findingIds, migration.historical_finding_ids) ||
      migration.historical_action !== state.founder_correction_authorization?.action ||
      migration.historical_authorized_at !== state.founder_correction_authorization?.authorized_at) {
    errors.push('STATE CONFLICT: S8 historical Review 3 lineage proof is inconsistent')
  }

  return errors.length > 0
    ? { ok: false, errors, proof: null }
    : {
        ok: true,
        errors: [],
        proof: Object.freeze({
          kind: 'current_post_budget_s8',
          reviewedHead: contract.reviewed_head,
          reviewNumber: 7,
          findingIds: Object.freeze([...findingIds]),
          s8CommentDatabaseId: databaseId(s8Comment),
          historicalProof,
        }),
      }
}
