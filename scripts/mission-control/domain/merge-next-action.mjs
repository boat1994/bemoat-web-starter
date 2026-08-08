const INVALID_NEXT_ACTION_MESSAGE =
  'STATE_CONFLICT: merge completion next campaign action is missing, conflicting, or would start the next Slice'

/**
 * @param {any} nextAction
 * @param {{ requiredSlice?: number | null }} [options]
 */
export function validateNextAction(nextAction, options = {}) {
  const { requiredSlice = null } = options
  const slice = nextAction?.slice == null ? null : Number(nextAction.slice)
  const valid =
    nextAction &&
    typeof nextAction === 'object' &&
    !Array.isArray(nextAction) &&
    nextAction.started === false &&
    typeof nextAction.action === 'string' &&
    nextAction.action.trim().length > 0 &&
    !/^\s*start\b/i.test(nextAction.action) &&
    (requiredSlice == null || slice === requiredSlice)
  if (!valid) throw new Error(INVALID_NEXT_ACTION_MESSAGE)
  return { ...nextAction, ...(slice == null ? {} : { slice }) }
}
