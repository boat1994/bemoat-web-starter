import { parseRoleCommentBody } from './review-verdict-binding.mjs'

/**
 * Select the most recent comment matching a canonical role marker.
 *
 * @param {Array<{ body?: string, createdAt?: string }>} comments
 * @param {'HANDOFF' | 'RESULT' | 'REVIEW_VERDICT'} role
 */
export function findLatestRoleComment(comments = [], role) {
  const matches = comments
    .map((comment) => ({ comment, parsed: parseRoleCommentBody(comment.body ?? '') }))
    .filter((entry) => entry.parsed.role === role)

  if (matches.length === 0) return null

  matches.sort((left, right) => {
    const leftTime = Date.parse(left.comment.createdAt ?? '') || 0
    const rightTime = Date.parse(right.comment.createdAt ?? '') || 0
    return rightTime - leftTime
  })

  return matches[0]
}
