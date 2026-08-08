import {
  normalizeTransitionIdentity,
  transitionIdentityMatches,
} from './transition-identity.mjs'
import {
  headsAlign,
  normalizeAuthorityBase,
  parseRoleCommentBody,
  selectActiveRoleComments,
} from './review-verdict-binding.mjs'

/**
 * @param {number} matchCount
 * @returns {'BLOCKED_EXTERNAL' | 'STATE_CONFLICT' | 'RESUME_PROJECTION'}
 */
export function classifyTransition(matchCount) {
  if (matchCount === 0) return 'BLOCKED_EXTERNAL'
  if (matchCount > 1) return 'STATE_CONFLICT'
  return 'RESUME_PROJECTION'
}

export const DEFAULT_MC_TRUSTED_ASSOCIATIONS = Object.freeze([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
])

/**
 * Production trust filter for authoritative Mission Control role comments.
 * Override authors with `BEMOAT_MC_TRUSTED_AUTHORS` (comma-separated).
 *
 * @param {{ env?: NodeJS.ProcessEnv, trustedAuthors?: string[] | null, trustedAssociations?: string[] | null }} [input]
 */
export function resolveProductionCommentTrust({
  env = process.env,
  trustedAuthors = null,
  trustedAssociations = null,
} = {}) {
  const fromEnv = String(env.BEMOAT_MC_TRUSTED_AUTHORS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const defaultAuthor = env.GITHUB_REPOSITORY_OWNER || 'boat1994'
  return {
    trustedAuthors: trustedAuthors?.length
      ? trustedAuthors
      : (fromEnv.length ? fromEnv : [defaultAuthor]),
    requireTrustedAuthor: true,
    trustedAssociations: trustedAssociations?.length
      ? trustedAssociations
      : [...DEFAULT_MC_TRUSTED_ASSOCIATIONS],
  }
}

/**
 * @param {Array<{ body?: string, id?: string | number, author?: string, user?: { login?: string }, author_association?: string }>} comments
 * @param {{ taskId: string, phase: string, role: string, contentHash: string }} identity
 * @param {{
 *   activeOnly?: boolean,
 *   bindings?: { prNumber?: string | number | null, base?: string | null, headSha?: string | null, taskId?: string | null, phase?: string | null },
 *   trustedAuthors?: string[],
 *   requireTrustedAuthor?: boolean,
 *   trustedAssociations?: string[],
 * }} [options]
 */
export function findMatchingComments(comments = [], identity, options = {}) {
  const pool = options.activeOnly === false
    ? comments
    : selectActiveRoleComments(comments, identity.role)
  const bindings = options.bindings ?? null
  const trustedAuthors = options.trustedAuthors ?? null
  const trustedAssociations = options.trustedAssociations ?? null

  return pool
    .map((comment) => ({
      comment,
      identity: normalizeTransitionIdentity(comment.body ?? ''),
      parsed: parseRoleCommentBody(comment.body ?? ''),
      author: comment.author || comment.user?.login || null,
      association: comment.author_association || comment.authorAssociation || null,
    }))
    .filter((entry) => {
      if (entry.identity.role !== identity.role) return false
      if (!transitionIdentityMatches(entry.identity, identity)) return false
      if (bindings?.taskId && entry.identity.taskId && String(entry.identity.taskId) !== String(bindings.taskId)) {
        return false
      }
      if (bindings?.phase && entry.identity.phase && entry.identity.phase !== bindings.phase) {
        return false
      }
      if (
        bindings?.prNumber &&
        (!entry.parsed.prNumber || String(entry.parsed.prNumber) !== String(bindings.prNumber))
      ) {
        return false
      }
      if (
        bindings?.headSha &&
        (!entry.parsed.headSha || !headsAlign(entry.parsed.headSha, bindings.headSha))
      ) {
        return false
      }
      if (
        bindings?.base &&
        normalizeAuthorityBase(entry.parsed.base) !== normalizeAuthorityBase(bindings.base)
      ) {
        return false
      }
      if (trustedAuthors?.length) {
        if (!entry.author || !trustedAuthors.includes(entry.author)) return false
      } else if (options.requireTrustedAuthor && !entry.author) {
        return false
      }
      if (trustedAssociations?.length) {
        if (!entry.association || !trustedAssociations.includes(entry.association)) {
          return false
        }
      }
      return true
    })
    .map((entry) => entry.comment)
}

/**
 * Prove that a successful role-comment POST is durable and still carries the
 * intended identity and GitHub metadata.
 *
 * @param {{
 *   comments?: Array<{ body?: string, id?: string | number, author?: string, author_association?: string }>,
 *   body: string,
 *   role: 'HANDOFF' | 'RESULT' | 'REVIEW_VERDICT',
 *   postedId?: string | number | null,
 *   matchOptions?: Record<string, unknown>,
 * }} input
 */
export function verifyPostedCommentReadback({
  comments = [],
  body,
  role,
  postedId = null,
  matchOptions = {},
}) {
  if (postedId == null) {
    throw new Error(`postcondition: live ${role} comment readback requires the authoritative POST comment id`)
  }
  const identity = normalizeTransitionIdentity(body, { role })
  const matches = findMatchingComments(comments, identity, {
    activeOnly: false,
    ...matchOptions,
  })
    .filter((comment) => postedId == null || String(comment.id) === String(postedId))
  if (matches.length !== 1) {
    throw new Error(
      `postcondition: live ${role} comment readback found ${matches.length} matching comment(s)`,
    )
  }

  const [comment] = matches
  if (String(comment.body ?? '') !== String(body)) {
    throw new Error(`postcondition: live ${role} comment body differs from the intended body`)
  }
  const author = comment.author || comment.user?.login || null
  const association = comment.author_association || comment.authorAssociation || null
  if (
    comment.id == null ||
    !author ||
    author === 'unknown' ||
    !association
  ) {
    throw new Error(`postcondition: live ${role} comment metadata is incomplete`)
  }
  return comment
}

/**
 * Parse concatenated JSON arrays produced by `gh api --paginate`.
 * @param {string} stdout
 * @returns {Array<Record<string, unknown>>}
 */
export function parsePaginatedGhApiJson(stdout = '') {
  const trimmed = String(stdout ?? '').trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return JSON.parse(trimmed.replace(/\]\s*\[/g, ','))
  }
}

/**
 * Normalize raw GitHub issue comments into coordinator transport shape.
 * @param {Array<Record<string, unknown>>} rawComments
 */
export function normalizeIssueComments(rawComments = []) {
  return rawComments.map((comment) => ({
    id: comment.id ?? comment.databaseId ?? comment.node_id ?? null,
    body: comment.body ?? '',
    author: comment.author?.login || comment.user?.login || 'unknown',
    user: comment.user || (comment.author ? { login: comment.author.login } : undefined),
    author_association: comment.author_association || comment.authorAssociation || null,
    createdAt: comment.createdAt || comment.created_at || null,
    updatedAt: comment.updatedAt || comment.updated_at || null,
    url: comment.html_url || comment.url || null,
  }))
}

/**
 * @param {{
 *   comments?: Array<{ body?: string, id?: string | number, author?: string, user?: { login?: string }, author_association?: string }>,
 *   identity: object,
 *   body?: string,
 *   role?: 'HANDOFF' | 'RESULT' | 'REVIEW_VERDICT',
 *   postedId?: string | number | null,
 *   ambiguousPost?: boolean,
 *   matchOptions?: object,
 * }} input
 */
export function recoverAmbiguousPost({
  comments = [],
  identity,
  body = null,
  role = identity?.role ?? null,
  postedId = null,
  ambiguousPost = true,
  matchOptions = { activeOnly: true },
}) {
  if (ambiguousPost) {
    if (postedId == null || typeof body !== 'string' || !role) {
      const error = new Error('AMBIGUOUS_RESULT: possible POST has no complete authoritative comment identity')
      error.classification = 'AMBIGUOUS_RESULT'
      error.mutationPerformed = true
      return { classification: 'AMBIGUOUS_RESULT', error }
    }
    try {
      const comment = verifyPostedCommentReadback({
        comments,
        body,
        role,
        postedId,
        matchOptions,
      })
      return { classification: 'RESUME_PROJECTION', comment, recovered: true }
    } catch (error) {
      const ambiguous = error instanceof Error ? error : new Error(String(error))
      ambiguous.classification = 'AMBIGUOUS_RESULT'
      ambiguous.mutationPerformed = true
      return {
        classification: 'AMBIGUOUS_RESULT',
        error: ambiguous,
      }
    }
  }

  if (postedId != null && typeof body === 'string' && role) {
    try {
      const comment = verifyPostedCommentReadback({
        comments,
        body,
        role,
        postedId,
        matchOptions,
      })
      return { classification: 'RESUME_PROJECTION', comment, recovered: true }
    } catch {
      return { classification: 'BLOCKED_EXTERNAL', error: new Error('posted role comment was not found') }
    }
  }

  const matches = findMatchingComments(comments, identity, matchOptions)
  const classification = classifyTransition(matches.length)
  if (classification === 'RESUME_PROJECTION') {
    return { classification, comment: matches[0], recovered: ambiguousPost }
  }
  if (classification === 'STATE_CONFLICT') {
    return { classification, error: new Error('ambiguous POST resolved to competing matches') }
  }
  if (ambiguousPost) {
    const error = new Error('ambiguous POST has no provable match')
    error.classification = 'AMBIGUOUS_RESULT'
    error.mutationPerformed = true
    return {
      classification: 'AMBIGUOUS_RESULT',
      error,
    }
  }
  return { classification, error: new Error('ambiguous POST has no provable match') }
}
