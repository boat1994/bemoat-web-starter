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
  const match = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)$/.exec(comment.issue_url)
  if (!match) return false
  const [, owner, name, issue] = match
  if (`${owner}/${name}` !== repository || !/^[1-9]\d*$/.test(issue) || Number(issue) !== issueNumber) return false
  return comment.issue_number == null || (typeof comment.issue_number === 'number' && Number.isSafeInteger(comment.issue_number) && comment.issue_number === Number(issue))
}

export function resolveParentIssueIdentity(comment: IssueBoundComment): string {
  let fromNumber: string | undefined
  if (comment.issue_number != null) {
    const num = String(comment.issue_number)
    if (!/^[1-9]\d*$/.test(num)) {
      throw new Error('invalid issue_number')
    }
    fromNumber = num
  }

  let fromUrl: string | undefined
  if (comment.issue_url != null) {
    if (typeof comment.issue_url !== 'string') {
      throw new Error('issue_url must be a string')
    }
    const match = /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/issues\/([1-9]\d*)$/.exec(comment.issue_url)
    if (!match) {
      throw new Error('malformed issue_url')
    }
    fromUrl = match[1]
  }

  if (fromNumber !== undefined && fromUrl !== undefined) {
    if (fromNumber !== fromUrl) {
      throw new Error('issue_number and issue_url identify different issues')
    }
  }

  const result = fromNumber ?? fromUrl
  if (result === undefined) {
    throw new Error('missing issue identity')
  }

  return result
}
