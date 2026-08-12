import { parseCorrectionContract } from './correction-contract.mjs'
import {
  assertFounderAdoptFindingAuthorization,
  parseFounderAdoptFindingAuthorization,
} from './adopt-finding-authorization.mjs'
import { hashExactBody, stableStringify } from './correction-contract-fingerprint.mjs'

const ADOPT_FINDING_ID = 'MC-CORRECTION-FINDING-ADOPTION-001'
const RECOVER_STATE_COMMAND = 'bemoat:mission-control:recover-state'
const NEXT_ACTION_COMMAND = 'bemoat:mission-control:adopt-finding'
const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const ADOPT_AUTHORIZATION_HEADING_RE =
  /^##\s+FOUNDER AUTHORIZATION\s+[—-]\s+MC-CORRECTION-FINDING-ADOPTION-001\s*$/mi
const RESULT_HEADING_RE = /^##\s+RESULT\s*$/mi
const REVIEW_VERDICT_HEADING_RE = /^##\s+REVIEW_VERDICT\s*$/mi

function classifiedError(classification, message, details = {}) { const error = new Error(`${classification}: ${message}`); error.classification = classification; Object.assign(error, details); return error }
export function normalizeSha(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value.trim())
    ? value.trim().toLowerCase()
    : null
}
export function normalizeId(value) { const match = String(value ?? '').match(/^#?([1-9]\d*)$/); return match?.[1] ?? null }
function normalizeText(value) { return String(value ?? '').replace(/^`+|`+$/g, '').trim() }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function readLabeledValue(body, labels) {
  const candidates = Array.isArray(labels) ? labels : [labels]
  for (const rawLine of String(body).split(/\r?\n/)) {
    const line = rawLine.trim()
      .replace(/^[-*][ \t]+/, '')
      .replace(/^\*\*/, '')
      .replace(/:\*\*(?=[ \t]|$)/, ':')
    for (const label of candidates) {
      const escaped = escapeRegExp(label)
      const match = line.match(new RegExp(`^${escaped}:[ \t]*(.+?)[ \t]*$`, 'i'))
      if (match) return normalizeText(match[1])
    }
  }
  return null
}
function extractIssueNumber(body) { const value = readLabeledValue(body, ['Task / Issue', 'Issue']); const leading = String(value ?? '').match(/^#?([1-9]\d*)\b/); return leading?.[1] ?? normalizeId(value) }
function extractPrNumber(body) { const value = readLabeledValue(body, ['Reviewed PR', 'PR']); if (value) { const parsed = normalizeId(value); if (parsed) return parsed; const linked = value.match(/\/pull\/([1-9]\d*)\b/i); if (linked) return linked[1] } const linked = String(body).match(/\/pull\/([1-9]\d*)\b/i); return linked?.[1] ?? null }
function assertCommentIsImmutable({ comment, comments, options, label, commentId = options[label] }) {
  if (!comment || String(comment.id) !== String(commentId)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} does not identify the selected immutable comment`)
  }
  const live = comments.filter((entry) => String(entry?.id) === String(comment.id))
  if (live.length !== 1 || String(live[0]?.body ?? '') !== String(comment.body ?? '')) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} is missing or changed in the live Issue comments`)
  }
  assertCommentSnapshotIsUnedited(live[0], label)
  return comment
}
function assertCommentSnapshotIsUnedited(comment, label) { if (comment?.created_at && comment?.updated_at && String(comment.created_at) !== String(comment.updated_at)) { throw classifiedError('EVIDENCE_CONFLICT', `${label} has an edited GitHub comment snapshot`) } }
function commentAuthor(comment) { return comment?.user?.login ?? comment?.author?.login ?? comment?.author_login ?? null }
function assertTrustedAuthor(comment, trustedFounderLogins, label) {
  const author = commentAuthor(comment)
  if (!author) throw classifiedError('AUTHORITY_CONFLICT', `${label} author is missing`)
  if (!Array.isArray(trustedFounderLogins) || trustedFounderLogins.length === 0) {
    throw classifiedError('BLOCKED_EXTERNAL', 'repository-owned Founder identity configuration is unavailable')
  }
  if (!trustedFounderLogins.includes(author)) {
    throw classifiedError('AUTHORITY_CONFLICT', `${label} author is not a trusted Founder login`)
  }
  if (comment.author_association && !['OWNER', 'MEMBER'].includes(comment.author_association)) {
    throw classifiedError('AUTHORITY_CONFLICT', `${label} author association is not trusted`)
  }
  return author
}
function assertIssueAttachment(comment, options, label) { const expected = `https://api.github.com/repos/${options.repo}/issues/${options.issueNumber}`; if (comment?.issue_url && comment.issue_url !== expected) { throw classifiedError('EVIDENCE_CONFLICT', `${label} is not attached to the Task Issue`) } }
function commentSupersedes(comment, targetId) {
  const body = String(comment?.body ?? '')
  const targetPattern = new RegExp(`\\b#?${escapeRegExp(targetId)}\\b`, 'i')
  return body.split(/\r?\n/).some((line) => {
    if (new RegExp(`\\bsupersedes(?:_comment_id)?[ \\t]*:[ \\t]*#?${escapeRegExp(targetId)}\\b`, 'i').test(line)) {
      return true
    }
    return targetPattern.test(line) && /\\b(?:superseded|not[ \\t]+authoritative)\\b/i.test(line)
  })
}
function assertNotSuperseded(comments, comment, label) {
  for (const candidate of comments) {
    if (String(candidate?.id) === String(comment?.id)) continue
    if (commentSupersedes(candidate, comment.id)) {
      throw classifiedError('AUTHORITY_CONFLICT', `${label} is superseded by comment ${candidate.id}`)
    }
  }
}
function assertSingleHeadingCandidate(comments, selected, heading, label) { const candidates = comments.filter((comment) => heading.test(String(comment?.body ?? ''))); if (candidates.length !== 1 || String(candidates[0]?.id) !== String(selected?.id)) { throw classifiedError('AUTHORITY_CONFLICT', `${label} is ambiguous or has competing immutable authority`) } }
function assertTaskPrBinding(body, options, label) { if (extractIssueNumber(body) !== String(options.issueNumber)) { throw classifiedError('EVIDENCE_CONFLICT', `${label} Task Issue binding does not match`) } if (extractPrNumber(body) !== String(options.expectedPr)) { throw classifiedError('EVIDENCE_CONFLICT', `${label} PR binding does not match`) } }
function assertBaseAndHeadText(body, { base, head }, label) { const text = String(body); const basePattern = new RegExp(`\\b${escapeRegExp(base)}\\b`); if (!basePattern.test(text)) { throw classifiedError('HEAD_DRIFT', `${label} protected base binding does not match`) } if (!text.toLowerCase().includes(String(head).toLowerCase())) { throw classifiedError('HEAD_DRIFT', `${label} exact head binding does not match`) } }
function assertBodyContains(body, needle, label, classification = 'EVIDENCE_CONFLICT') { if (!String(body).toLowerCase().includes(String(needle).toLowerCase())) { throw classifiedError(classification, `${label} is missing required evidence: ${needle}`) } }
function assertApprovedBaseBindingIfPresent(body, options, label) {
  const value = readLabeledValue(body, 'Approved base')
  if (!value) return
  const approvedBaseSha = normalizeSha(value)
  if (approvedBaseSha) {
    if (approvedBaseSha !== options.expectedBaseSha) {
      throw classifiedError('HEAD_DRIFT', `${label} protected base SHA does not match`)
    }
    return
  }
  if (!new RegExp(`\\b${escapeRegExp(options.expectedBase)}\\b`, 'i').test(value)) {
    throw classifiedError('HEAD_DRIFT', `${label} protected base binding does not match`)
  }
}
function lineHasExecutionProof(line, subjects) { const text = String(line).toLowerCase(); const hasSubject = subjects.some((subject) => text.includes(String(subject).toLowerCase())); const hasExecution = /\b(?:execute|executed|execution)\b/.test(text); const hasNegation = /\b(?:did\s+not|not|never|no)\b/.test(text) || /\bunexecuted\b/.test(text); return hasSubject && hasExecution && hasNegation }
function lineClaimsExecution(line, subjects) { const text = String(line).toLowerCase(); const hasSubject = subjects.some((subject) => text.includes(String(subject).toLowerCase())); return hasSubject && /\bexecuted\b/.test(text) && !/\b(?:did\s+not|not|never|no)\b/.test(text) }
function assertExecutionRemainedUnexecuted(body, subjects, label) { const lines = String(body).split(/\r?\n/); if (!lines.some((line) => lineHasExecutionProof(line, subjects))) { throw classifiedError('AUTHORITY_CONFLICT', `${label} does not prove that the live operation remained unexecuted`) } if (lines.some((line) => lineClaimsExecution(line, subjects))) { throw classifiedError('AUTHORITY_CONFLICT', `${label} claims that the live operation was executed`) } }
function bodyContainsSha(body, sha) { return String(body).toLowerCase().includes(String(sha).toLowerCase()) }
function parseExplicitCounterSignals(body) {
  const text = String(body)
  const signals = []
  for (const match of text.matchAll(/\breview_cycle\s*[:=]\s*(\d+)\b/gi)) {
    signals.push({ reviewCycle: Number(match[1]), fullReviewCount: null, source: 'review_cycle' })
  }
  for (const match of text.matchAll(/\bfull_review_count\s*[:=]\s*(\d+)\b/gi)) {
    signals.push({ reviewCycle: null, fullReviewCount: Number(match[1]), source: 'full_review_count' })
  }
  for (const match of text.matchAll(/\bCycle\s*:\s*(\d+)\b/gi)) {
    signals.push({ reviewCycle: Number(match[1]), fullReviewCount: null, source: 'Cycle' })
  }
  for (const match of text.matchAll(/(?:resulting|expected)[^\n]{0,80}?counters?[^\n\d]*(\d+)\s*[|/]\s*(\d+)/gi)) {
    signals.push({ reviewCycle: Number(match[1]), fullReviewCount: Number(match[2]), source: 'counters' })
  }
  return signals
}
function deriveCounters({ predecessorBody, comments, options, trustedFounderLogins }) {
  const relevantComments = [{ id: options.predecessorComment, body: predecessorBody }]
  for (const comment of comments) {
    const body = String(comment?.body ?? '')
    if (body === predecessorBody) continue
    if (!/##\s+REVIEW_VERDICT\b/i.test(body)) continue
    const boundToTaskAndPr = extractIssueNumber(body) === String(options.issueNumber) &&
      extractPrNumber(body) === String(options.expectedPr)
    if (!boundToTaskAndPr) continue
    const signals = parseExplicitCounterSignals(body)
    if (signals.length === 0) continue
    const reviewedHead = normalizeSha(readLabeledValue(body, ['Exact head reviewed', 'Head']))
    if (!reviewedHead) {
      throw classifiedError('EVIDENCE_CONFLICT', `counter evidence comment ${comment.id} does not bind a full reviewed head`)
    }
    const verdict = readLabeledValue(body, 'Verdict')?.toUpperCase()
    if (!['CORRECTION REQUIRED', 'ELIGIBLE FOR FOUNDER REVIEW'].includes(verdict)) {
      throw classifiedError('EVIDENCE_CONFLICT', `counter evidence comment ${comment.id} has an unsupported verdict`)
    }
    assertTrustedAuthor(comment, trustedFounderLogins, `counter evidence comment ${comment.id}`)
    assertCommentSnapshotIsUnedited(comment, `counter evidence comment ${comment.id}`)
    relevantComments.push({ id: comment.id ?? null, body })
  }
  const signals = relevantComments.flatMap((entry) => parseExplicitCounterSignals(entry.body).map((signal) => ({
    ...signal,
    sourceCommentId: entry.id,
  })))
  const reviewCycles = [...new Set(signals.map((signal) => signal.reviewCycle).filter((value) => value !== null))]
  const fullReviewCounts = [...new Set(signals.map((signal) => signal.fullReviewCount).filter((value) => value !== null))]
  if (reviewCycles.some((value) => value < 1 || value > 2) || fullReviewCounts.some((value) => value !== 1)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'evidence contains unsupported review counters')
  }
  if (reviewCycles.length > 1 || fullReviewCounts.length > 1) {
    throw classifiedError('EVIDENCE_CONFLICT', 'evidence contains conflicting review counters')
  }
  if (reviewCycles.length === 0) {
    throw classifiedError('EVIDENCE_CONFLICT', 'no immutable Task/PR-bound counter lineage can reconstruct the review cycle')
  }
  // The selected predecessor contract omits numeric counters. A supported
  // correction lineage may therefore derive full_review_count from the
  // uniquely evidenced review cycle, but only after an immutable bound cycle
  // marker has established that this is a post-review correction state.
  const reviewCycle = reviewCycles[0]
  const fullReviewCount = fullReviewCounts[0] ?? 1
  if (reviewCycle > 2 || fullReviewCount !== 1 || fullReviewCount > reviewCycle) {
    throw classifiedError('EVIDENCE_CONFLICT', 'derived review counters are unsupported')
  }
  return {
    reviewCycle,
    fullReviewCount,
    sourceCommentIds: [...new Set(signals
      .filter((signal) => signal.reviewCycle === reviewCycle || signal.fullReviewCount === fullReviewCount)
      .map((signal) => signal.sourceCommentId)
      .filter((id) => id !== null)
      .map(String))],
    sourceBodyHashes: [...new Set(signals
      .filter((signal) => signal.reviewCycle === reviewCycle || signal.fullReviewCount === fullReviewCount)
      .map((signal) => relevantComments.find((entry) => String(entry.id) === String(signal.sourceCommentId))?.body)
      .filter((body) => body !== undefined)
      .map((body) => hashExactBody(body)))],
  }
}
export function parsePredecessor({ comment, comments, options, trustedFounderLogins }) {
  const body = String(comment?.body ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'predecessorComment' })
  assertTrustedAuthor(comment, trustedFounderLogins, 'predecessor correction contract')
  assertIssueAttachment(comment, options, 'predecessor correction contract')
  assertNotSuperseded(comments, comment, 'predecessor correction contract')
  assertBodyContains(body, '## REVIEW_VERDICT', 'predecessor correction contract')
  assertBodyContains(body, 'CORRECTION REQUIRED', 'predecessor correction contract')
  assertTaskPrBinding(body, options, 'predecessor correction contract')
  const parsed = parseCorrectionContract(body)
  if (!parsed.ok) {
    throw classifiedError('EVIDENCE_CONFLICT', `predecessor correction contract is invalid: ${parsed.errors.join('; ')}`)
  }
  if (parsed.contract.mode !== 'implementation_pr') {
    throw classifiedError('EVIDENCE_CONFLICT', 'planning_no_pr correction history is unsupported by recovery')
  }
  const reviewedHead = normalizeSha(parsed.contract.reviewed_head)
  if (!reviewedHead) throw classifiedError('HEAD_DRIFT', 'predecessor reviewed head must be a full SHA')
  assertBaseAndHeadText(body, { base: options.expectedBase, head: reviewedHead }, 'predecessor correction contract')
  assertApprovedBaseBindingIfPresent(body, options, 'predecessor correction contract')
  const findingIds = parsed.contract.findings.map((finding) => finding.id)
  if (findingIds.length === 0 || new Set(findingIds).size !== findingIds.length) {
    throw classifiedError('EVIDENCE_CONFLICT', 'predecessor correction findings are empty or duplicated')
  }
  return {
    body,
    bodyHash: hashExactBody(body),
    reviewedHead,
    contract: parsed.contract,
    findingIds,
    counters: deriveCounters({ predecessorBody: body, comments, options, trustedFounderLogins }),
    updatedAt: readLabeledValue(body, 'Timestamp') ?? comment.created_at ?? null,
  }
}
export function parseAdoptionAuthorization({ comment, comments, options, predecessor, trustedFounderLogins }) {
  const body = String(comment?.body ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'adoptionAuthorizationComment' })
  assertIssueAttachment(comment, options, 'Founder finding-adoption authorization')
  assertTrustedAuthor(comment, trustedFounderLogins, 'Founder finding-adoption authorization')
  assertNotSuperseded(comments, comment, 'Founder finding-adoption authorization')
  assertSingleHeadingCandidate(
    comments,
    comment,
    ADOPT_AUTHORIZATION_HEADING_RE,
    'Founder finding-adoption authorization',
  )
  let parsed
  try {
    parsed = parseFounderAdoptFindingAuthorization(body)
  } catch (error) {
    throw classifiedError('AUTHORITY_CONFLICT', error instanceof Error ? error.message : String(error))
  }
  const authOptions = {
    ...options,
    authorizationComment: options.adoptionAuthorizationComment,
    expectedReviewedHead: predecessor.reviewedHead,
    expectedAdoptionHead: parsed.adoption_head,
  }
  try {
    const asserted = assertFounderAdoptFindingAuthorization({
      authorization: parsed,
      comment,
      comments,
      trustedFounderLogins,
      options: authOptions,
    })
    if (asserted.adopted_finding.id !== ADOPT_FINDING_ID) {
      throw classifiedError('EVIDENCE_CONFLICT', 'unsupported adopted finding identity')
    }
    if (String(asserted.predecessor_comment_id) !== String(options.predecessorComment) ||
        asserted.predecessor_reviewed_head !== predecessor.reviewedHead ||
        stableStringify(asserted.existing_finding_ids) !== stableStringify(predecessor.findingIds)) {
      throw classifiedError('EVIDENCE_CONFLICT', 'adopt-finding authorization does not bind the predecessor contract')
    }
    return asserted
  } catch (error) {
    if (error?.classification) throw error
    throw classifiedError('AUTHORITY_CONFLICT', error instanceof Error ? error.message : String(error))
  }
}
export function parseImplementationResult({ comment, comments, options, trustedFounderLogins, expectedHead = null }) {
  const body = String(comment?.body ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'implementationResultComment' })
  assertTrustedAuthor(comment, trustedFounderLogins, 'adopt-finding implementation RESULT')
  assertIssueAttachment(comment, options, 'adopt-finding implementation RESULT')
  assertNotSuperseded(comments, comment, 'adopt-finding implementation RESULT')
  assertBodyContains(body, '## RESULT', 'adopt-finding implementation RESULT')
  assertTaskPrBinding(body, options, 'adopt-finding implementation RESULT')
  assertBodyContains(body, 'bemoat:mission-control:adopt-finding', 'adopt-finding implementation RESULT')
  const head = normalizeSha(readLabeledValue(body, ['Head', 'Exact head']))
  if (!head) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation RESULT must bind a full historical head')
  }
  if (expectedHead && head !== expectedHead) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation RESULT head does not match its bound historical head')
  }
  assertBodyContains(body, options.expectedBranch, 'adopt-finding implementation RESULT')
  assertExecutionRemainedUnexecuted(
    body,
    ['live adoption', 'adopt-finding'],
    'adopt-finding implementation RESULT',
  )
  return { body, bodyHash: hashExactBody(body), head }
}
export function parseImplementationReview({ comment, comments, options, trustedFounderLogins, expectedHead = null }) {
  const body = String(comment?.body ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'implementationReviewComment' })
  assertTrustedAuthor(comment, trustedFounderLogins, 'adopt-finding implementation review')
  assertIssueAttachment(comment, options, 'adopt-finding implementation review')
  assertNotSuperseded(comments, comment, 'adopt-finding implementation review')
  assertBodyContains(body, '## REVIEW_VERDICT', 'adopt-finding implementation review')
  assertTaskPrBinding(body, options, 'adopt-finding implementation review')
  assertBodyContains(body, 'ELIGIBLE FOR FOUNDER REVIEW', 'adopt-finding implementation review')
  assertBodyContains(body, ADOPT_FINDING_ID, 'adopt-finding implementation review')
  assertBodyContains(body, NEXT_ACTION_COMMAND, 'adopt-finding implementation review')
  assertApprovedBaseBindingIfPresent(body, options, 'adopt-finding implementation review')
  const head = normalizeSha(readLabeledValue(body, ['Exact head reviewed', 'Head']))
  if (!head) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation review must bind a full historical head')
  }
  if (expectedHead && head !== expectedHead) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation review head does not match its bound historical head')
  }
  return { body, bodyHash: hashExactBody(body), head }
}
export function assertNoCompetingEvidence({ comments, selectedIds, options, predecessor, historicalHead }) {
  const selected = new Set(Object.values(selectedIds).map((value) => String(value)))
  const sameHeadVerdicts = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return REVIEW_VERDICT_HEADING_RE.test(body) &&
      bodyContainsSha(body, options.expectedHead) &&
      (body.includes('ELIGIBLE FOR FOUNDER REVIEW') || body.includes('CORRECTION REQUIRED'))
  })
  if (sameHeadVerdicts.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing current-head REVIEW_VERDICT evidence exists')
  }
  const samePredecessorContracts = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return REVIEW_VERDICT_HEADING_RE.test(body) && bodyContainsSha(body, predecessor.reviewedHead) && /CORRECTION REQUIRED/i.test(body)
  })
  if (samePredecessorContracts.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing predecessor correction-contract evidence exists')
  }
  const sameHeadResults = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return RESULT_HEADING_RE.test(body) && bodyContainsSha(body, options.expectedHead) && body.includes('adopt-finding')
  })
  if (sameHeadResults.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing adopt-finding implementation RESULT evidence exists')
  }
  const sameHeadRecoveryResults = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return RESULT_HEADING_RE.test(body) && bodyContainsSha(body, options.expectedHead) && body.includes(RECOVER_STATE_COMMAND)
  })
  if (sameHeadRecoveryResults.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing missing-state recovery implementation RESULT evidence exists')
  }
  const sameHistoricalResults = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return RESULT_HEADING_RE.test(body) && bodyContainsSha(body, historicalHead) && body.includes('adopt-finding')
  })
  if (sameHistoricalResults.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing historical adopt-finding implementation RESULT evidence exists')
  }
  const sameHistoricalVerdicts = comments.filter((comment) => {
    const body = String(comment?.body ?? '')
    return REVIEW_VERDICT_HEADING_RE.test(body) && bodyContainsSha(body, historicalHead) &&
      body.includes(ADOPT_FINDING_ID) && body.includes('ELIGIBLE FOR FOUNDER REVIEW')
  })
  if (sameHistoricalVerdicts.some((comment) => !selected.has(String(comment.id)))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing historical adopt-finding REVIEW_VERDICT evidence exists')
  }
  for (const comment of comments) {
    if (selected.has(String(comment?.id))) continue
    const lines = String(comment?.body ?? '').split(/\r?\n/)
    if (lines.some((line) => lineClaimsExecution(line, ['live adoption', 'adopt-finding']))) {
      throw classifiedError('AUTHORITY_CONFLICT', 'unknown evidence claims live finding adoption was executed')
    }
  }
}
