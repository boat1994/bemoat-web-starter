const FULL_SHA_RE = /^[0-9a-f]{40}$/i

type Mapping = Record<string, unknown>

function stateConflict(message: unknown): Error {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function normalizeSha(value: unknown): string | null {
  return typeof value === 'string' && FULL_SHA_RE.test(value) ? value.toLowerCase() : null
}

function isMapping(value: unknown): value is Mapping {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function cloneReopenValue<T>(value: T): T {
  return structuredClone(value)
}

export function sameReopenValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left)) {
    return Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameReopenValue(value, right[index]))
  }
  if (Array.isArray(right)) return false
  if (isMapping(left) && isMapping(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && sameReopenValue(left[key], right[key]))
  }
  return false
}

function assertOnlyBoundedStateChanges(before: Mapping | null | undefined, after: Mapping | null | undefined): void {
  const allowed = new Set([
    'state',
    'current_head',
    'founder_correction_authorization',
    'next_permitted_action',
    'updated_at',
    'updated_by',
  ])
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  for (const key of keys) {
    if (!allowed.has(key) && !sameReopenValue(before?.[key], after?.[key])) {
      throw stateConflict(`reopen projection changed unrelated state field ${key}`)
    }
  }
}

type ReopenEvidence = { authorization: Mapping }
type ReopenOptions = Mapping & {
  expectedReviewCycle: unknown
  expectedNewHead: unknown
  expectedOldHead: unknown
}
type BuildNextStateInput = {
  correctionState?: unknown
  nextAction?: unknown
}

export function buildNextState(
  state: Mapping,
  evidence: ReopenEvidence,
  options: ReopenOptions,
  {
    correctionState,
    nextAction,
  }: BuildNextStateInput = {},
): Mapping {
  const authorization = evidence.authorization
  const nextAuthorization: Mapping = {
    ...cloneReopenValue(authorization),
    schema_version: 2,
    status: 'authorized',
    authority: 'Founder',
    scope: 'correction',
    action: 'reopen',
    for_review_number: Number(options.expectedReviewCycle),
    review_cycle: Number(options.expectedReviewCycle),
    authorization_id: authorization.authorization_id,
    reviewed_head: normalizeSha(options.expectedNewHead),
    old_reviewed_head: normalizeSha(options.expectedOldHead),
    exact_head: normalizeSha(options.expectedNewHead),
    finding_ids: cloneReopenValue(authorization.finding_ids),
    maximum_correction_deliveries: 1,
    correction_deliveries: 0,
    delta_review_requirement: true,
    required_next_review: 'Delta Review',
    delta_review_count: 0,
    correction_result_comment_id: null,
    delta_review_comment_id: null,
    merge_authorization_invalidated_head: normalizeSha(options.expectedOldHead),
    authorization_record: cloneReopenValue(authorization),
  }
  const nextState = {
    ...cloneReopenValue(state),
    state: correctionState,
    current_head: normalizeSha(options.expectedNewHead),
    next_permitted_action: nextAction,
    founder_correction_authorization: nextAuthorization,
    updated_at: new Date().toISOString(),
    updated_by: 'Founder-authorized Reopen Transport',
  }
  assertOnlyBoundedStateChanges(state, nextState)
  return nextState
}
