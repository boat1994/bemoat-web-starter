export function stateConflict(message: unknown): Error {
  return new Error(`STATE_CONFLICT: ${message}`)
}

export function blockedExternal(message: unknown): Error {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}
