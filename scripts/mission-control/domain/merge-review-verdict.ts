import { z } from 'zod'

import { resolvePrNumber } from '../../agent-issue/issue-references.mjs'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i

type MergeReviewVerdictBinding = {
  verdict: string | null
  pr: string | null
  base: string | null
  reviewed_head: string | null
  repository: string | null
  issue: string | null
  non_superseded: boolean
}

type ProductionMergeReviewVerdict = MergeReviewVerdictBinding & {
  comment_id: string
}

type MergeReviewVerdictExpected = {
  commentId: unknown
  exactHead: unknown
  pr: unknown
  base: unknown
  repository: unknown
  issue: unknown
}

type MergeReviewVerdictClassification = {
  valid: unknown
  reason: string | null
}

function stateConflict(message: string): Error {
  return new Error(`STATE_CONFLICT: ${message}`)
}

export function resolveMergeReviewVerdictBinding(body: unknown = ''): MergeReviewVerdictBinding {
  z.unknown().parse(body)
  return resolveMergeReviewVerdictBindingInternal(body)
}

function resolveMergeReviewVerdictBindingInternal(body: unknown): MergeReviewVerdictBinding {
  const text = String(body ?? '')
  const verdict = text.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null
  const canonicalLines = collectCanonicalReviewTargetLines(text)
  const canonicalBinding = parseCanonicalReviewTarget(canonicalLines)

  const pr = resolveMergeReviewVerdictPr(text, canonicalBinding)
  const reviewedHead = resolveMergeReviewVerdictHead(text, canonicalBinding)
  const base = resolveMergeReviewVerdictBase(text, canonicalBinding)
  const repository = resolveMergeReviewVerdictRepository(text)
  const issue = resolveMergeReviewVerdictIssue(text)
  assertCompleteHistoricalPair({ text, pr, reviewedHead })

  return {
    verdict,
    pr,
    base,
    reviewed_head: reviewedHead,
    repository,
    issue,
    non_superseded: !/superseded|not authoritative/i.test(text),
  }
}

export function parseProductionMergeReviewVerdict(
  body: unknown,
  commentId: unknown,
): ProductionMergeReviewVerdict {
  z.unknown().parse(body)
  z.unknown().parse(commentId)
  const binding = resolveMergeReviewVerdictBindingInternal(body)
  return {
    comment_id: String(commentId),
    verdict: binding.verdict,
    pr: binding.pr,
    base: binding.base,
    reviewed_head: binding.reviewed_head,
    repository: binding.repository,
    issue: binding.issue,
    non_superseded: binding.non_superseded,
  }
}

export function classifyMergeReviewVerdict({
  reviewVerdict,
  expected,
}: {
  reviewVerdict: ProductionMergeReviewVerdict
  expected: MergeReviewVerdictExpected
}): MergeReviewVerdictClassification {
  let valid: unknown
  if (!reviewVerdict) {
    valid = reviewVerdict
  } else if (!isRecord(reviewVerdict)) {
    valid = false
  } else {
    valid =
      reviewVerdict.verdict === 'ELIGIBLE FOR FOUNDER REVIEW' &&
      String(reviewVerdict.comment_id) === String(expected.commentId) &&
      reviewVerdict.reviewed_head === expected.exactHead &&
      resolvePrNumber(reviewVerdict.pr) === resolvePrNumber(expected.pr) &&
      reviewVerdict.base === expected.base &&
      reviewVerdict.repository === expected.repository &&
      String(reviewVerdict.issue) === String(expected.issue) &&
      reviewVerdict.non_superseded === true
  }
  return {
    valid,
    reason: valid
      ? null
      : 'latest review verdict is changed, superseded, or does not bind the exact repository, Issue, PR, base, and reviewed head',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resolveUniqueRecognizedValues(values: string[], label: string): string | null {
  if (values.length === 0) return null
  const unique = [...new Set(values.map(String))]
  if (unique.length !== 1) {
    throw stateConflict(`REVIEW_VERDICT ${label} evidence is duplicated or ambiguous`)
  }
  return unique[0] ?? null
}

function collectCanonicalReviewTargetLines(body: string): RegExpMatchArray[] {
  const lines = [...body.matchAll(/^\*\*PR \/ base \/ head:\*\*[ \t]*(.*)$/gm)]
  if (lines.length > 1) {
    throw stateConflict('REVIEW_VERDICT canonical PR / base / head field is duplicated or ambiguous')
  }
  return lines
}

function parseCanonicalReviewTarget(
  canonicalLines: RegExpMatchArray[],
): { pr: string; base: string; reviewedHead: string } | null {
  if (canonicalLines.length === 0) return null
  const firstLine = canonicalLines[0]
  if (!firstLine) return null

  const rest = firstLine[1] ?? ''
  const match = rest.match(/^[ \t]*([^\r\n]*?)\s*·\s*`([^`\r\n@]+)`\s*·\s*`([^`\r\n]+)`[ \t]*$/)
  if (!match) {
    throw stateConflict('REVIEW_VERDICT canonical PR / base / head field is malformed, partial, or ambiguous')
  }

  const prPart = match[1] ?? ''
  const base = match[2] ?? ''
  const reviewedHead = match[3] ?? ''
  const pr = extractCanonicalPr(prPart)
  if (!base.trim() || !FULL_SHA_RE.test(reviewedHead)) {
    throw stateConflict('REVIEW_VERDICT canonical PR / base / head field is malformed, partial, or ambiguous')
  }

  return {
    pr,
    base,
    reviewedHead: reviewedHead.toLowerCase(),
  }
}

function extractCanonicalPr(rest: string): string {
  const candidate = rest.trim()
  const pullMatches = [...candidate.matchAll(/\/pull\/(\d+)/gi)]
  const labeledMatches = [...candidate.matchAll(/\bPR #(\d+)\b/gi)]
  if (pullMatches.length > 1 || labeledMatches.length > 1) {
    throw stateConflict('REVIEW_VERDICT canonical PR evidence is duplicated or ambiguous')
  }

  const pull = pullMatches[0]?.[1] ?? null
  const labeled = labeledMatches[0]?.[1] ?? null
  if (!pull && !labeled) {
    throw stateConflict('REVIEW_VERDICT canonical PR / base / head field is malformed, partial, or ambiguous')
  }
  if (pull && labeled && pull !== labeled) {
    throw stateConflict('REVIEW_VERDICT canonical PR evidence is duplicated or ambiguous')
  }

  const pr = pull ?? labeled
  if (!pr) {
    throw stateConflict('REVIEW_VERDICT canonical PR / base / head field is malformed, partial, or ambiguous')
  }
  const firstLabeled = labeledMatches[0]
  const validLabeledForm = labeled !== null && firstLabeled !== undefined && candidate === firstLabeled[0]
  const validPullForm = pull !== null && !/\s/.test(candidate) && candidate.endsWith(`/pull/${pr}`)
  if (!validLabeledForm && !validPullForm) {
    throw stateConflict('REVIEW_VERDICT canonical PR / base / head field is malformed, partial, or ambiguous')
  }
  return pr
}

type CanonicalBinding = { pr: string; base: string; reviewedHead: string }

function resolveMergeReviewVerdictPr(body: string, canonicalBinding: CanonicalBinding | null): string | null {
  const recognized: string[] = []
  if (canonicalBinding) recognized.push(canonicalBinding.pr)

  const historicalFieldMatches = [...body.matchAll(/^\*\*PR:\*\*(.*)$/gm)]
  if (historicalFieldMatches.length > 1) {
    throw stateConflict('REVIEW_VERDICT PR field is duplicated or ambiguous')
  }
  if (historicalFieldMatches.length === 1) {
    const historicalPr = historicalFieldMatches[0]?.[1].match(/^[ \t]*PR #(\d+)[ \t]*$/i)?.[1]
    if (!historicalPr) {
      throw stateConflict('REVIEW_VERDICT PR field is malformed, partial, or ambiguous')
    }
    recognized.push(historicalPr)
  }

  const pullMatches = [...body.matchAll(/\/pull\/(\d+)/g)].map((match) => match[1]).filter(
    (match): match is string => match !== undefined,
  )
  const uniquePulls = [...new Set(pullMatches)]
  if (uniquePulls.length > 1) {
    throw stateConflict('REVIEW_VERDICT PR evidence is duplicated or ambiguous')
  }
  if (uniquePulls.length === 1) {
    const pull = uniquePulls[0]
    if (pull) recognized.push(pull)
  }
  return resolveUniqueRecognizedValues(recognized, 'PR')
}

function matchUniqueExactHeadField(
  body: string,
  label: string,
  { caseInsensitive = false }: { caseInsensitive?: boolean } = {},
): string | null {
  const flags = caseInsensitive ? 'gim' : 'gm'
  const labelMatches = [...body.matchAll(new RegExp(`^\\*\\*${label}:\\*\\*(.*)$`, flags))]
  if (labelMatches.length === 0) return null
  if (labelMatches.length > 1) {
    throw stateConflict(`REVIEW_VERDICT ${label} field is duplicated or ambiguous`)
  }

  const rest = labelMatches[0]?.[1] ?? ''
  const valueMatch = rest.match(/^[ \t]*(?:`([0-9a-f]{40})`|([0-9a-f]{40}))[ \t]*$/i)
  if (!valueMatch) {
    throw stateConflict(`REVIEW_VERDICT ${label} field is malformed, partial, multiline, or not a full 40-character SHA`)
  }
  return (valueMatch[1] ?? valueMatch[2] ?? '').toLowerCase()
}

function resolveMergeReviewVerdictHead(body: string, canonicalBinding: CanonicalBinding | null): string | null {
  const recognized: string[] = []
  const exactHeadReviewed = matchUniqueExactHeadField(body, 'Exact head reviewed', { caseInsensitive: true })
  if (exactHeadReviewed) recognized.push(exactHeadReviewed)
  const exactReviewedHead = matchUniqueExactHeadField(body, 'Exact reviewed head', { caseInsensitive: true })
  if (exactReviewedHead) recognized.push(exactReviewedHead)
  if (canonicalBinding) recognized.push(canonicalBinding.reviewedHead)
  return resolveUniqueRecognizedValues(recognized, 'exact reviewed head')
}

function resolveMergeReviewVerdictBase(body: string, canonicalBinding: CanonicalBinding | null): string | null {
  const recognized: string[] = []
  const approvedFieldMatches = [...body.matchAll(/^\*\*Approved base:\*\*(.*)$/gm)]
  if (approvedFieldMatches.length > 1) {
    throw stateConflict('REVIEW_VERDICT Approved base field is duplicated or ambiguous')
  }
  if (approvedFieldMatches.length === 1) {
    const approvedBase = approvedFieldMatches[0]?.[1].match(
      /^[ \t]*(?:`([^`\s@]+)(?:@[^`\s]+)?`|([^`\s@]+)(?:@[^`\s]+)?)[ \t]*$/,
    )
    if (!approvedBase) {
      throw stateConflict('REVIEW_VERDICT Approved base field is malformed, partial, or ambiguous')
    }
    recognized.push(approvedBase[1] ?? approvedBase[2] ?? '')
  }
  if (canonicalBinding) recognized.push(canonicalBinding.base)
  return resolveUniqueRecognizedValues(recognized, 'base')
}

function hasHistoricalPrField(body: string): boolean {
  return /^\*\*PR:\*\*/m.test(body)
}

function hasHistoricalExactReviewedHeadField(body: string): boolean {
  return /^\*\*Exact reviewed head:\*\*/im.test(body)
}

function assertCompleteHistoricalPair({
  text,
  pr,
  reviewedHead,
}: {
  text: string
  pr: string | null
  reviewedHead: string | null
}): void {
  const hasHistoricalPr = hasHistoricalPrField(text)
  const hasHistoricalHead = hasHistoricalExactReviewedHeadField(text)
  if (!hasHistoricalPr && !hasHistoricalHead) return
  if (pr && reviewedHead) return
  throw stateConflict('REVIEW_VERDICT historical binding is partial, duplicated, or ambiguous')
}

function resolveMergeReviewVerdictRepository(body: string): string | null {
  const recognized: string[] = []
  
  const repositoryFieldMatches = [...body.matchAll(/^[ \t]*(?:-[ \t]*)?(?:\*\*|__)?Repository:(?:\*\*|__)?[ \t]*(?:`([^`\s]+)`|([^`\s]+))[ \t]*$/gim)]
  if (repositoryFieldMatches.length > 1) {
    throw stateConflict('REVIEW_VERDICT Repository field is duplicated or ambiguous')
  }
  if (repositoryFieldMatches.length === 1) {
    const repo = repositoryFieldMatches[0]?.[1] ?? repositoryFieldMatches[0]?.[2]
    if (repo) recognized.push(repo.toLowerCase())
  }

  const urlRepoMatches = [...body.matchAll(/github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/(?:pull|issues)\/\d+/gi)]
  const uniqueUrlRepos = [...new Set(urlRepoMatches.map(m => m[1]!.toLowerCase()))]
  if (uniqueUrlRepos.length > 1) {
    throw stateConflict('REVIEW_VERDICT repository evidence from URLs is duplicated or ambiguous')
  }
  if (uniqueUrlRepos.length === 1) {
    recognized.push(uniqueUrlRepos[0]!)
  }

  return resolveUniqueRecognizedValues(recognized, 'Repository')
}

function resolveMergeReviewVerdictIssue(body: string): string | null {
  const recognized: string[] = []
  
  const taskFieldMatches = [...body.matchAll(/^[ \t]*(?:-[ \t]*)?(?:\*\*|__)?Task(?:\s*\/\s*Issue)?(?:(?:\*\*|__)?|:(?:\*\*|__)?)[ \t]*(?:Issue[ \t]*)?#?(\d+)[ \t]*$/gim)]
  if (taskFieldMatches.length > 1) {
    throw stateConflict('REVIEW_VERDICT Issue field is duplicated or ambiguous')
  }
  if (taskFieldMatches.length === 1) {
    const issue = taskFieldMatches[0]?.[1] ?? taskFieldMatches[0]?.[2]
    if (issue) recognized.push(issue)
  }

  const issueUrlMatches = [...body.matchAll(/github\.com\/[^\s/]+\/[^\s/]+?\/issues\/(\d+)/gi)]
  const uniqueIssueUrls = [...new Set(issueUrlMatches.map(m => m[1]!))]
  if (uniqueIssueUrls.length > 1) {
    throw stateConflict('REVIEW_VERDICT Issue evidence from URLs is duplicated or ambiguous')
  }
  if (uniqueIssueUrls.length === 1) {
    recognized.push(uniqueIssueUrls[0]!)
  }

  return resolveUniqueRecognizedValues(recognized, 'Issue')
}
