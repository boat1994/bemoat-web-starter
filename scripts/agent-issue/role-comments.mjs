import { findLatestRoleComment, parseRoleCommentBody } from '../mission-control-reconcile.mjs'

function getCommentBody(comment) {
  return comment.body || comment.body_html || ''
}

function commentDatabaseId(comment) {
  const explicit = comment.databaseId ?? comment.database_id
  if (explicit != null && /^[1-9]\d*$/.test(String(explicit))) return String(explicit)
  if (comment.id != null && /^[1-9]\d*$/.test(String(comment.id))) return String(comment.id)
  const url = comment.url ?? comment.html_url ?? ''
  return String(url).match(/#issuecomment-(\d+)$/)?.[1] ?? null
}

function isExplicitlyNonAuthoritativeRoleBody(body) {
  return (
    /\[(?:diagnostic|stale|superseded)\]/i.test(body) ||
    (/\b(?:hereby\s+)?superseded\b/i.test(body) && /\bnot\s+authorized\b/i.test(body)) ||
    /\bnot\s+authoritative\b/i.test(body)
  )
}

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

export function selectAuthoritativeRoleComments(comments = [], role) {
  const authoritative = new Set()
  const roleEntries = comments
    .map((comment) => ({ comment, body: getCommentBody(comment) }))
    .filter(({ body }) => parseRoleCommentBody(body).role === role)
  const viable = roleEntries.filter(({ body }) => !isExplicitlyNonAuthoritativeRoleBody(body))
  const approved = viable.filter(({ body }) => hasApprovedOrDeliveryRoleBody(body, role))
  const diagnostic = viable.filter(({ body }) => isDiagnosticOrReconciliationRoleBody(body))
  const candidates = approved.length > 0 ? approved : diagnostic.length > 0 ? diagnostic : viable
  const selected = findLatestRoleComment(candidates.map(({ comment }) => comment), role)
  if (selected) authoritative.add(selected.comment)

  for (const { comment } of roleEntries) {
    const timestamp = Date.parse(comment.createdAt ?? comment.created_at ?? '')
    if (Number.isNaN(timestamp)) authoritative.add(comment)
  }

  return authoritative
}

export function selectCurrentRoleComment(comments = [], role) {
  const selected = [...selectAuthoritativeRoleComments(comments, role)]
  return findLatestRoleComment(selected, role)
}

export function findHistoricalCommentByDatabaseId(comments = [], databaseId, role = null) {
  const expectedId = String(databaseId)
  const matches = comments.filter((comment) => commentDatabaseId(comment) === expectedId)
  if (matches.length === 0) {
    return { ok: false, errors: ['STATE CONFLICT: historical comment evidence is missing'], comment: null }
  }
  if (matches.length > 1) {
    return { ok: false, errors: ['STATE CONFLICT: historical comment evidence is duplicated'], comment: null }
  }
  if (role && parseRoleCommentBody(getCommentBody(matches[0])).role !== role) {
    return { ok: false, errors: [`STATE CONFLICT: historical comment evidence is not a ${role}`], comment: null }
  }
  return { ok: true, errors: [], comment: matches[0] }
}
