import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

export function normalizeIssueNumber(value: unknown): number | null {
  return resolveIssueNumber(value)
}

export function normalizePrNumber(value: unknown): number | null {
  return resolvePrNumber(value)
}
