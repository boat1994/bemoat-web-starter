import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

export function normalizeIssueNumber(value) {
  return resolveIssueNumber(value)
}

export function normalizePrNumber(value) {
  return resolvePrNumber(value)
}
