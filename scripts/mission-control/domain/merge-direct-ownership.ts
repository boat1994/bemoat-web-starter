import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

type ManagedState = {
  active_task_issue?: unknown
  active_pr?: unknown
}

type Issue = {
  managedState?: ManagedState | null
} | null | undefined

type PullRequest = {
  number?: unknown
} | null | undefined

type DirectOwnershipInput = {
  issueNumber: number
  issue: Issue
  pr: PullRequest
}

type DirectOwnershipResult = {
  valid: boolean
  prNumber: number | null
  reason: string | null
}

function normalizeIssueNumber(value: unknown) {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value: unknown) {
  return resolvePrNumber(value)
}

function invalid(reason: string): DirectOwnershipResult {
  return { valid: false, prNumber: null, reason }
}

export function validateDirectOwnership({ issueNumber, issue, pr }: DirectOwnershipInput): DirectOwnershipResult {
  const state = issue?.managedState
  if (!state) return invalid('managed Issue state is unavailable')
  if (normalizeIssueNumber(state.active_task_issue) !== issueNumber) {
    return invalid('merge transport may operate only on the directly managed task Issue')
  }
  const prNumber = normalizePrNumber(state.active_pr)
  if (!prNumber) return invalid('directly managed task has no active PR terminal ownership')
  if (pr?.number != null && normalizePrNumber(pr.number) !== prNumber) {
    return invalid('live PR does not match the managed task active PR')
  }
  return { valid: true, prNumber, reason: null }
}
