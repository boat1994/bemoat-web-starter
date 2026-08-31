import yaml from 'yaml'

const MISSION_CONTROL_STATES = new Set([
  'READY',
  'IN_PROGRESS',
  'AWAITING_REVIEW_1',
  'CORRECTION_REQUIRED_1',
  'AWAITING_REVIEW_2',
  'CORRECTION_REQUIRED_2',
  'AWAITING_REVIEW_3',
  'FOUNDER_AUTHORIZED_CORRECTION',
  'BLOCKED_FOR_FOUNDER_DECISION',
  'ELIGIBLE_FOR_FOUNDER_REVIEW',
  'DONE',
  'BLOCKED_EXTERNAL',
  'STATE_CONFLICT',
  'STATE_MIGRATION_REQUIRED',
])

const IDENTITY_KEYS = ['schema_version', 'state', 'active_task_issue']
const ISSUE_REFERENCE_PATTERN = /^(?:[\w.-]+\/[\w.-]+#\d+|#\d+|\d+)$/

type MissionControlIdentity = {
  schema_version: number
  state: string
  active_task_issue: string | null
  [key: string]: unknown
}

/**
 * Read the legacy managed-state identity used by the planning safety guard.
 *
 * This deliberately does not project, authorize, transition, or interpret
 * review counters. A marked block is only useful to the guard when its
 * identity is unambiguous; malformed evidence therefore fails closed.
 */
export function parseLegacyManagedStateIdentity(body: string = ''): {
  present: boolean
  valid: boolean
  reason?: string
  state: MissionControlIdentity | null
} {
  const starts = [...body.matchAll(/<!--\s*bemoat-mission-control-state:start\s*-->/g)]
  const ends = [...body.matchAll(/<!--\s*bemoat-mission-control-state:end\s*-->/g)]
  const hasLegacyHeader = body.includes('## MISSION_CONTROL_STATE')

  if (starts.length === 0 && ends.length === 0) {
    if (hasLegacyHeader) {
      return { present: true, valid: false, state: null, reason: 'unmarked YAML is not a durable managed-state block' }
    }
    return { present: false, valid: false, state: null }
  }

  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    return { present: true, valid: false, state: null, reason: 'exactly one balanced marker pair is required' }
  }

  const raw = body.slice(starts[0].index + starts[0][0].length, ends[0].index)
    .replace(/```yaml\s*|```/g, '')

  let state: MissionControlIdentity
  try {
    state = yaml.parse(raw, { uniqueKeys: true }) as MissionControlIdentity
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = message.includes('Map keys must be unique')
      ? `duplicate state key: ${message}`
      : `unreadable state line: ${message}`
    return { present: true, valid: false, state: null, reason }
  }

  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return { present: true, valid: false, state: null, reason: 'unreadable state line: root must be a mapping' }
  }

  const missing = IDENTITY_KEYS.filter((key) => !Object.hasOwn(state, key))
  if (missing.length > 0) {
    return { present: true, valid: false, state: null, reason: `missing required state key(s): ${missing.join(', ')}` }
  }
  if (state.schema_version !== 1) {
    return { present: true, valid: false, state: null, reason: 'unsupported schema_version' }
  }
  if (typeof state.state !== 'string' || !MISSION_CONTROL_STATES.has(state.state)) {
    return { present: true, valid: false, state: null, reason: 'invalid state enum' }
  }
  if (
    state.active_task_issue !== null &&
    (typeof state.active_task_issue !== 'string' || !ISSUE_REFERENCE_PATTERN.test(state.active_task_issue.trim()))
  ) {
    return {
      present: true,
      valid: false,
      state: null,
      reason: 'active_task_issue must be null or a parseable issue reference',
    }
  }

  return { present: true, valid: true, state }
}
