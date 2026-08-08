import {
  normalizeTransitionIdentity,
  serializeTransitionIdentity,
} from './transition-identity.mjs'
import { selectActiveRoleComments } from './review-verdict-binding.mjs'
import {
  findMatchingComments,
  recoverAmbiguousPost,
} from './comment-evidence.mjs'

/**
 * Resolve an authoritative role comment, creating it only when no matching
 * live evidence exists and recovering safely from an ambiguous POST.
 *
 * @param {{
 *   roleBody: string,
 *   role: 'HANDOFF' | 'RESULT' | 'REVIEW_VERDICT',
 *   identity: Record<string, unknown>,
 *   options: Record<string, unknown>,
 *   listComments: () => Promise<Array<{ body?: string, id?: string | number }>>,
 *   postComment: (body: string) => Promise<{ id?: string | number, body?: string }>,
 * }} input
 */
export async function resolveRoleComment({
  roleBody,
  role,
  identity,
  options,
  listComments,
  postComment,
}) {
  const comments = await listComments()
  const activeRoleComments = selectActiveRoleComments(comments, role)
  if (role === 'HANDOFF' && activeRoleComments.length > 1) {
    const identities = new Set(
      activeRoleComments.map((comment) => serializeTransitionIdentity(normalizeTransitionIdentity(comment.body ?? ''))),
    )
    if (identities.size > 1) {
      throw new Error('STATE_CONFLICT: competing HANDOFF comments')
    }
  }
  if (identity.taskId) {
    const sameTaskComments = activeRoleComments.filter((comment) =>
      normalizeTransitionIdentity(comment.body ?? '').taskId === identity.taskId,
    )
    if (sameTaskComments.length > 1) {
      throw new Error(`STATE_CONFLICT: competing role comments for ${role}`)
    }
  }
  const matches = findMatchingComments(comments, identity, options)
  if (matches.length === 0) {
    try {
      const posted = await postComment(roleBody)
      if (posted?.id == null) {
        throw new Error('posted role comment did not return a durable comment identifier')
      }
      return { identity, comment: posted, created: true }
    } catch (error) {
      const possibleMutation = error?.mutationPerformed === true
      const postedId = error?.postedCommentId ?? error?.authoritativePostId ?? null
      let recovery
      try {
        recovery = recoverAmbiguousPost({
          comments: await listComments(),
          identity,
          body: roleBody,
          role,
          postedId,
          ambiguousPost: possibleMutation,
          matchOptions: options,
        })
      } catch (recoveryError) {
        if (!possibleMutation) throw error
        const ambiguous = new Error(
          `AMBIGUOUS_RESULT: unable to verify the outcome of the role comment POST: ${
            recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
          }`,
          { cause: error },
        )
        ambiguous.classification = 'AMBIGUOUS_RESULT'
        ambiguous.mutationPerformed = true
        if (typeof error?.legacyClassification === 'string') {
          ambiguous.legacyClassification = error.legacyClassification
        }
        throw ambiguous
      }
      if (recovery.classification === 'RESUME_PROJECTION' && recovery.comment) {
        return { identity, comment: recovery.comment, created: false, recovered: true }
      }
      if (recovery.classification === 'AMBIGUOUS_RESULT') {
        const ambiguous = recovery.error ?? new Error('ambiguous POST has no provable match')
        ambiguous.classification = 'AMBIGUOUS_RESULT'
        ambiguous.mutationPerformed = true
        throw ambiguous
      }
      if (recovery.classification === 'STATE_CONFLICT') {
        const conflict = new Error('STATE_CONFLICT: ambiguous POST resolved to competing matches', { cause: error })
        conflict.classification = 'STATE_CONFLICT'
        conflict.mutationPerformed = possibleMutation
        throw conflict
      }
      throw error
    }
  }
  if (matches.length > 1) {
    throw new Error('STATE_CONFLICT: competing role comments for the same transition identity')
  }
  return { identity, comment: matches[0], created: false }
}
