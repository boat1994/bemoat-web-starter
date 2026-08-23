import { Buffer } from 'buffer'
import {
  parseRoleCommentBody,
  findLatestRoleComment,
  isExplicitlyNonAuthoritativeRoleBody,
  selectActiveRoleComments,
} from '../../mission-control-reconcile.mjs'
import { normalizeTransitionIdentity } from '../../mission-control/transition-identity.mjs'

function getCommentBody(comment) {
  return comment.body || comment.body_html || ''
}

export { isExplicitlyNonAuthoritativeRoleBody, selectActiveRoleComments }

function isDiagnosticOrReconciliationRoleBody(body) {
  return (
    /\b(?:mission\s+control|state(?:-conflict)?)\s+reconciliation\b/i.test(body) ||
    /\bPhase:\s*(?:Mission Control|State)\s*(?:Reconciliation|Reconciler)/i.test(body) ||
    /\bno\s+repository\s+code\b/i.test(body) ||
    /\blocal-only\s+evidence\b/i.test(body)
  )
}

function hasApprovedOrDeliveryRoleBody(body, role) {
  if (/founder_decision:\s*approved/i.test(body)) return true
  if (/authorization:\s*[\s\S]*?status:\s*approved/i.test(body)) return true
  if (role === 'REVIEW_VERDICT' && /^\*\*Verdict:\*\*/m.test(body)) return true
  if (role === 'RESULT' && (
    /\bPR:\s*#\d+/i.test(body) ||
    /\*\*PR:\*\*/i.test(body) ||
    /\*\*Delivery\*\*/i.test(body) ||
    /Branch\s*\/\s*Head:/i.test(body) ||
    /Exact head(?: reviewed)?:/i.test(body) ||
    /Commands reported/i.test(body) ||
    /\bPhase:\s*Dev\b/i.test(body)
  )) return true
  if (role === 'HANDOFF' && /\*\*Target:\*\*/i.test(body) && /\*\*Objective:\*\*/i.test(body)) return true
  return false
}

function isBindableResultBody(body) {
  const parsed = parseRoleCommentBody(body)
  const identity = normalizeTransitionIdentity(body, { role: 'RESULT' })
  return parsed.role === 'RESULT' &&
    /^[1-9]\d*$/.test(identity.taskId) &&
    /^[1-9]\d*$/.test(String(parsed.prNumber ?? '').trim()) &&
    Boolean(parsed.base) &&
    /^[0-9a-f]{40}$/i.test(String(parsed.headSha ?? '').trim()) &&
    !isDiagnosticOrReconciliationRoleBody(body)
}

function projectCommentId(rawComment) {
  const databaseId = String(rawComment.databaseId ?? '').trim()
  const rawId = String(rawComment.id ?? '').trim()
  const urlId = String(rawComment.url || rawComment.html_url || '')
    .match(/(?:issuecomment-|comments\/)(\d+)(?:$|[/?#])/i)?.[1] ?? null
  const numericIds = [databaseId, rawId, urlId].filter((value) => /^[1-9]\d*$/.test(value))
  if (new Set(numericIds).size > 1) return null
  if (/^[1-9]\d*$/.test(databaseId)) return rawComment.databaseId
  if (/^[1-9]\d*$/.test(rawId)) return rawComment.id
  if (urlId) return urlId
  return rawComment.id ?? rawComment.databaseId ?? rawComment.node_id ?? null
}

/**
 * Select authoritative role comments using approval/delivery and supersession
 * semantics instead of timestamp-only comparison.
 *
 * @param {Array<Record<string, unknown>>} comments
 * @param {'HANDOFF' | 'RESULT' | 'REVIEW_VERDICT'} role
 */
export function selectAuthoritativeRoleComments(comments = [], role) {
  const authoritative = new Set()

  const roleEntries = comments
    .map((comment) => ({ comment, body: getCommentBody(comment) }))
    .filter(({ body }) => parseRoleCommentBody(body).role === role)

  // Active non-superseded comments form the authority pool; superseded history
  // is never selected as competing live authority.
  const active = selectActiveRoleComments(comments, role)
  const viable = active.map((comment) => ({ comment, body: getCommentBody(comment) }))
  const bindableResults = role === 'RESULT'
    ? viable.filter(({ body }) => isBindableResultBody(body))
    : []
  const selectable = role === 'RESULT'
    ? viable.filter(({ body }) => !isDiagnosticOrReconciliationRoleBody(body))
    : viable
  const approved = selectable.filter(({ body }) => hasApprovedOrDeliveryRoleBody(body, role))
  const diagnostic = viable.filter(({ body }) => isDiagnosticOrReconciliationRoleBody(body))

  for (const { comment } of bindableResults) authoritative.add(comment)

  if (approved.length > 0) {
    const latestApproved = findLatestRoleComment(
      approved.map(({ comment }) => comment),
      role,
    )
    if (latestApproved) authoritative.add(latestApproved.comment)
  } else if (diagnostic.length > 0 && role !== 'RESULT') {
    const latestDiagnostic = findLatestRoleComment(
      diagnostic.map(({ comment }) => comment),
      role,
    )
    if (latestDiagnostic) authoritative.add(latestDiagnostic.comment)
  } else if (selectable.length > 0) {
    const latest = findLatestRoleComment(
      selectable.map(({ comment }) => comment),
      role,
    )
    if (latest) authoritative.add(latest.comment)
  }

  for (const { comment, body } of roleEntries) {
    const parsed = parseRoleCommentBody(body)
    if (!parsed.role) continue
    if (isExplicitlyNonAuthoritativeRoleBody(body)) continue
    if (role === 'RESULT' && isDiagnosticOrReconciliationRoleBody(body)) continue
    const ts = Date.parse(comment.createdAt || comment.created_at || '')
    if (Number.isNaN(ts)) {
      authoritative.add(comment)
    }
  }

  return authoritative
}

export function projectComments(comments = []) {
  if (!Array.isArray(comments)) return comments

  const authoritativeComments = new Set()

  const roles = ['HANDOFF', 'RESULT', 'REVIEW_VERDICT']
  for (const role of roles) {
    for (const comment of selectAuthoritativeRoleComments(comments, role)) {
      authoritativeComments.add(comment)
    }
  }

  return comments.map(rawComment => {
    let body = rawComment.body
    if (!body && rawComment.body_html) {
      body = rawComment.body_html
    } else if (!body) {
      body = ''
    }

    const isAuthoritative = authoritativeComments.has(rawComment)
    const parsed = parseRoleCommentBody(body)
    const isDiagnosticResult = parsed.role === 'RESULT' && isDiagnosticOrReconciliationRoleBody(body)
    const isFounderDecision =
      !isDiagnosticResult && (
        body.includes('founder_decision:') ||
        body.includes('Founder decision:') ||
        /\b[Ff]ounder\s+gate:\s*Required\b/.test(body) ||
        body.includes('ELIGIBLE FOR FOUNDER REVIEW')
      )

    let projectedBody = body
    if (!isAuthoritative && !isFounderDecision) {
      if (parsed && parsed.role) {
        projectedBody = `[Superseded ${parsed.role} comment. View original at ${rawComment.url || 'GitHub'}]`
      } else if (body.length > 500) {
        projectedBody = body.substring(0, 500) + `...\n\n[Comment truncated for context size. View full comment at ${rawComment.url || 'GitHub'}]`
      }
    }

    const projected = {
      id: projectCommentId(rawComment),
      url: rawComment.url,
      author: rawComment.author?.login || rawComment.user?.login || 'unknown',
      body: projectedBody
    }

    const createdAt = rawComment.createdAt || rawComment.created_at
    if (createdAt !== undefined) projected.createdAt = createdAt

    if (rawComment.path !== undefined) projected.path = rawComment.path
    if (rawComment.line !== undefined) projected.line = rawComment.line
    if (rawComment.inReplyTo || rawComment.in_reply_to_id) {
      projected.inReplyTo = rawComment.inReplyTo || rawComment.in_reply_to_id
    }
    const updatedAt = rawComment.updatedAt || rawComment.updated_at
    if (updatedAt !== undefined) projected.updatedAt = updatedAt

    const prReviewId = rawComment.pullRequestReviewId || rawComment.pull_request_review_id
    if (prReviewId !== undefined) projected.pullRequestReviewId = prReviewId

    if (rawComment.side !== undefined) projected.side = rawComment.side
    const startLine = rawComment.startLine || rawComment.start_line
    if (startLine !== undefined) projected.startLine = startLine

    const startSide = rawComment.startSide || rawComment.start_side
    if (startSide !== undefined) projected.startSide = startSide

    return projected
  })
}

export function benchmarkProjection(rawComments, projectedComments) {
  const rawJson = JSON.stringify(rawComments) || '[]'
  const projJson = JSON.stringify(projectedComments) || '[]'

  return {
    rawBytes: Buffer.byteLength(rawJson, 'utf8'),
    rawTokens: Math.ceil(rawJson.length / 4),
    projectedBytes: Buffer.byteLength(projJson, 'utf8'),
    projectedTokens: Math.ceil(projJson.length / 4)
  }
}
