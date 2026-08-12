import { randomBytes as cryptoRandomBytes } from 'node:crypto'

export const LEASE_MARKER = '<!-- bemoat-mission-control-task-bootstrap-lease:v1 -->'

const LEASE_END_MARKER = LEASE_MARKER.replace(':v1', ':end')

function leaseError(code, message, cause) {
  const error = new Error(`${code}: ${message}`, cause ? { cause } : undefined)
  error.code = code
  error.classification = code
  return error
}

function leaseConflict(message, cause) { return leaseError('CAS_CONFLICT', message, cause) }

export function workflowLeaseBody({ scope, requestId, status, leaseToken, issueNumber, observedBodySha256 = null }) {
  return [LEASE_MARKER, '```json', JSON.stringify({
    schema_version: 1,
    scope,
    issue_number: Number(issueNumber),
    request_id: requestId,
    status,
    ['token']: leaseToken,
    observed_body_sha256: observedBodySha256,
  }), '```', LEASE_END_MARKER].join('\n')
}

export function parseLeaseComment(comment) {
  const body = String(comment?.body ?? '')
  if (!body.includes(LEASE_MARKER)) return null
  const raw = body.replace(LEASE_MARKER, '').replace(LEASE_END_MARKER, '').replace(/```json\s*|```/g, '').trim()
  try {
    const parsed = JSON.parse(raw)
    return parsed?.schema_version === 1 && ['held', 'released'].includes(parsed.status) && parsed.scope && parsed.request_id && parsed.token
      ? { ...parsed, commentId: comment.id }
      : null
  } catch { return null }
}

function scopedEvents(comments, issueNumber, scope) {
  if (!Array.isArray(comments)) throw leaseError('API_AMBIGUITY', 'Issue lease comment readback was not an array')
  const events = []
  for (const comment of comments) {
    if (!String(comment?.body ?? '').includes(LEASE_MARKER)) continue
    const event = parseLeaseComment(comment)
    if (!event) throw leaseConflict(`Issue #${issueNumber} contains an unreadable lease marker`)
    if (event.scope === scope && Number(event.issue_number) === Number(issueNumber)) events.push(event)
  }
  return events
}

function latestByRequest(events) {
  const latest = new Map()
  for (const event of events) latest.set(`${event.request_id}:${event.scope}`, event)
  return [...latest.values()]
}

function activeLeases(events) {
  return latestByRequest(events).filter((event) => event.status === 'held')
}

function requestLease(events, requestId) {
  return activeLeases(events).find((event) => event.request_id === requestId) ?? null
}

/**
 * Issue-comment transport is injected so this module owns only the lease
 * protocol: marker parsing, single-winner decisions, readback, and release.
 */
export function createTaskBootstrapLeaseProtocol({
  readComments,
  postComment,
  now = () => Date.now(),
  randomBytes = cryptoRandomBytes,
} = {}) {
  if (typeof readComments !== 'function') throw new Error('task bootstrap lease protocol requires readComments')
  if (typeof postComment !== 'function') throw new Error('task bootstrap lease protocol requires postComment')

  async function readScopedEvents({ issueNumber, scope }) {
    return scopedEvents(await readComments(issueNumber), issueNumber, scope)
  }

  async function acquireLease({ issueNumber, requestId, scope, expectedBodySha256 = null }) {
    const events = await readScopedEvents({ issueNumber, scope })
    const active = activeLeases(events)
    const heldByOther = active.find((event) => event.request_id !== requestId)
    if (heldByOther) throw leaseConflict('another bootstrap writer holds the Issue lease')

    const sameHeld = requestLease(events, requestId)
    if (sameHeld) return { ['token']: sameHeld.token, commentId: sameHeld.commentId }

    const leaseToken = `${scope}:${requestId}:${now()}:${randomBytes(8).toString('hex')}`
    const comment = await postComment(issueNumber, workflowLeaseBody({
      scope,
      requestId,
      status: 'held',
      leaseToken,
      issueNumber,
      observedBodySha256: expectedBodySha256,
    }))

    const reread = await readScopedEvents({ issueNumber, scope })
    const winners = activeLeases(reread)
    if (winners.length !== 1 || winners[0].request_id !== requestId || winners[0].token !== leaseToken) {
      throw leaseConflict('Issue-only lease winner could not be proven')
    }
    return { ['token']: leaseToken, commentId: comment.id }
  }

  async function readLatestLease({ issueNumber, scope }) {
    const events = await readScopedEvents({ issueNumber, scope })
    return events.at(-1) ?? null
  }

  async function readHeldLease({ issueNumber, requestId, scope }) {
    return requestLease(await readScopedEvents({ issueNumber, scope }), requestId)
  }

  async function releaseLease({ issueNumber, requestId, scope, lease }) {
    if (!lease?.token) return
    const held = await readHeldLease({ issueNumber, requestId, scope })
    if (!held || held.token !== lease.token) throw leaseConflict('lease release token is not the currently held token')
    await postComment(issueNumber, workflowLeaseBody({
      scope,
      requestId,
      status: 'released',
      leaseToken: lease.token,
      issueNumber,
    }))
  }

  return { acquireLease, readHeldLease, readLatestLease, releaseLease }
}
