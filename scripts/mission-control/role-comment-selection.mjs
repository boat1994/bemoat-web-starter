import { normalizeAuthorityBase, parseRoleCommentBody, selectActiveRoleComments } from './review-verdict-binding.mjs'
import { normalizeTransitionIdentity } from './transition-identity.mjs'

/**
 * Select the most recent comment matching a canonical role marker.
 *
 * @param {Array<{ body?: string, createdAt?: string }>} comments
 * @param {'HANDOFF' | 'RESULT' | 'REVIEW_VERDICT'} role
 * @param {{ taskId?: string|number, prNumber?: string|number, base?: string, headSha?: string }=} binding
 */
export function findLatestRoleComment(comments = [], role, binding = null) {
  let matches = selectActiveRoleComments(comments, role)
    .map((comment) => ({ comment, parsed: parseRoleCommentBody(comment.body ?? '') }))
    .filter((entry) => entry.parsed.role === role)
  if (binding) {
    const taskId = String(binding.taskId ?? '').trim().replace(/^#/, '')
    const prNumber = String(binding.prNumber ?? '').trim().replace(/^#/, '')
    const base = normalizeAuthorityBase(binding.base)
    const headSha = String(binding.headSha ?? '').trim().toLowerCase()
    matches = matches.filter((entry) =>
      normalizeTransitionIdentity(entry.comment.body ?? '').taskId === taskId &&
      String(entry.parsed.prNumber ?? '').trim() === prNumber &&
      normalizeAuthorityBase(entry.parsed.base) === base &&
      String(entry.parsed.headSha ?? '').trim().toLowerCase() === headSha,
    )
    if (matches.length !== 1) return null
  }

  if (matches.length === 0) return null

  matches.sort((left, right) => {
    const leftTime = Date.parse(left.comment.createdAt ?? '') || 0
    const rightTime = Date.parse(right.comment.createdAt ?? '') || 0
    return rightTime - leftTime
  })

  return matches[0]
}
