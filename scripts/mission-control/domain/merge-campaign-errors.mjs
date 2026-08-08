import { blockedExternal, stateConflict } from './merge-errors.mjs'

export function campaignParseFailure(parsed, context) {
  const message = `${context}: ${parsed.reason ?? 'invalid campaign projection'}`
  if (parsed.classification === 'BLOCKED_EXTERNAL') throw blockedExternal(message)
  throw stateConflict(message)
}
