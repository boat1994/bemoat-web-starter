import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

function normalizeIssueNumber(value) {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value) {
  return resolvePrNumber(value)
}

function invalid(reason) {
  return { valid: false, prNumber: null, reason }
}

export function validateDirectOwnership({ issueNumber, issue, pr }) {
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
