import { resolveIssueNumber } from '../../agent-issue/issue-references.mjs'

const NO_AUTOMATIC_CLOSURE_FAILURE_REASON =
  'PR contains an automatic closing reference to the managed Issue; use Refs so merge transport remains the closure owner'

type ClosingReference = {
  number?: unknown
  repository?: {
    nameWithOwner?: unknown
  } | null
}

type CommitMessage = {
  messageHeadline?: unknown
  messageBody?: unknown
}

type PullRequest = {
  closingIssuesReferences?: ClosingReference[] | null
  title?: unknown
  body?: unknown
  commits?: CommitMessage[] | null
} | null | undefined

type NoAutomaticClosureResult = {
  valid: boolean
  reason: string | null
}

export function classifyNoAutomaticClosure(
  pr: PullRequest,
  issueNumber: number,
  repo: string,
): NoAutomaticClosureResult {
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
