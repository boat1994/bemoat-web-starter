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
  const segments = issueUrl.pathname.split('/')
  if (segments.length !== 6 || segments[0] !== '' || segments[1] !== 'repos' || segments[4] !== 'issues') return false
  const [owner, name, issue] = [segments[2], segments[3], segments[5]]
  if (`${owner}/${name}` !== repository || !/^[1-9]\d*$/.test(issue) || Number(issue) !== issueNumber) return false
  return comment.issue_number == null || (typeof comment.issue_number === 'number' && Number.isSafeInteger(comment.issue_number) && comment.issue_number === Number(issue))
}
