function field(value: unknown, key: string): unknown {
  if (value == null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return Reflect.get(value, key)
}

export function normalizeIssueState(issue: unknown): string {
  return String(field(issue, 'state') ?? '').toUpperCase()
}

export function normalizeIssueReason(issue: unknown): string {
  return String(field(issue, 'stateReason') ?? field(issue, 'state_reason') ?? '').toUpperCase()
}
