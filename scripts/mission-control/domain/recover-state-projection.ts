type RuntimeObject = Record<string, unknown>

type ProjectionOptions = {
  issueNumber: string | number
  expectedPr: string | number
  predecessorComment: string | number
}

type ProjectionPr = { baseRefName: string; headRefOid: unknown }
type ProjectionPredecessor = {
  counters: { reviewCycle: number; fullReviewCount: number }
  updatedAt: unknown
  reviewedHead: unknown
  contract: { mode: unknown }
  findingIds: unknown
}
type ProjectionPolicy = { guideVersion: unknown; ref: unknown; sha: unknown }

const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const NEXT_ACTION_COMMAND = 'bemoat:mission-control:adopt-finding'

function normalizeSha(value: unknown): string | null {
  return typeof value === 'string' && FULL_SHA_RE.test(value.trim())
    ? value.trim().toLowerCase()
    : null
}

export function buildReconstructedState({
  options,
  pr,
  predecessor,
  policy,
  evidenceFingerprint,
}: {
  options: ProjectionOptions
  pr: ProjectionPr
  predecessor: ProjectionPredecessor
  policy: ProjectionPolicy
  evidenceFingerprint: unknown
}): RuntimeObject {
  const { reviewCycle, fullReviewCount } = predecessor.counters
  const state = reviewCycle === 1 ? 'CORRECTION_REQUIRED_1' : 'CORRECTION_REQUIRED_2'
  const timestamp = predecessor.updatedAt
  return {
    schema_version: 1,
    state,
    review_cycle: reviewCycle,
    full_review_count: fullReviewCount,
    approved_base: pr.baseRefName,
    active_task_issue: `#${options.issueNumber}`,
    active_pr: `#${options.expectedPr}`,
    current_head: normalizeSha(pr.headRefOid),
    last_reviewed_head: predecessor.reviewedHead,
    workflow_mode: predecessor.contract.mode,
    guide_version: policy.guideVersion,
    guide_source_ref: policy.ref,
    guide_source_sha: normalizeSha(policy.sha),
    latest_review_verdict_comment_id: String(options.predecessorComment),
    open_blockers: predecessor.findingIds,
    follow_up_issues: [],
    next_permitted_action: `Re-attempt Founder-authorized ${NEXT_ACTION_COMMAND} for Issue #${options.issueNumber} after fresh live verification; do not execute automatically.`,
    material_change_status: 'none',
    updated_at: timestamp,
    updated_by: 'Mission Control Missing-State Recovery',
    recovery_evidence_fingerprint: evidenceFingerprint,
  }
}
