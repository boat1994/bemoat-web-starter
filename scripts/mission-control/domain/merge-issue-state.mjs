export function normalizeIssueState(issue) {
  return String(issue?.state ?? '').toUpperCase()
}
