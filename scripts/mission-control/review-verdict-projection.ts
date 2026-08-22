import { normalizeAuthorityHead } from './review-verdict-binding.mjs'
import { classifyPostBudgetReview4ReopenCorrection } from './domain/task-state-authorization.ts'

export type CoreVerdict =
  | 'CORRECTION REQUIRED'
  | 'ELIGIBLE FOR FOUNDER REVIEW'
  | 'BLOCKED FOR FOUNDER DECISION'
  | 'BLOCKED EXTERNAL'
  | 'STATE CONFLICT'

export type ReviewType = 'full' | 'delta'

type ManagedState = {
  review_cycle?: number
  full_review_count?: number
  [key: string]: unknown
}

type Finding = {
  finding_id?: unknown
  id?: unknown
} | null | undefined

export type ReviewReconciliationInput = Record<string, unknown>

type ReviewReconciliation = {
  state: string
  review_cycle: number
  full_review_count: number
  last_reviewed_head: string | null
  next_permitted_action: string
}

export type ReviewProjectionInput = Record<string, unknown>

const CORE_VERDICTS = new Set<CoreVerdict>([
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
])

const VERDICT_TO_STATE: Record<string, string | Record<number, string>> = {
  'CORRECTION REQUIRED': {
    1: 'CORRECTION_REQUIRED_1',
    2: 'CORRECTION_REQUIRED_2',
  },
  'ELIGIBLE FOR FOUNDER REVIEW': 'ELIGIBLE_FOR_FOUNDER_REVIEW',
  'BLOCKED FOR FOUNDER DECISION': 'BLOCKED_FOR_FOUNDER_DECISION',
  'BLOCKED EXTERNAL': 'BLOCKED_EXTERNAL',
  'STATE CONFLICT': 'STATE_CONFLICT',
}

function isManagedState(value: unknown): value is ManagedState {
  return Boolean(value) && typeof value === 'object'
}

function isCoreVerdict(value: unknown): value is CoreVerdict {
  return typeof value === 'string' && CORE_VERDICTS.has(value as CoreVerdict)
}

function isReviewType(value: unknown): value is ReviewType {
  return value === 'full' || value === 'delta'
}

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
}: ReviewProjectionInput): Record<string, unknown> {
  if (!isManagedState(prior)) throw new Error('review projection requires prior managed state')
  const typedVerdict = verdict as string
  const typedReviewType = reviewType as string
  const typedFindings = findings as Finding[]
  const currentReviewCycle = prior.review_cycle as number
  if (!isCoreVerdict(typedVerdict)) throw new Error('review projection requires a Core verdict')
  if (!isReviewType(typedReviewType)) throw new Error('review projection requires review type full or delta')
  const normalizedReviewedHead = normalizeAuthorityHead(reviewedHead)
  if (!normalizedReviewedHead) throw new Error('review projection requires exact reviewed head')
  const exactReviewedHead = normalizedReviewedHead as string
  if (typedReviewType === 'full' && currentReviewCycle !== 0) throw new Error('full review requires review_cycle 0')
  if (typedReviewType === 'delta' && currentReviewCycle < 1) throw new Error('delta review requires an existing review cycle')

  const proposal = proposeReviewReconciliation({
    verdict: typedVerdict,
    reviewedHead: exactReviewedHead,
    reviewCycle: currentReviewCycle,
    fullReviewCount: prior.full_review_count,
  })
  const immutableFindings = typedFindings
    .filter((finding) => finding?.finding_id || finding?.id)
    .map((finding) => String(finding?.finding_id ?? finding?.id))
  const projectsContractBlockers =
    typedVerdict === 'CORRECTION REQUIRED' || typedVerdict === 'BLOCKED FOR FOUNDER DECISION'
  const blockerIds = projectsContractBlockers ? immutableFindings : []

  const projected: Record<string, unknown> = {
    ...structuredClone(prior),
    ...proposal,
    current_head: exactReviewedHead,
    last_reviewed_head: exactReviewedHead,
    open_blockers: blockerIds,
    latest_review_verdict_comment_id: String(commentId),
    latest_transition_identity: transitionIdentity,
    updated_at: updatedAt,
    updated_by: updatedBy,
  }
  const reopen = classifyPostBudgetReview4ReopenCorrection(prior)
  if (reopen.ok && reopen.phase === 'delivered' && typedReviewType === 'delta') {
    projected.founder_correction_authorization = {
      ...structuredClone(reopen.authorization),
      delta_review_count: 1,
      delta_review_comment_id: String(commentId),
    }
  }
  return projected
}

export function proposeReviewReconciliation(input: ReviewReconciliationInput): ReviewReconciliation {
  if (input.postBudget === true) {
    return proposePostBudgetReviewReconciliation(input)
  }

  const reviewCycle = (input.reviewCycle ?? 0) as number
  const reviewedHead = normalizeAuthorityHead(input.reviewedHead)

  if (input.verdict === 'CORRECTION REQUIRED' && reviewCycle >= 2) {
    return {
      state: 'STATE_CONFLICT',
      review_cycle: reviewCycle,
      full_review_count: Math.min((input.fullReviewCount ?? 0) as number, 1),
      last_reviewed_head: reviewedHead,
      next_permitted_action: 'Mission Control must classify contradictory evidence.',
    }
  }

  const nextCycle = Math.min(reviewCycle + 1, 3)

  const currentFull = (input.fullReviewCount ?? 0) as number
  const nextFullReviewCount = Math.min(currentFull + (reviewCycle === 0 ? 1 : 0), 1)

  return {
    state: resolveReviewVerdictState(input.verdict as string, reviewCycle),
    review_cycle: nextCycle,
    full_review_count: nextFullReviewCount,
    last_reviewed_head: reviewedHead,
    next_permitted_action: nextActionForVerdict(input.verdict as string, nextCycle),
  }
}

function proposePostBudgetReviewReconciliation(input: ReviewReconciliationInput): ReviewReconciliation {
  const prior = input.managedState
  if (!isManagedState(prior)) throw new Error('post-budget review reconciliation requires prior managed state')

  const reviewedHead = normalizeAuthorityHead(input.reviewedHead)
  if (!reviewedHead) throw new Error('post-budget review reconciliation requires exact reviewed head')

  const verdict = input.verdict as string
  if (!isCoreVerdict(verdict)) throw new Error('post-budget review reconciliation requires a Core verdict')

  const authorization = input.authorization
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw new Error('post-budget review reconciliation requires Founder authorization')
  }

  const findingDispositions = input.findingDispositions
  if (!Array.isArray(findingDispositions) || findingDispositions.length === 0) {
    throw new Error('post-budget review reconciliation requires immutable finding dispositions')
  }

  const reviewNumber = 4
  const priorLineage = Array.isArray(prior.finding_lineage) ? structuredClone(prior.finding_lineage) : []
  const dispositionById = new Map(
    findingDispositions
      .filter((finding) => finding && typeof finding === 'object' && !Array.isArray(finding))
      .map((finding) => [String(finding.finding_id), finding]),
  )
  const lineage = priorLineage.map((finding) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return finding
    const findingId = String((finding as Record<string, unknown>).finding_id ?? '')
    const latest = dispositionById.get(findingId)
    return latest ? { ...finding, disposition: latest.disposition } : finding
  })
  const knownLineageIds = new Set(lineage.map((finding) =>
    finding && typeof finding === 'object' && !Array.isArray(finding)
      ? String((finding as Record<string, unknown>).finding_id ?? '')
      : '',
  ))
  for (const finding of findingDispositions) {
    const findingId = String(finding?.finding_id ?? '')
    if (findingId && !knownLineageIds.has(findingId)) lineage.push(structuredClone(finding))
  }

  const openBlockers = verdict === 'ELIGIBLE FOR FOUNDER REVIEW'
    ? []
    : findingDispositions
      .filter((finding) => !/^(?:resolved|accepted|closed|none)$/i.test(String(finding?.disposition ?? '').trim()))
      .map((finding) => String(finding.finding_id))

  const postBudgetReview: Record<string, unknown> = {
    review_number: reviewNumber,
    pr_number: String(input.prNumber ?? '').replace(/^#/, ''),
    base: String(input.base ?? '').trim(),
    reviewed_head: reviewedHead,
    verdict,
    verdict_comment_id: String(input.verdictCommentId ?? ''),
    authorization: structuredClone(authorization),
    finding_dispositions: structuredClone(findingDispositions),
  }
  if (input.verdictUrl) postBudgetReview.verdict_url = String(input.verdictUrl)

  return {
    state: resolveReviewVerdictState(verdict, 3),
    review_cycle: 3,
    full_review_count: 1,
    last_reviewed_head: reviewedHead,
    next_permitted_action: nextActionForVerdict(verdict, 3),
    current_head: reviewedHead,
    open_blockers: openBlockers,
    finding_lineage: lineage,
    post_budget_reviews: [postBudgetReview],
    latest_review_verdict_comment_id: String(input.verdictCommentId ?? ''),
    latest_transition_identity: input.transitionIdentity,
    material_change_status: 'none',
  } as ReviewReconciliation
}

function resolveReviewVerdictState(verdict: string, currentReviewCycle = 0): string {
  if (verdict === 'CORRECTION REQUIRED') {
    const nextCycle = Math.min(currentReviewCycle + 1, 3)
    const correctionState = VERDICT_TO_STATE['CORRECTION REQUIRED']
    return (typeof correctionState === 'object' ? correctionState[nextCycle] : undefined) ?? 'STATE_CONFLICT'
  }
  const state = VERDICT_TO_STATE[verdict]
  return typeof state === 'string' ? state : 'STATE_CONFLICT'
}

function nextActionForVerdict(verdict: string, reviewCycle: number): string {
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
