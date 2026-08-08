export function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

export function blockedExternal(message) {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}
