import { resolveIssueNumber } from '../../agent-issue/issue-references.mjs'

const NO_AUTOMATIC_CLOSURE_FAILURE_REASON =
  'PR contains an automatic closing reference to the managed Issue; use Refs so merge transport remains the closure owner'

export function classifyNoAutomaticClosure(pr, issueNumber, repo) {
  const linkedClosure = (pr?.closingIssuesReferences ?? []).some((reference) =>
    resolveIssueNumber(reference.number) === issueNumber &&
    (reference.repository?.nameWithOwner ?? repo) === repo
  )
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const closingPattern = new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+(?:#${issueNumber}\\b|${escapedRepo}#${issueNumber}\\b|https://github\\.com/${escapedRepo}/issues/${issueNumber}\\b)`,
    'i',
  )
  const closingSources = [
    pr?.title,
    pr?.body,
    ...(pr?.commits ?? []).flatMap((commit) => [commit.messageHeadline, commit.messageBody]),
  ]
  const closingKeyword = closingSources.some((source) => closingPattern.test(String(source ?? '')))
  const valid = !linkedClosure && !closingKeyword
  return {
    valid,
    reason: valid ? null : NO_AUTOMATIC_CLOSURE_FAILURE_REASON,
  }
}
