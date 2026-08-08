const MERGEABILITY_FAILURE_REASON = 'PR mergeability changed or is not verified as MERGEABLE'

export function classifyMergeability(pr) {
  const valid = String(pr?.mergeable ?? '').toUpperCase() === 'MERGEABLE'
  return {
    valid,
    reason: valid ? null : MERGEABILITY_FAILURE_REASON,
  }
}
