type IssueBoundComment = {
  issue_number?: unknown
  issue_url?: unknown
}

/**
 * Proves a GitHub Issue comment's repository and Issue from GitHub's REST
 * issue_url. issue_number can corroborate that URL but cannot replace it:
 * without the URL it has no repository provenance.
 */
export function hasAuthoritativeIssueIdentity(
  comment: IssueBoundComment,
  { repository, issueNumber }: { repository: string; issueNumber: number },
): boolean {
  if (typeof comment.issue_url !== 'string') return false
  let issueUrl: URL
  try { issueUrl = new URL(comment.issue_url) } catch { return false }
  if (issueUrl.protocol !== 'https:' || issueUrl.hostname !== 'api.github.com' || issueUrl.search || issueUrl.hash) return false
  const segments = issueUrl.pathname.split('/').filter(Boolean)
  if (segments.length !== 5 || segments[0] !== 'repos' || segments[3] !== 'issues') return false
  const [owner, name, issue] = [segments[1], segments[2], segments[4]]
  if (`${owner}/${name}` !== repository || !/^[1-9]\d*$/.test(issue) || Number(issue) !== issueNumber) return false
  return comment.issue_number == null || (Number.isSafeInteger(Number(comment.issue_number)) && Number(comment.issue_number) === Number(issue))
}
