import { normalizeAuthorityHead } from './review-verdict-binding.mjs'
import { proposeReviewReconciliation } from './reconciliation-proposals.mjs'

const CORE_VERDICTS = new Set([
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
])

/**
 * Build the complete reviewer-owned durable projection. The executable
 * facade supplies only evidence already bound to the live Issue/PR/comment;
 * this pure function never reads transport state or posts comments.
 */
export function projectReviewVerdictState({
  prior,
  verdict,
  reviewType,
  reviewedHead,
  commentId,
  transitionIdentity,
  findings = [],
  updatedAt = new Date().toISOString(),
  updatedBy = 'Reviewer',
}) {
  if (!prior || typeof prior !== 'object') throw new Error('review projection requires prior managed state')
  if (!CORE_VERDICTS.has(verdict)) throw new Error('review projection requires a Core verdict')
  if (!['full', 'delta'].includes(reviewType)) throw new Error('review projection requires review type full or delta')
  const normalizedReviewedHead = normalizeAuthorityHead(reviewedHead)
  if (!normalizedReviewedHead) throw new Error('review projection requires exact reviewed head')
  if (reviewType === 'full' && prior.review_cycle !== 0) throw new Error('full review requires review_cycle 0')
  if (reviewType === 'delta' && prior.review_cycle < 1) throw new Error('delta review requires an existing review cycle')

  const proposal = proposeReviewReconciliation({
    verdict,
    reviewedHead: normalizedReviewedHead,
    reviewCycle: prior.review_cycle,
    fullReviewCount: prior.full_review_count,
  })
  const immutableFindings = findings
    .filter((finding) => finding?.finding_id || finding?.id)
    .map((finding) => String(finding.finding_id ?? finding.id))
  const projectsContractBlockers =
    verdict === 'CORRECTION REQUIRED' || verdict === 'BLOCKED FOR FOUNDER DECISION'
  const blockerIds = projectsContractBlockers ? immutableFindings : []

  return {
    ...structuredClone(prior),
    ...proposal,
    current_head: normalizedReviewedHead,
    last_reviewed_head: normalizedReviewedHead,
    open_blockers: blockerIds,
    latest_review_verdict_comment_id: String(commentId),
    latest_transition_identity: transitionIdentity,
    updated_at: updatedAt,
    updated_by: updatedBy,
  }
}
