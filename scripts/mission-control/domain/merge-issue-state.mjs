export function normalizeIssueState(issue) {
  return String(issue?.state ?? '').toUpperCase()
}

export function normalizeIssueReason(issue) {
  return String(issue?.stateReason ?? issue?.state_reason ?? '').toUpperCase()
}
