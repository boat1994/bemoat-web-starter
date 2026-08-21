import { randomBytes as cryptoRandomBytes } from 'node:crypto'

export const LEASE_MARKER = '<!-- bemoat-mission-control-task-bootstrap-lease:v1 -->'

const LEASE_END_MARKER = LEASE_MARKER.replace(':v1', ':end')

type LeaseError = Error & { code: string; classification: string }
type LegacyComment = { body?: unknown; id: unknown } | null | undefined
type LeaseEvent = Record<string, unknown> & { commentId: unknown }
type LeaseBodyInput = {
  scope: unknown
  requestId: unknown
  status: unknown
  leaseToken: unknown
  issueNumber: unknown
  observedBodySha256?: unknown
}
type LeaseProtocolDependencies = {
  readComments?: (issueNumber: number) => Promise<unknown>
  postComment?: (issueNumber: number, body: string) => Promise<unknown>
  now?: () => unknown
  randomBytes?: (size: number) => { toString: (encoding?: BufferEncoding, start?: number, end?: number) => string }
}
type LeaseRequest = { issueNumber: unknown; requestId: unknown; scope: unknown; expectedBodySha256?: unknown }
type ReleaseRequest = { issueNumber: unknown; requestId: unknown; scope: unknown; lease: unknown }

function leaseError(code: string, message: string, cause?: unknown): LeaseError {
  const error = new Error(`${code}: ${message}`, cause ? { cause } : undefined) as LeaseError
  error.code = code
  error.classification = code
  return error
}

function leaseConflict(message: string, cause?: unknown) { return leaseError('CAS_CONFLICT', message, cause) }

export function workflowLeaseBody({ scope, requestId, status, leaseToken, issueNumber, observedBodySha256 = null }: LeaseBodyInput) {
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

export function parseLeaseComment(comment: LegacyComment): LeaseEvent | null {
  const legacyComment = comment as { body?: unknown; id: unknown } | null | undefined
  const body = String(legacyComment?.body ?? '')
  if (!body.includes(LEASE_MARKER)) return null
  const raw = body.replace(LEASE_MARKER, '').replace(LEASE_END_MARKER, '').replace(/```json\s*|```/g, '').trim()
  try {
    const parsed: unknown = JSON.parse(raw)
    const legacyParsed = parsed as { schema_version?: unknown; status?: unknown; scope?: unknown; request_id?: unknown; token?: unknown } | null
    return legacyParsed?.schema_version === 1 && ['held', 'released'].includes(legacyParsed.status as string) && legacyParsed.scope && legacyParsed.request_id && legacyParsed.token
      ? { ...(parsed as Record<string, unknown>), commentId: (legacyComment as { id: unknown }).id }
      : null
  } catch { return null }
}

function scopedEvents(comments: unknown, issueNumber: unknown, scope: unknown) {
  if (!Array.isArray(comments)) throw leaseError('API_AMBIGUITY', 'Issue lease comment readback was not an array')
  const events: LeaseEvent[] = []
  for (const comment of comments) {
    if (!String((comment as { body?: unknown } | null | undefined)?.body ?? '').includes(LEASE_MARKER)) continue
    const event = parseLeaseComment(comment)
    if (!event) throw leaseConflict(`Issue #${issueNumber} contains an unreadable lease marker`)
    if (event.scope === scope && Number(event.issue_number) === Number(issueNumber)) events.push(event)
  }
  return events
}

function latestByRequest(events: LeaseEvent[]) {
  const latest = new Map<string, LeaseEvent>()
  for (const event of events) latest.set(`${event.request_id}:${event.scope}`, event)
  return [...latest.values()]
}

function activeLeases(events: LeaseEvent[]) {
  return latestByRequest(events).filter((event) => event.status === 'held')
}

function requestLease(events: LeaseEvent[], requestId: unknown) {
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
}: LeaseProtocolDependencies = {}) {
  if (typeof readComments !== 'function') throw new Error('task bootstrap lease protocol requires readComments')
  if (typeof postComment !== 'function') throw new Error('task bootstrap lease protocol requires postComment')
  const readIssueComments = readComments
  const postIssueComment = postComment

  async function readScopedEvents({ issueNumber, scope }: { issueNumber: unknown; scope: unknown }) {
    return scopedEvents(await readIssueComments(issueNumber as number), issueNumber, scope)
  }

  async function acquireLease({ issueNumber, requestId, scope, expectedBodySha256 = null }: LeaseRequest) {
    const events = await readScopedEvents({ issueNumber, scope })
    const active = activeLeases(events)
    const heldByOther = active.find((event) => event.request_id !== requestId)
    if (heldByOther) throw leaseConflict('another bootstrap writer holds the Issue lease')

    const sameHeld = requestLease(events, requestId)
    if (sameHeld) return { ['token']: sameHeld.token, commentId: sameHeld.commentId }

    const leaseToken = `${scope}:${requestId}:${now()}:${randomBytes(8).toString('hex')}`
    const comment = await postIssueComment(issueNumber as number, workflowLeaseBody({
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
      try {
        await releaseLease({ issueNumber, requestId, scope, lease: { token: leaseToken } })
      } catch (error) {
        throw leaseConflict('Issue-only lease winner failed and loser cleanup could not be proven', error)
      }
      throw leaseConflict('Issue-only lease winner could not be proven')
    }
    return { ['token']: leaseToken, commentId: (comment as { id: unknown }).id }
  }

  async function readLatestLease({ issueNumber, scope }: { issueNumber: unknown; scope: unknown }) {
    const events = await readScopedEvents({ issueNumber, scope })
    return events.at(-1) ?? null
  }

  async function readHeldLease({ issueNumber, requestId, scope }: { issueNumber: unknown; requestId: unknown; scope: unknown }) {
    return requestLease(await readScopedEvents({ issueNumber, scope }), requestId)
  }

  async function releaseLease({ issueNumber, requestId, scope, lease }: ReleaseRequest) {
    const legacyLease = lease as { token?: unknown } | null | undefined
    if (!legacyLease?.token) return
    const held = await readHeldLease({ issueNumber, requestId, scope })
    if (!held || held.token !== legacyLease.token) throw leaseConflict('lease release token is not the currently held token')
    let posted: unknown
    try {
      posted = await postIssueComment(issueNumber as number, workflowLeaseBody({
        scope,
        requestId,
        status: 'released',
        leaseToken: legacyLease.token,
        issueNumber,
      }))
    } catch (error) {
      const code = typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>).code === 'string'
        ? (error as Record<string, unknown>).code as string
        : null
      if (code === 'API_AMBIGUITY' || code === 'CAS_CONFLICT' || code === 'NOT_FOUND') throw error
      throw leaseError('API_AMBIGUITY', 'lease release POST outcome is uncertain', error)
    }
    const postedRecord = typeof posted === 'object' && posted !== null ? posted as { id?: unknown; body?: unknown } : null
    const postedEvent = postedRecord?.id === undefined || postedRecord?.id === null
      ? null
      : parseLeaseComment(postedRecord as { id: unknown; body?: unknown })
    if (postedRecord?.id === undefined || postedRecord?.id === null || !postedEvent || postedEvent.status !== 'released' || postedEvent.scope !== scope || postedEvent.request_id !== requestId || postedEvent.token !== legacyLease.token) {
      throw leaseError('API_AMBIGUITY', 'lease release POST did not return the expected immutable release event')
    }
    let reread: LeaseEvent[]
    try {
      reread = await readScopedEvents({ issueNumber, scope })
    } catch (error) {
      const code = typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>).code === 'string'
        ? (error as Record<string, unknown>).code as string
        : null
      if (code === 'API_AMBIGUITY' || code === 'CAS_CONFLICT' || code === 'NOT_FOUND') throw error
      throw leaseError('API_AMBIGUITY', 'lease release readback is uncertain', error)
    }
    const matching = reread.filter((event) => event.request_id === requestId && event.scope === scope)
    const latest = matching.at(-1)
    if (!latest || latest.status !== 'released' || latest.token !== legacyLease.token || String(latest.commentId) !== String(postedRecord.id)) {
      throw leaseConflict('lease release readback did not prove the released token and immutable comment')
    }
  }

  return { acquireLease, readHeldLease, readLatestLease, releaseLease }
}
