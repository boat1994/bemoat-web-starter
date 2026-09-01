/**
 * Deterministic PR-to-Issue ownership contract shared by Context and Handoff.
 *
 * Authority is merged repository policy plus GitHub native closing references.
 * Inherited matcher tokens are not authority.
 *
 * Authoritative ownership:
 * - native `closingIssuesReferences` when Issue identity agrees and repository
 *   identity agrees or is omitted.
 *
 * Uniquely authorized explicit textual ownership forms:
 * - GitHub closing keywords that native `closingIssuesReferences` encodes
 *   (`close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved`)
 * - AGENTS.md / workflow non-closing linkage (`Part of #<n>`, `Refs #<n>`)
 *
 * Not ownership evidence:
 * - bare/generic `Issue #N`
 * - `related to`, `references`, singular `ref`
 * - `task issue`
 * - incidental prose in regression notes, acceptance audits, history,
 *   dependencies, or scope descriptions that lacks an authorized relation
 */

export const AUTHORIZED_TEXTUAL_PR_ISSUE_RELATIONS = Object.freeze([
  'part of',
  'refs',
  'close',
  'closes',
  'closed',
  'fix',
  'fixes',
  'fixed',
  'resolve',
  'resolves',
  'resolved',
] as const)

const NEGATIVE_OWNERSHIP_PREFIX =
  /(?:no|not|without|except|excluding|does not include|out of scope)[\s:,-]*$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function nativeClosingIssuesOwnIssue(
  closingIssuesReferences: unknown,
  repo: string,
  issueNumber: string,
): boolean {
  if (!Array.isArray(closingIssuesReferences)) return false
  return closingIssuesReferences.some((value) => {
    if (!isRecord(value)) return false
    if (String(value.number ?? '') !== issueNumber) return false
    if (!isRecord(value.repository)) return true
    const nameWithOwner = asString(value.repository.nameWithOwner)
    return !nameWithOwner || nameWithOwner === repo
  })
}

function textualRelationPattern(repo: string, issueNumber: string): RegExp {
  const alternation = [...AUTHORIZED_TEXTUAL_PR_ISSUE_RELATIONS]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|')
  const escapedRepo = escapeRegExp(repo)
  return new RegExp(
    `(?<![A-Za-z])(?:${alternation})(?![A-Za-z])\\s*(?:${escapedRepo})?\\s*#${issueNumber}\\b`,
    'gi',
  )
}

function authorizedTextualRelationOwnsIssue(
  title: unknown,
  body: unknown,
  repo: string,
  issueNumber: string,
): boolean {
  const haystack = `${String(title ?? '')}\n${String(body ?? '')}`
  const relation = textualRelationPattern(repo, issueNumber)
  let match
  while ((match = relation.exec(haystack)) !== null) {
    const prefix = haystack.substring(Math.max(0, match.index - 30), match.index)
    if (!NEGATIVE_OWNERSHIP_PREFIX.test(prefix)) return true
  }
  return false
}

export function prOwnsIssue(
  record: {
    title?: unknown
    body?: unknown
    closingIssuesReferences?: unknown
  },
  repo: string,
  issueNumber: string,
): boolean {
  if (nativeClosingIssuesOwnIssue(record.closingIssuesReferences, repo, issueNumber)) return true
  return authorizedTextualRelationOwnsIssue(record.title, record.body, repo, issueNumber)
}
