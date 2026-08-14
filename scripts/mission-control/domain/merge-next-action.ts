const INVALID_NEXT_ACTION_MESSAGE =
  'STATE_CONFLICT: merge completion next campaign action is missing, conflicting, or would start the next Slice'

type Mapping = Record<string, unknown>

export type NextActionOptions = {
  requiredSlice?: number | null
}

function isMapping(value: unknown): value is Mapping {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function property(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return Reflect.get(value, key)
}

export function validateNextAction(nextAction: unknown, options: NextActionOptions = {}): Mapping {
  const { requiredSlice = null } = options
  const rawSlice = property(nextAction, 'slice')
  const slice = rawSlice == null ? null : Number(rawSlice)
  const action = property(nextAction, 'action')
  const started = property(nextAction, 'started')
  const valid =
    isMapping(nextAction) &&
    started === false &&
    typeof action === 'string' &&
    action.trim().length > 0 &&
    !/^\s*start\b/i.test(action) &&
    (requiredSlice == null || slice === requiredSlice)
  if (!valid) throw new Error(INVALID_NEXT_ACTION_MESSAGE)
  return { ...nextAction, ...(slice == null ? {} : { slice }) }
}
