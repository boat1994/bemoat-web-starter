export type FinalResultOptions = {
  issueNumber: unknown
  prNumber: unknown
  reviewedHead: unknown
  mergeCommit: unknown
  base: unknown
  policyVersion: unknown
  nextAction?: unknown
  projectionKind?: unknown
  campaignIssue?: unknown
  campaignBlockerId?: unknown
}

export function renderFinalResultBody({
  issueNumber,
  prNumber,
  reviewedHead,
  mergeCommit,
  base,
  policyVersion,
  nextAction,
  projectionKind,
  campaignIssue = null,
  campaignBlockerId = null,
}: FinalResultOptions): string {
  const lines = [
    '## RESULT',
    '',
    `**Task / Issue:** #${issueNumber}`,
    '**Phase:** Merge completion',
    `**PR / base / head:** PR #${prNumber} · \`${base}\` · \`${reviewedHead}\``,
    `**Policy:** \`${policyVersion}\``,
    `**Merged commit:** \`${mergeCommit}\``,
    '**Verdict:** DONE',
    `**Next:** ${nextAction ?? 'select the next campaign action; do not start it in this bundle.'}`,
  ]
  if (projectionKind === 'blocker-resolution') {
    lines.splice(4, 0, '**Projection:** blocker-resolution')
    lines.splice(5, 0, `**Campaign blocker:** #${campaignIssue} · \`${campaignBlockerId}\``)
  }
  return lines.join('\n')
}
