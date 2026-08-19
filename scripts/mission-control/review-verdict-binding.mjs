import { parseCommentMarker } from './transition-identity.mjs'

export function normalizeAuthorityHead(value) {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized.toLowerCase() : null
}

export function normalizeAuthorityBase(value) {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized.toLowerCase() : null
}

export function headsAlign(left, right) {
  const normalizedLeft = normalizeAuthorityHead(left)
  const normalizedRight = normalizeAuthorityHead(right)
  if (!normalizedLeft || !normalizedRight) return true
  const isShaLike = (value) => /^[0-9a-f]{7,40}$/.test(value)
  if (normalizedLeft === normalizedRight) {
    return !isShaLike(normalizedLeft) || normalizedLeft.length === 40
  }
  if (normalizedLeft.length === 40 && normalizedRight.length === 40) return false
  if (normalizedLeft.length === 40) {
    return isShaLike(normalizedRight) && normalizedLeft.startsWith(normalizedRight)
  }
  if (normalizedRight.length === 40) {
    return isShaLike(normalizedLeft) && normalizedRight.startsWith(normalizedLeft)
  }
  return false
}

export function parseRoleCommentBody(body = '') {
  const heading = body.match(/^##\s+(HANDOFF|RESULT|REVIEW_VERDICT)\s*$/m)?.[1] ?? null
  if (!heading) {
    return {
      role: null,
      body,
      prNumber: null,
      base: null,
      headSha: null,
      verdict: null,
      managedStateLine: null,
    }
  }

  const prFromUrl = body.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/)?.[1] ?? null
  const prFromHash = body.match(/\bPR\s*#(\d+)\b/i)?.[1] ?? null
  const prFromCanonicalLine =
    body.match(
      /\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/i,
    )?.[1] ?? null
  const prFromCanonicalShorthand =
    body.match(/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*\bPR\s*#(\d+)\b/i)?.[1] ?? null
  const canonicalBaseMatch = body.match(
    /^\*\*PR\s*\/\s*base\s*\/\s*head:\*\*\s*(?:https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|PR\s*#\d+)\s*(?:\/\s*|\s*·\s*)(?:`([^`]+)`|([^/·]+?))\s*(?:\/\s*·|·)\s*`[0-9a-f]{7,40}`\s*$/im,
  )
  const baseFromCanonicalLine = (canonicalBaseMatch?.[1] ?? canonicalBaseMatch?.[2])?.trim() ?? null
  const baseFromStateLine = body.match(
    /^\*\*(?:State|Task(?:\s*\/\s*Issue)?):\*\*[^\n]*?\bbase\s+`([^`]+)`/im,
  )?.[1]?.trim() ?? null
  const baseFromTaskBranch = body.match(
    /^\*\*Task(?:\s*\/\s*Issue)?:\*\*[^\n]*?→\s*`([^`]+)`\s*·/im,
  )?.[1]?.trim() ?? null
  const baseFromLegacy = body.match(
    /^\*\*(?:Approved\s+base|Base):\*\*\s*(?:`([^`\r\n]+)`|([^\s\r\n]+))/im,
  )
  const base = normalizeAuthorityBase(
    baseFromCanonicalLine ||
      baseFromStateLine ||
      baseFromTaskBranch ||
      (baseFromLegacy?.[1] ?? baseFromLegacy?.[2])?.trim() ||
      null,
  )
  const headFromState = body.match(/\*\*State:\*\*[^\n]*head\s+`([0-9a-f]{7,40})`/i)?.[1] ?? null
  const headFromPrLine = body.match(/\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*·\s*`([0-9a-f]{7,40})`/i)?.[1] ?? null
  const headFromExact = body.match(/\*\*Exact head reviewed:\*\*\s*`([0-9a-f]{7,40})`/i)?.[1] ?? null
  const headSha = normalizeAuthorityHead(
    headFromPrLine ||
    headFromExact ||
    headFromState ||
    (body.match(/head\s+`([0-9a-f]{7,40})`/i)?.[1] ?? null),
  )
  const verdict = body.match(/^\*\*Verdict:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null
  const managedStateLine = body.match(/^\*\*Managed state:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null

  return {
    role: heading,
    body,
    prNumber:
      heading === 'REVIEW_VERDICT'
        ? prFromCanonicalLine || prFromCanonicalShorthand
        : prFromUrl || prFromHash,
    base,
    headSha,
    verdict,
    managedStateLine,
  }
}

export function isExplicitlyNonAuthoritativeRoleBody(body = '') {
  return (
    /\[(?:diagnostic|stale|superseded)\]/i.test(body) ||
    (/\b(?:hereby\s+)?superseded\b/i.test(body) && /\bnot\s+authorized\b/i.test(body)) ||
    /\bnot authoritative\b/i.test(body) ||
    /^\[Superseded (?:HANDOFF|RESULT|REVIEW_VERDICT) comment\./i.test(body)
  )
}

export function selectActiveRoleComments(comments = [], role) {
  return comments.filter((comment) => {
    const body = comment?.body ?? ''
    if (parseCommentMarker(body) !== role) return false
    return !isExplicitlyNonAuthoritativeRoleBody(body)
  })
}

export function isPostBudgetReviewState(state) {
  return state?.state === 'BLOCKED_FOR_FOUNDER_DECISION' &&
    state.review_cycle === 3 &&
    state.full_review_count === 1 &&
    Array.isArray(state.post_budget_reviews) &&
    state.post_budget_reviews.length === 0 &&
    state.active_pr &&
    state.current_head
}

function hasCompetingCurrentHeadReviewVerdicts(comments, issueNumber, activePr, currentHead) {
  const candidates = selectActiveRoleComments(comments, 'REVIEW_VERDICT').filter((comment) => {
    const body = String(comment.body ?? '')
    const taskIssue = body.match(/\*\*Task(?:\s*\/\s*Issue)?:\*\*\s*(?:Issue\s*)?#?(\d+)/i)?.[1] ?? null
    if (taskIssue && String(taskIssue) !== String(issueNumber)) return false
    const parsed = parseRoleCommentBody(body)
    return parsed.role === 'REVIEW_VERDICT' &&
      String(parsed.prNumber ?? '') === String(activePr ?? '') &&
      String(parsed.headSha ?? '').toLowerCase() === String(currentHead ?? '').toLowerCase()
  })
  return candidates.length > 1
}

export function getPostBudgetReviewEvidenceBlockers(comments, issueNumber, activePrRef, state) {
  if (!isPostBudgetReviewState(state)) return []
  if (!comments) return ['BLOCKED_EXTERNAL: authoritative Review 4 verdict evidence is unavailable.']

  try {
    if (hasCompetingCurrentHeadReviewVerdicts(comments, issueNumber, activePrRef, state.current_head)) {
      return ['STATE_CONFLICT: competing active REVIEW_VERDICT comments for the managed PR.']
    }
  } catch (error) {
    return [error instanceof Error ? error.message : `STATE_CONFLICT: ${String(error)}`]
  }

  return []
}

function parseCanonicalReviewTarget(body = '') {
  const match = body.match(
    /^\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*?·\s*`([^`]+)`\s*·\s*`([0-9a-f]{7,40})`\s*$/im,
  )
  return match ? { base: normalizeAuthorityBase(match[1]), head: match[2].toLowerCase() } : null
}

function hasCanonicalReviewTargetLine(body = '') {
  return /^\*\*PR\s*\/\s*base\s*\/\s*head:\*\*/im.test(body)
}

function parseTaskIssueNumber(body = '') {
  return body.match(/\*\*Task(?:\s*\/\s*Issue)?:\*\*\s*(?:Issue\s*)?#?(\d+)/i)?.[1] ??
    body.match(/Task\s*\/\s*Issue:\s*(?:Issue\s*)?#?(\d+)/i)?.[1] ?? null
}

function collectRecognizedTaskIssueNumbers(body = '') {
  const values = []
  for (const match of body.matchAll(/\*\*Task(?:\s*\/\s*Issue)?:\*\*\s*(?:Issue\s*)?#?(\d+)/gi)) {
    values.push(match[1])
  }
  for (const match of body.matchAll(/(?:^|\n)[ \t]*-[ \t]*Task\s*\/\s*Issue:\s*(?:Issue\s*)?#?(\d+)/gim)) {
    values.push(match[1])
  }
  return values
}

function resolveIssueScopingTaskNumber(body = '') {
  const values = collectRecognizedTaskIssueNumbers(body)
  if (values.length === 0) return parseTaskIssueNumber(body)
  const boldFieldCount = [...body.matchAll(/\*\*Task(?:\s*\/\s*Issue)?:\*\*\s*(?:Issue\s*)?#?(\d+)/gi)].length
  if (boldFieldCount > 1) {
    throw new Error('STATE_CONFLICT: REVIEW_VERDICT Task Issue bindings are duplicated or ambiguous')
  }
  const unique = [...new Set(values.map(String))]
  if (unique.length > 1) {
    throw new Error('STATE_CONFLICT: REVIEW_VERDICT Task Issue bindings are duplicated or ambiguous')
  }
  return unique[0]
}

function hasRetiredLegacyBindingFieldLabels(body = '') {
  return (
    /^\*\*Task:\*\*/m.test(body) ||
    /^\*\*PR:\*\*/m.test(body) ||
    /^\*\*Base:\*\*/m.test(body) ||
    /^\*\*Head:\*\*/m.test(body)
  )
}

function resolveReviewVerdictBinding(body) {
  const parsed = parseRoleCommentBody(body)
  const target = parseCanonicalReviewTarget(body)
  if (!hasCanonicalReviewTargetLine(body) || !parsed.prNumber || !parsed.headSha || !target) {
    throw new Error('STATE_CONFLICT: live REVIEW_VERDICT is missing canonical PR/base/head evidence')
  }
  return {
    kind: 'canonical',
    prNumber: String(parsed.prNumber),
    base: target.base,
    head: target.head,
    headSha: parsed.headSha,
    verdict: parsed.verdict,
  }
}

export function classifyReviewVerdictBindingEvidence(body, { issueNumber: _issueNumber }) {
  if (!hasCanonicalReviewTargetLine(body)) {
    if (hasRetiredLegacyBindingFieldLabels(body)) {
      return {
        status: 'malformed',
        error: new Error('STATE_CONFLICT: live REVIEW_VERDICT is missing canonical PR/base/head evidence'),
      }
    }
    return { status: 'none' }
  }
  try {
    return { status: 'valid', binding: resolveReviewVerdictBinding(body) }
  } catch (error) {
    return {
      status: 'malformed',
      error: error instanceof Error
        ? error
        : new Error('STATE_CONFLICT: REVIEW_VERDICT canonical binding evidence is malformed'),
    }
  }
}

export function classifyManagedPrReviewVerdicts({ comments, issueNumber, livePrNumber }) {
  const active = selectActiveRoleComments(comments, 'REVIEW_VERDICT')
  const samePr = []
  const differentPr = []
  for (const comment of active) {
    const taskIssue = resolveIssueScopingTaskNumber(comment.body ?? '')
    if (taskIssue != null && String(taskIssue) !== String(issueNumber)) {
      differentPr.push(comment)
      continue
    }
    const classification = classifyReviewVerdictBindingEvidence(comment.body ?? '', { issueNumber })
    if (classification.status === 'malformed') {
      throw classification.error instanceof Error
        ? classification.error
        : new Error('STATE_CONFLICT: REVIEW_VERDICT binding evidence is malformed')
    }
    if (classification.status !== 'valid') {
      throw new Error('STATE_CONFLICT: live REVIEW_VERDICT is missing canonical PR/base/head evidence')
    }
    if (String(classification.binding.prNumber) === String(livePrNumber)) {
      samePr.push(comment)
    } else {
      differentPr.push(comment)
    }
  }
  return { active, samePr, differentPr }
}

export function selectLiveReviewVerdictComment({ comments, issueNumber, livePr }) {
  const active = selectActiveRoleComments(comments, 'REVIEW_VERDICT')
  const issueRelevant = active.filter((comment) => {
    const taskIssue = resolveIssueScopingTaskNumber(comment.body ?? '')
    return taskIssue == null || String(taskIssue) === String(issueNumber)
  })
  const classified = issueRelevant.map((comment) => {
    const classification = classifyReviewVerdictBindingEvidence(comment.body ?? '', { issueNumber })
    if (classification.status === 'malformed') {
      throw classification.error instanceof Error
        ? classification.error
        : new Error('STATE_CONFLICT: REVIEW_VERDICT binding evidence is malformed')
    }
    return { comment, classification }
  })
  const relevant = classified.filter(({ classification }) => {
    if (classification.status !== 'valid') return true
    return String(classification.binding.prNumber) === String(livePr.number)
  })
  if (relevant.length === 0) {
    throw new Error('BLOCKED_EXTERNAL: no active REVIEW_VERDICT evidence for the managed Issue')
  }
  if (relevant.length > 1) {
    throw new Error('STATE_CONFLICT: competing active REVIEW_VERDICT comments')
  }
  const { comment, classification } = relevant[0]
  if (classification.status !== 'valid') {
    throw new Error('STATE_CONFLICT: live REVIEW_VERDICT is missing canonical PR/base/head evidence')
  }
  const binding = classification.binding
  if (String(binding.prNumber) !== String(livePr.number)) {
    throw new Error('STATE_CONFLICT: REVIEW_VERDICT PR does not match the live PR')
  }
  if (normalizeAuthorityBase(binding.base) !== normalizeAuthorityBase(livePr.baseRefName)) {
    throw new Error('STATE_CONFLICT: REVIEW_VERDICT base does not match the live PR')
  }
  const liveHead = normalizeAuthorityHead(livePr.headRefOid)
  if (!headsAlign(binding.head, liveHead) || !headsAlign(binding.headSha, liveHead)) {
    throw new Error('STATE_CONFLICT: REVIEW_VERDICT exact head does not match the live PR')
  }
  if (binding.verdict !== 'ELIGIBLE FOR FOUNDER REVIEW') {
    throw new Error('STATE_CONFLICT: eligible managed state requires an eligible REVIEW_VERDICT')
  }
  return comment
}
