import { createHash } from 'node:crypto'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const ROLE_MARKERS = new Set(['HANDOFF', 'RESULT', 'REVIEW_VERDICT'])

/**
 * @param {string} body
 * @returns {'HANDOFF' | 'RESULT' | 'REVIEW_VERDICT' | null}
 */
export function parseCommentMarker(body = '') {
  const match = body.match(/^##\s+(HANDOFF|RESULT|REVIEW_VERDICT|AUTHORIZATION)\s*$/m)
  let marker = match?.[1] ?? null
  if (marker === 'AUTHORIZATION') marker = 'HANDOFF'
  return marker && ROLE_MARKERS.has(marker) ? marker : null
}

/**
 * @param {string} body
 * @param {{ taskId?: string, phase?: string, role?: string }} [overrides]
 */
export function normalizeTransitionIdentity(body = '', overrides = {}) {
  const role = overrides.role ?? parseCommentMarker(body) ?? ''
  const taskId = overrides.taskId ??
    body.match(/\*\*Task(?:\s*\/\s*Issue)?:\*\*\s*(?:Issue\s*)?#?(\d+)/i)?.[1] ??
    body.match(/Task\s*\/\s*Issue:\s*(?:Issue\s*)?#?(\d+)/i)?.[1] ?? ''
  const phase = overrides.phase ??
    body.match(/\*\*Phase:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ??
    body.match(/Phase:\s*(.+?)$/m)?.[1]?.trim() ?? ''
  const normalizedContent = body
    .replace(/^### Task log[\s\S]*?(?=\n\*\*|\n##|$)/m, '')
    .replace(/^- Timestamp:.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    taskId: String(taskId),
    phase,
    role,
    contentHash: sha256(normalizedContent),
  }
}

export function serializeTransitionIdentity(identity) {
  return JSON.stringify({
    taskId: identity.taskId,
    phase: identity.phase,
    role: identity.role,
    contentHash: identity.contentHash,
  })
}

export function transitionIdentityMatches(left, right) {
  return serializeTransitionIdentity(left) === serializeTransitionIdentity(right)
}
