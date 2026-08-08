import { parseFounderMergeAuthorization } from './merge-founder-authority.mjs'

/**
 * Classify whether a comment explicitly supersedes a target comment.
 *
 * @param {unknown} body
 * @param {string | number} targetCommentId
 * @returns {boolean}
 */
export function commentSupersedesId(body, targetCommentId) {
  const text = String(body ?? '')
  if (text.includes(`supersedes: ${targetCommentId}`) ||
    text.includes(`superseded_comment_id: ${targetCommentId}`) ||
    (text.includes(String(targetCommentId)) && /superseded|not authoritative/i.test(text))) {
    return true
  }
  try {
    const parsed = parseFounderMergeAuthorization(text)
    const supersededIds = [
      ...(Array.isArray(parsed.supersedes_comment_ids) ? parsed.supersedes_comment_ids : []),
      ...(parsed.supersedes_comment_id == null ? [] : [parsed.supersedes_comment_id]),
    ]
    return supersededIds.some((id) => String(id) === String(targetCommentId))
  } catch {
    return false
  }
}
