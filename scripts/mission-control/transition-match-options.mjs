import { parseRoleCommentBody } from './review-verdict-binding.mjs'
import { normalizeTransitionIdentity } from './transition-identity.mjs'

/**
 * Assemble the immutable transition identity and the live-comment matching
 * bindings used by the coordinator.
 *
 * @param {{
 *   roleBody: string,
 *   role: 'HANDOFF' | 'RESULT' | 'REVIEW_VERDICT',
 *   trustedAuthors?: string[] | null,
 *   requireTrustedAuthor?: boolean,
 *   trustedAssociations?: string[] | null,
 *   verifiedHead?: string | null,
 *   verifiedBase?: string | null,
 * }} input
 */
export function buildTransitionMatchOptions({
  roleBody,
  role,
  trustedAuthors = null,
  requireTrustedAuthor = false,
  trustedAssociations = null,
  verifiedHead = null,
  verifiedBase = null,
}) {
  const parsed = parseRoleCommentBody(roleBody)
  const identity = normalizeTransitionIdentity(roleBody, { role })
  return {
    identity,
    options: {
      activeOnly: true,
      bindings: {
        taskId: identity.taskId || null,
        phase: identity.phase || null,
        prNumber: parsed.prNumber,
        base: verifiedBase ?? parsed.base,
        headSha: verifiedHead ?? parsed.headSha,
      },
      trustedAuthors: trustedAuthors ?? undefined,
      requireTrustedAuthor,
      trustedAssociations: trustedAssociations ?? undefined,
    },
  }
}
