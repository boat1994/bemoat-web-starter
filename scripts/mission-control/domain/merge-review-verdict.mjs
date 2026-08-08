import { resolvePrNumber } from '../../agent-issue/issue-references.mjs'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

/**
 * Resolve production merge-transport REVIEW_VERDICT PR/base/head binding.
 *
 * Collects every recognized PR/base/head source before selection. Never prefers
 * canonical, URL, or historical evidence by first-match order.
 *
 * Recognized sources:
 * - one canonical `**PR / base / head:**` line (`/pull/N` or `PR #N`, base, head)
 * - `/pull/N` URL compatibility
 * - one historical `**PR:** PR #N`
 * - one `**Exact head reviewed:**` and/or one `**Exact reviewed head:**`
 * - one `**Approved base:**`
 *
 * Cross-source rule: a complete unique semantically identical binding across
 * permitted source forms is accepted when each form appears at most once and
 * all recognized values agree. Duplicate fields within a form, conflicting
 * values across forms, partial historical pairs, multiline, malformed, or
 * short-SHA evidence fail closed as `STATE_CONFLICT` with zero writes.
 *
 * @param {string} [body]
 * @returns {{
 *   verdict: string | null,
 *   pr: string | null,
 *   base: string | null,
 *   reviewed_head: string | null,
 *   non_superseded: boolean,
 * }}
 */
export function resolveMergeReviewVerdictBinding(body = '') {
  const text = String(body ?? '')
  const verdict = text.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null
  const canonicalLines = collectCanonicalReviewTargetLines(text)
  const canonicalBinding = parseCanonicalReviewTarget(canonicalLines)

  const pr = resolveMergeReviewVerdictPr(text, canonicalBinding)
  const reviewedHead = resolveMergeReviewVerdictHead(text, canonicalBinding)
  const base = resolveMergeReviewVerdictBase(text, canonicalBinding)
  assertCompleteHistoricalPair({ text, pr, reviewedHead })

  return {
    verdict,
    pr,
    base,
    reviewed_head: reviewedHead,
    non_superseded: !/superseded|not authoritative/i.test(text),
  }
}

/**
 * Parse a production merge-transport REVIEW_VERDICT comment body.
 *
 * @param {string} body
 * @param {string | number} commentId
 */
export function parseProductionMergeReviewVerdict(body, commentId) {
  const binding = resolveMergeReviewVerdictBinding(body)
  return {
    comment_id: String(commentId),
    verdict: binding.verdict,
    pr: binding.pr,
    base: binding.base,
    reviewed_head: binding.reviewed_head,
    non_superseded: binding.non_superseded,
  }
}

export function classifyMergeReviewVerdict({ reviewVerdict, expected }) {
  const valid =
    reviewVerdict && typeof reviewVerdict === 'object' && !Array.isArray(reviewVerdict) &&
    reviewVerdict.verdict === 'ELIGIBLE FOR FOUNDER REVIEW' &&
    String(reviewVerdict.comment_id) === String(expected.commentId) &&
    reviewVerdict.reviewed_head === expected.exactHead &&
    resolvePrNumber(reviewVerdict.pr) === resolvePrNumber(expected.pr) &&
    reviewVerdict.base === expected.base &&
    reviewVerdict.non_superseded === true
  return {
    valid,
    reason: valid
      ? null
      : 'latest review verdict is changed, superseded, or does not bind the exact PR, base, and reviewed head',
  }
}

function resolveUniqueRecognizedValues(values, label) {
  if (values.length === 0) return null
  const unique = [...new Set(values.map(String))]
  if (unique.length !== 1) {
    throw stateConflict(`REVIEW_VERDICT ${label} evidence is duplicated or ambiguous`)
  }
  return unique[0]
}

function collectCanonicalReviewTargetLines(body) {
  const lines = [...body.matchAll(/^\*\*PR \/ base \/ head:\*\*[ \t]*(.*)$/gm)]
  if (lines.length > 1) {
    throw stateConflict('REVIEW_VERDICT canonical PR / base / head field is duplicated or ambiguous')
  }
  return lines
}

function parseCanonicalReviewTarget(canonicalLines) {
  if (canonicalLines.length === 0) return null

  const rest = canonicalLines[0][1] ?? ''
  const match = rest.match(/^[ \t]*([^\r\n]*?)\s*·\s*`([^`\r\n]+)`\s*·\s*`([^`\r\n]+)`[ \t]*$/)
  if (!match) {
    throw stateConflict('REVIEW_VERDICT canonical PR / base / head field is malformed, partial, or ambiguous')
  }

  const [, prPart, base, reviewedHead] = match
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

function extractCanonicalPr(rest) {
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
  const validLabeledForm = labeled && candidate === labeledMatches[0][0]
  const validPullForm = pull && !/\s/.test(candidate) && candidate.endsWith(`/pull/${pr}`)
  if (!validLabeledForm && !validPullForm) {
    throw stateConflict('REVIEW_VERDICT canonical PR / base / head field is malformed, partial, or ambiguous')
  }
  return pr
}

function resolveMergeReviewVerdictPr(body, canonicalBinding) {
  const recognized = []

  if (canonicalBinding) {
    recognized.push(canonicalBinding.pr)
  }

  const historicalFieldMatches = [...body.matchAll(/^\*\*PR:\*\*(.*)$/gm)]
  if (historicalFieldMatches.length > 1) {
    throw stateConflict('REVIEW_VERDICT PR field is duplicated or ambiguous')
  }
  if (historicalFieldMatches.length === 1) {
    const historicalPr = historicalFieldMatches[0][1].match(/^[ \t]*PR #(\d+)[ \t]*$/i)?.[1]
    if (!historicalPr) {
      throw stateConflict('REVIEW_VERDICT PR field is malformed, partial, or ambiguous')
    }
    recognized.push(historicalPr)
  }

  const pullMatches = [...body.matchAll(/\/pull\/(\d+)/g)].map((match) => match[1])
  if (pullMatches.length > 1) {
    throw stateConflict('REVIEW_VERDICT PR evidence is duplicated or ambiguous')
  }
  if (pullMatches.length === 1) {
    recognized.push(pullMatches[0])
  }

  return resolveUniqueRecognizedValues(recognized, 'PR')
}

function matchUniqueExactHeadField(body, label, { caseInsensitive = false } = {}) {
  const flags = caseInsensitive ? 'gim' : 'gm'
  const labelMatches = [...body.matchAll(new RegExp(`^\\*\\*${label}:\\*\\*(.*)$`, flags))]
  if (labelMatches.length === 0) return null
  if (labelMatches.length > 1) {
    throw stateConflict(`REVIEW_VERDICT ${label} field is duplicated or ambiguous`)
  }

  const rest = labelMatches[0][1] ?? ''
  const valueMatch = rest.match(/^[ \t]*(?:`([0-9a-f]{40})`|([0-9a-f]{40}))[ \t]*$/i)
  if (!valueMatch) {
    throw stateConflict(`REVIEW_VERDICT ${label} field is malformed, partial, multiline, or not a full 40-character SHA`)
  }
  return (valueMatch[1] ?? valueMatch[2]).toLowerCase()
}

function resolveMergeReviewVerdictHead(body, canonicalBinding) {
  const recognized = []

  const exactHeadReviewed = matchUniqueExactHeadField(body, 'Exact head reviewed', { caseInsensitive: true })
  if (exactHeadReviewed) recognized.push(exactHeadReviewed)

  const exactReviewedHead = matchUniqueExactHeadField(body, 'Exact reviewed head', { caseInsensitive: true })
  if (exactReviewedHead) recognized.push(exactReviewedHead)

  if (canonicalBinding) {
    recognized.push(canonicalBinding.reviewedHead)
  }

  return resolveUniqueRecognizedValues(recognized, 'exact reviewed head')
}

function resolveMergeReviewVerdictBase(body, canonicalBinding) {
  const recognized = []

  const approvedFieldMatches = [...body.matchAll(/^\*\*Approved base:\*\*(.*)$/gm)]
  if (approvedFieldMatches.length > 1) {
    throw stateConflict('REVIEW_VERDICT Approved base field is duplicated or ambiguous')
  }
  if (approvedFieldMatches.length === 1) {
    const approvedBase = approvedFieldMatches[0][1].match(
      /^[ \t]*(?:`([^`\s@]+)(?:@[^`\s]+)?`|([^`\s@]+)(?:@[^`\s]+)?)[ \t]*$/,
    )
    if (!approvedBase) {
      throw stateConflict('REVIEW_VERDICT Approved base field is malformed, partial, or ambiguous')
    }
    recognized.push(approvedBase[1] ?? approvedBase[2])
  }

  if (canonicalBinding) {
    recognized.push(canonicalBinding.base)
  }

  return resolveUniqueRecognizedValues(recognized, 'base')
}

function hasHistoricalPrField(body) {
  return /^\*\*PR:\*\*/m.test(body)
}

function hasHistoricalExactReviewedHeadField(body) {
  return /^\*\*Exact reviewed head:\*\*/im.test(body)
}

function assertCompleteHistoricalPair({ text, pr, reviewedHead }) {
  const hasHistoricalPr = hasHistoricalPrField(text)
  const hasHistoricalHead = hasHistoricalExactReviewedHeadField(text)
  if (!hasHistoricalPr && !hasHistoricalHead) return
  if (pr && reviewedHead) return
  throw stateConflict('REVIEW_VERDICT historical binding is partial, duplicated, or ambiguous')
}
