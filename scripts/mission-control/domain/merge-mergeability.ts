const MERGEABILITY_FAILURE_REASON = 'PR mergeability changed or is not verified as MERGEABLE'

type PullRequest = {
  mergeable?: unknown
} | null | undefined

type MergeabilityResult = {
  valid: boolean
  reason: string | null
}

export function classifyMergeability(pr: PullRequest): MergeabilityResult {
  const valid = String(pr?.mergeable ?? '').toUpperCase() === 'MERGEABLE'
  return {
    valid,
    reason: valid ? null : MERGEABILITY_FAILURE_REASON,
  }
}
