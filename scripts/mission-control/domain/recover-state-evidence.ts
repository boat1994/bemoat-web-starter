import { parseCorrectionContract } from './correction-contract.mjs'
import {
  assertFounderAdoptFindingAuthorization,
  parseFounderAdoptFindingAuthorization,
} from './adopt-finding-authorization.mjs'
import { hashExactBody, stableStringify } from './correction-contract-fingerprint.mjs'
type RuntimeObject = { [key: string]: unknown }
type CorrectionFinding = RuntimeObject & { id: string }
type CorrectionContract = RuntimeObject & {
  mode: 'implementation_pr' | 'planning_no_pr'
  reviewed_head: string
  findings: CorrectionFinding[]
}
type AdoptionAuthorization = RuntimeObject & {
  adopted_finding: RuntimeObject & { id: string }
  predecessor_comment_id: string
  predecessor_reviewed_head: string
  existing_finding_ids: string[]
}
type ParseContractResult =
  | { ok: true; contract: CorrectionContract }
  | { ok: false; errors: string[] }
type CounterSignal = {
  reviewCycle: number | null
  fullReviewCount: number | null
  source: string
}
type CounterResult = {
  reviewCycle: number
  fullReviewCount: number
  sourceCommentIds: string[]
  sourceBodyHashes: string[]
}
type PredecessorResult = {
  body: string
  bodyHash: string
  reviewedHead: string
  contract: CorrectionContract
  findingIds: string[]
  counters: CounterResult
  updatedAt: unknown
}
type ImplementationEvidence = { body: string; bodyHash: string; head: string }
const ADOPT_FINDING_ID = 'MC-CORRECTION-FINDING-ADOPTION-001'
const RECOVER_STATE_COMMAND = 'bemoat:mission-control:recover-state'
const NEXT_ACTION_COMMAND = 'bemoat:mission-control:adopt-finding'
const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const ADOPT_AUTHORIZATION_HEADING_RE =
  /^##\s+FOUNDER AUTHORIZATION\s+[—-]\s+MC-CORRECTION-FINDING-ADOPTION-001\s*$/mi
const RESULT_HEADING_RE = /^##\s+RESULT\s*$/mi
const REVIEW_VERDICT_HEADING_RE = /^##\s+REVIEW_VERDICT\s*$/mi
function classifiedError(classification: string, message: string, details: RuntimeObject = {}): Error & RuntimeObject { return Object.assign(new Error(`${classification}: ${message}`), { classification }, details) }
function isRuntimeObject(value: unknown): value is RuntimeObject { return value !== null && typeof value === 'object' }
function readProperty(value: unknown, key: string): unknown { return value === null || value === undefined ? undefined : Reflect.get(Object(value), key) }
type InputProperty = 'comment' | 'comments' | 'options' | 'label' | 'commentId' | 'predecessorBody' | 'trustedFounderLogins' | 'expectedHead' | 'predecessor' | 'selectedIds' | 'historicalHead'
const inputPropertyReaders: { [key in InputProperty]: (input: RuntimeObject) => unknown } = { comment: ({ comment }) => comment, comments: ({ comments }) => comments, options: ({ options }) => options, label: ({ label }) => label, commentId: ({ commentId }) => commentId, predecessorBody: ({ predecessorBody }) => predecessorBody, trustedFounderLogins: ({ trustedFounderLogins }) => trustedFounderLogins, expectedHead: ({ expectedHead }) => expectedHead, predecessor: ({ predecessor }) => predecessor, selectedIds: ({ selectedIds }) => selectedIds, historicalHead: ({ historicalHead }) => historicalHead }
function readInputProperty(value: unknown, key: InputProperty): unknown { return Reflect.apply(inputPropertyReaders[key], undefined, [value]) }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === 'string') }
function filterComments(comments: unknown, callback: (entry: unknown) => boolean): unknown[] { const invoke = (): unknown[] => (comments as { filter: (predicate: (entry: unknown) => boolean) => unknown[] }).filter(callback); return Reflect.apply(invoke, undefined, [comments]) }
function normalizeText(value: unknown): string { return String(value ?? '').replace(/^`+|`+$/g, '').trim() }
function escapeRegExp(value: unknown): string { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function readLabeledValue(body: unknown, labels: unknown): string | null {
  const candidates: unknown[] = Array.isArray(labels) ? labels : [labels]
  for (const rawLine of String(body).split(/\r?\n/)) { const line = rawLine.trim().replace(/^[-*][ \t]+/, '').replace(/^\*\*/, '').replace(/:\*\*(?=[ \t]|$)/, ':'); for (const label of candidates) { const match = line.match(new RegExp(`^${escapeRegExp(label)}:[ \t]*(.+?)[ \t]*$`, 'i')); if (match) return normalizeText(match[1]) } }
  return null
}
function extractIssueNumber(body: unknown): string | null { const value = readLabeledValue(body, ['Task / Issue', 'Issue']); const leading = String(value ?? '').match(/^#?([1-9]\d*)\b/); return leading?.[1] ?? normalizeId(value) }
function extractPrNumber(body: unknown): string | null { const value = readLabeledValue(body, ['Reviewed PR', 'PR']); if (value) { const parsed = normalizeId(value); if (parsed) return parsed; const linked = value.match(/\/pull\/([1-9]\d*)\b/i); if (linked) return linked[1] } const linked = String(body).match(/\/pull\/([1-9]\d*)\b/i); return linked?.[1] ?? null }
function assertCommentSnapshotIsUnedited(comment: unknown, label: string): void { const createdAt = readProperty(comment, 'created_at'); const updatedAt = readProperty(comment, 'updated_at'); if (createdAt && updatedAt && String(createdAt) !== String(updatedAt)) throw classifiedError('EVIDENCE_CONFLICT', `${label} has an edited GitHub comment snapshot`) }
function assertCommentIsImmutable(input: unknown): unknown {
  const comment = readInputProperty(input, 'comment'); const comments = readInputProperty(input, 'comments'); const options = readInputProperty(input, 'options'); const label = readInputProperty(input, 'label'); const explicitCommentId = readInputProperty(input, 'commentId'); const commentId = explicitCommentId === undefined ? readProperty(options, String(label)) : explicitCommentId
  if (!comment || String(readProperty(comment, 'id')) !== String(commentId)) throw classifiedError('EVIDENCE_CONFLICT', `${String(label)} does not identify the selected immutable comment`)
  const live = filterComments(comments, (entry) => String(readProperty(entry, 'id')) === String(readProperty(comment, 'id')))
  if (live.length !== 1 || String(readProperty(live[0], 'body') ?? '') !== String(readProperty(comment, 'body') ?? '')) throw classifiedError('EVIDENCE_CONFLICT', `${String(label)} is missing or changed in the live Issue comments`)
  assertCommentSnapshotIsUnedited(live[0], String(label)); return comment
}
function commentAuthor(comment: unknown): unknown { const user = readProperty(comment, 'user'); const author = readProperty(comment, 'author'); return readProperty(user, 'login') ?? readProperty(author, 'login') ?? readProperty(comment, 'author_login') ?? null }
function assertTrustedAuthor(comment: unknown, trustedFounderLogins: unknown, label: string): unknown {
  const author = commentAuthor(comment); if (!author) throw classifiedError('AUTHORITY_CONFLICT', `${label} author is missing`); if (!Array.isArray(trustedFounderLogins) || trustedFounderLogins.length === 0) throw classifiedError('BLOCKED_EXTERNAL', 'repository-owned Founder identity configuration is unavailable'); if (!trustedFounderLogins.includes(author)) throw classifiedError('AUTHORITY_CONFLICT', `${label} author is not a trusted Founder login`); const association = readProperty(comment, 'author_association'); if (association && !['OWNER', 'MEMBER'].includes(String(association))) throw classifiedError('AUTHORITY_CONFLICT', `${label} author association is not trusted`); return author
}
function assertIssueAttachment(comment: unknown, options: unknown, label: string): void { const expected = `https://api.github.com/repos/${String(readProperty(options, 'repo'))}/issues/${String(readProperty(options, 'issueNumber'))}`; const issueUrl = readProperty(comment, 'issue_url'); if (issueUrl && issueUrl !== expected) throw classifiedError('EVIDENCE_CONFLICT', `${label} is not attached to the Task Issue`) }
function commentSupersedes(comment: unknown, targetId: unknown): boolean {
  const body = String(readProperty(comment, 'body') ?? ''); const targetPattern = new RegExp(`\\b#?${escapeRegExp(targetId)}\\b`, 'i'); return body.split(/\r?\n/).some((line) => new RegExp(`\\bsupersedes(?:_comment_id)?[ \\t]*:[ \\t]*#?${escapeRegExp(targetId)}\\b`, 'i').test(line) || targetPattern.test(line) && /\\b(?:superseded|not[ \\t]+authoritative)\\b/i.test(line))
}
function assertNotSuperseded(comments: unknown, comment: unknown, label: string): void {
  for (const candidate of filterComments(comments, () => true)) { if (String(readProperty(candidate, 'id')) === String(readProperty(comment, 'id'))) continue; if (commentSupersedes(candidate, readProperty(comment, 'id'))) throw classifiedError('AUTHORITY_CONFLICT', `${label} is superseded by comment ${String(readProperty(candidate, 'id'))}`) }
}
function assertSingleHeadingCandidate(comments: unknown, selected: unknown, heading: RegExp, label: string): void {
  const candidates = filterComments(comments, (comment) => heading.test(String(readProperty(comment, 'body') ?? ''))); if (candidates.length !== 1 || String(readProperty(candidates[0], 'id')) !== String(readProperty(selected, 'id'))) throw classifiedError('AUTHORITY_CONFLICT', `${label} is ambiguous or has competing immutable authority`)
}
function assertTaskPrBinding(body: unknown, options: unknown, label: string): void {
  if (extractIssueNumber(body) !== String(readProperty(options, 'issueNumber'))) throw classifiedError('EVIDENCE_CONFLICT', `${label} Task Issue binding does not match`); if (extractPrNumber(body) !== String(readProperty(options, 'expectedPr'))) throw classifiedError('EVIDENCE_CONFLICT', `${label} PR binding does not match`)
}
function assertBaseAndHeadText(body: unknown, values: { base: unknown; head: unknown }, label: string): void {
  const text = String(body); if (!new RegExp(`\\b${escapeRegExp(values.base)}\\b`).test(text)) throw classifiedError('HEAD_DRIFT', `${label} protected base binding does not match`); if (!text.toLowerCase().includes(String(values.head).toLowerCase())) throw classifiedError('HEAD_DRIFT', `${label} exact head binding does not match`)
}
function assertBodyContains(body: unknown, needle: unknown, label: string, classification = 'EVIDENCE_CONFLICT'): void { if (!String(body).toLowerCase().includes(String(needle).toLowerCase())) throw classifiedError(classification, `${label} is missing required evidence: ${String(needle)}`) }
function assertApprovedBaseBindingIfPresent(body: unknown, options: unknown, label: string): void {
  const value = readLabeledValue(body, 'Approved base'); if (!value) return; const approvedBaseSha = normalizeSha(value); const expectedBaseSha = String(readProperty(options, 'expectedBaseSha')); if (approvedBaseSha) { if (approvedBaseSha !== expectedBaseSha) throw classifiedError('HEAD_DRIFT', `${label} protected base SHA does not match`); return } if (!new RegExp(`\\b${escapeRegExp(readProperty(options, 'expectedBase'))}\\b`, 'i').test(value)) throw classifiedError('HEAD_DRIFT', `${label} protected base binding does not match`)
}
function lineHasExecutionProof(line: unknown, subjects: unknown[]): boolean { const text = String(line).toLowerCase(); const hasSubject = subjects.some((subject) => text.includes(String(subject).toLowerCase())); const hasExecution = /\b(?:execute|executed|execution)\b/.test(text); const hasNegation = /\b(?:did\s+not|not|never|no)\b/.test(text) || /\bunexecuted\b/.test(text); return hasSubject && hasExecution && hasNegation }
function lineClaimsExecution(line: unknown, subjects: unknown[]): boolean { const text = String(line).toLowerCase(); const hasSubject = subjects.some((subject) => text.includes(String(subject).toLowerCase())); return hasSubject && /\bexecuted\b/.test(text) && !/\b(?:did\s+not|not|never|no)\b/.test(text) }
function assertExecutionRemainedUnexecuted(body: unknown, subjects: unknown[], label: string): void {
  const lines = String(body).split(/\r?\n/); if (!lines.some((line) => lineHasExecutionProof(line, subjects))) throw classifiedError('AUTHORITY_CONFLICT', `${label} does not prove that the live operation remained unexecuted`); if (lines.some((line) => lineClaimsExecution(line, subjects))) throw classifiedError('AUTHORITY_CONFLICT', `${label} claims that the live operation was executed`)
}
function bodyContainsSha(body: unknown, sha: unknown): boolean { return String(body).toLowerCase().includes(String(sha).toLowerCase()) }
function parseExplicitCounterSignals(body: unknown): CounterSignal[] {
  const text = String(body); const signals: CounterSignal[] = []
  for (const match of text.matchAll(/\breview_cycle\s*[:=]\s*(\d+)\b/gi)) signals.push({ reviewCycle: Number(match[1]), fullReviewCount: null, source: 'review_cycle' })
  for (const match of text.matchAll(/\bfull_review_count\s*[:=]\s*(\d+)\b/gi)) signals.push({ reviewCycle: null, fullReviewCount: Number(match[1]), source: 'full_review_count' })
  for (const match of text.matchAll(/\bCycle\s*:\s*(\d+)\b/gi)) signals.push({ reviewCycle: Number(match[1]), fullReviewCount: null, source: 'Cycle' })
  for (const match of text.matchAll(/(?:resulting|expected)[^\n]{0,80}?counters?[^\n\d]*(\d+)\s*[|/]\s*(\d+)/gi)) signals.push({ reviewCycle: Number(match[1]), fullReviewCount: Number(match[2]), source: 'counters' })
  return signals
}
function isCorrectionContract(value: unknown): value is CorrectionContract { return isRuntimeObject(value) && (value.mode === 'implementation_pr' || value.mode === 'planning_no_pr') && typeof value.reviewed_head === 'string' && Array.isArray(value.findings) && value.findings.every((finding) => isRuntimeObject(finding) && typeof finding.id === 'string') }
function parseContractResult(value: unknown): ParseContractResult { if (isRuntimeObject(value) && value.ok === true && isCorrectionContract(value.contract)) return { ok: true, contract: value.contract }; if (isRuntimeObject(value) && isStringArray(value.errors)) return { ok: false, errors: value.errors }; return { ok: false, errors: ['correction contract is invalid'] } }
function isAdoptionAuthorization(value: unknown): value is AdoptionAuthorization { return isRuntimeObject(value) && isRuntimeObject(value.adopted_finding) && typeof value.adopted_finding.id === 'string' && typeof value.predecessor_comment_id === 'string' && typeof value.predecessor_reviewed_head === 'string' && isStringArray(value.existing_finding_ids) }
function exactBodyHash(value: unknown): string { return hashExactBody(value) }
function deriveCounters(input: unknown): CounterResult {
  const predecessorBody = readInputProperty(input, 'predecessorBody')
  const comments = readInputProperty(input, 'comments')
  const options = readInputProperty(input, 'options')
  const trustedFounderLogins = readInputProperty(input, 'trustedFounderLogins')
  const relevantComments: Array<{ id: unknown; body: string }> = [{
    id: readProperty(options, 'predecessorComment'),
    body: String(predecessorBody),
  }]
  for (const comment of filterComments(comments, () => true)) {
    const body = String(readProperty(comment, 'body') ?? '')
    if (body === String(predecessorBody)) continue
    if (!/##\s+REVIEW_VERDICT\b/i.test(body)) continue
    const boundToTaskAndPr = extractIssueNumber(body) === String(readProperty(options, 'issueNumber')) &&
      extractPrNumber(body) === String(readProperty(options, 'expectedPr'))
    if (!boundToTaskAndPr) continue
    const signals = parseExplicitCounterSignals(body)
    if (signals.length === 0) continue
    const reviewedHead = normalizeSha(readLabeledValue(body, ['Exact head reviewed', 'Head']))
    if (!reviewedHead) {
      throw classifiedError('EVIDENCE_CONFLICT', `counter evidence comment ${String(readProperty(comment, 'id'))} does not bind a full reviewed head`)
    }
    const verdict = readLabeledValue(body, 'Verdict')?.toUpperCase()
    if (verdict !== 'CORRECTION REQUIRED' && verdict !== 'ELIGIBLE FOR FOUNDER REVIEW') {
      throw classifiedError('EVIDENCE_CONFLICT', `counter evidence comment ${String(readProperty(comment, 'id'))} has an unsupported verdict`)
    }
    assertTrustedAuthor(comment, trustedFounderLogins, `counter evidence comment ${String(readProperty(comment, 'id'))}`)
    assertCommentSnapshotIsUnedited(comment, `counter evidence comment ${String(readProperty(comment, 'id'))}`)
    relevantComments.push({ id: readProperty(comment, 'id') ?? null, body })
  }
  const signals = relevantComments.flatMap((entry) => parseExplicitCounterSignals(entry.body).map((signal) => ({
    ...signal,
    sourceCommentId: entry.id,
  })))
  const reviewCycles = [...new Set(signals.map((signal) => signal.reviewCycle).filter((value): value is number => value !== null))]
  const fullReviewCounts = [...new Set(signals.map((signal) => signal.fullReviewCount).filter((value): value is number => value !== null))]
  if (reviewCycles.some((value) => value < 1 || value > 2) || fullReviewCounts.some((value) => value !== 1)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'evidence contains unsupported review counters')
  }
  if (reviewCycles.length > 1 || fullReviewCounts.length > 1) {
    throw classifiedError('EVIDENCE_CONFLICT', 'evidence contains conflicting review counters')
  }
  if (reviewCycles.length === 0) {
    throw classifiedError('EVIDENCE_CONFLICT', 'no immutable Task/PR-bound counter lineage can reconstruct the review cycle')
  }
  const reviewCycle = reviewCycles[0]
  const fullReviewCount = fullReviewCounts[0] ?? 1
  if (reviewCycle > 2 || fullReviewCount !== 1 || fullReviewCount > reviewCycle) {
    throw classifiedError('EVIDENCE_CONFLICT', 'derived review counters are unsupported')
  }
  const selectedSignals = signals.filter((signal) => signal.reviewCycle === reviewCycle || signal.fullReviewCount === fullReviewCount)
  return {
    reviewCycle,
    fullReviewCount,
    sourceCommentIds: [...new Set(selectedSignals
      .map((signal) => signal.sourceCommentId)
      .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
      .map(String))],
    sourceBodyHashes: [...new Set(selectedSignals
      .map((signal) => relevantComments.find((entry) => String(entry.id) === String(signal.sourceCommentId))?.body)
      .filter((body): body is string => body !== undefined)
      .map(exactBodyHash))],
  }
}
export function normalizeSha(value: unknown): string | null {
  return typeof value === 'string' && FULL_SHA_RE.test(value.trim())
    ? value.trim().toLowerCase()
    : null
}
export function normalizeId(value: unknown): string | null {
  const match = String(value ?? '').match(/^#?([1-9]\d*)$/)
  return match?.[1] ?? null
}
export function parsePredecessor(input: unknown): PredecessorResult {
  const comment = readInputProperty(input, 'comment')
  const comments = readInputProperty(input, 'comments')
  const options = readInputProperty(input, 'options')
  const trustedFounderLogins = readInputProperty(input, 'trustedFounderLogins')
  const body = String(readProperty(comment, 'body') ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'predecessorComment' })
  assertTrustedAuthor(comment, trustedFounderLogins, 'predecessor correction contract')
  assertIssueAttachment(comment, options, 'predecessor correction contract')
  assertNotSuperseded(comments, comment, 'predecessor correction contract')
  assertBodyContains(body, '## REVIEW_VERDICT', 'predecessor correction contract')
  assertBodyContains(body, 'CORRECTION REQUIRED', 'predecessor correction contract')
  assertTaskPrBinding(body, options, 'predecessor correction contract')
  const parsed: ParseContractResult = parseContractResult(parseCorrectionContract(body))
  if (parsed.ok === false) {
    throw classifiedError('EVIDENCE_CONFLICT', `predecessor correction contract is invalid: ${parsed.errors.join('; ')}`)
  }
  if (parsed.contract.mode !== 'implementation_pr') {
    throw classifiedError('EVIDENCE_CONFLICT', 'planning_no_pr correction history is unsupported by recovery')
  }
  const reviewedHead = normalizeSha(parsed.contract.reviewed_head)
  if (!reviewedHead) throw classifiedError('HEAD_DRIFT', 'predecessor reviewed head must be a full SHA')
  assertBaseAndHeadText(body, { base: readProperty(options, 'expectedBase'), head: reviewedHead }, 'predecessor correction contract')
  assertApprovedBaseBindingIfPresent(body, options, 'predecessor correction contract')
  const findingIds = parsed.contract.findings.map((finding) => finding.id)
  if (findingIds.length === 0 || new Set(findingIds).size !== findingIds.length) {
    throw classifiedError('EVIDENCE_CONFLICT', 'predecessor correction findings are empty or duplicated')
  }
  return {
    body,
    bodyHash: exactBodyHash(body),
    reviewedHead,
    contract: parsed.contract,
    findingIds,
    counters: deriveCounters({ predecessorBody: body, comments, options, trustedFounderLogins }),
    updatedAt: readLabeledValue(body, 'Timestamp') ?? readProperty(comment, 'created_at') ?? null,
  }
}
export function parseAdoptionAuthorization(input: unknown): AdoptionAuthorization {
  const comment = readInputProperty(input, 'comment')
  const comments = readInputProperty(input, 'comments')
  const options = readInputProperty(input, 'options')
  const predecessor = readInputProperty(input, 'predecessor')
  const trustedFounderLogins = readInputProperty(input, 'trustedFounderLogins')
  const body = String(readProperty(comment, 'body') ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'adoptionAuthorizationComment' })
  assertIssueAttachment(comment, options, 'Founder finding-adoption authorization')
  assertTrustedAuthor(comment, trustedFounderLogins, 'Founder finding-adoption authorization')
  assertNotSuperseded(comments, comment, 'Founder finding-adoption authorization')
  assertSingleHeadingCandidate(comments, comment, ADOPT_AUTHORIZATION_HEADING_RE, 'Founder finding-adoption authorization')
  let parsed: unknown
  try {
    parsed = parseFounderAdoptFindingAuthorization(body)
  } catch (error) {
    throw classifiedError('AUTHORITY_CONFLICT', error instanceof Error ? error.message : String(error))
  }
  const authOptions = {
    repo: readProperty(options, 'repo'),
    issueNumber: readProperty(options, 'issueNumber'),
    expectedPr: readProperty(options, 'expectedPr'),
    expectedBase: readProperty(options, 'expectedBase'),
    expectedBaseSha: readProperty(options, 'expectedBaseSha'),
    authorizationComment: readProperty(options, 'adoptionAuthorizationComment'),
    predecessorComment: readProperty(options, 'predecessorComment'),
    expectedReviewedHead: readProperty(predecessor, 'reviewedHead'),
    expectedAdoptionHead: readProperty(parsed, 'adoption_head'),
  }
  try {
    const asserted: unknown = Reflect.apply(assertFounderAdoptFindingAuthorization, undefined, [{
      authorization: parsed,
      comment,
      comments,
      trustedFounderLogins,
      options: authOptions,
    }])
    if (!isAdoptionAuthorization(asserted)) {
      throw classifiedError('AUTHORITY_CONFLICT', 'adopt-finding authorization returned an invalid shape')
    }
    if (readProperty(asserted.adopted_finding, 'id') !== ADOPT_FINDING_ID) {
      throw classifiedError('EVIDENCE_CONFLICT', 'unsupported adopted finding identity')
    }
    if (String(asserted.predecessor_comment_id) !== String(readProperty(options, 'predecessorComment')) ||
        asserted.predecessor_reviewed_head !== readProperty(predecessor, 'reviewedHead') ||
        stableStringify(asserted.existing_finding_ids) !== stableStringify(readProperty(predecessor, 'findingIds'))) {
      throw classifiedError('EVIDENCE_CONFLICT', 'adopt-finding authorization does not bind the predecessor contract')
    }
    return asserted
  } catch (error) {
    if (isRuntimeObject(error) && error.classification) throw error
    throw classifiedError('AUTHORITY_CONFLICT', error instanceof Error ? error.message : String(error))
  }
}
export function parseImplementationResult(input: unknown): ImplementationEvidence {
  const comment = readInputProperty(input, 'comment')
  const comments = readInputProperty(input, 'comments')
  const options = readInputProperty(input, 'options')
  const trustedFounderLogins = readInputProperty(input, 'trustedFounderLogins')
  const expectedHead = readInputProperty(input, 'expectedHead')
  const body = String(readProperty(comment, 'body') ?? '')
  assertCommentIsImmutable({ comment, comments, options, label: 'implementationResultComment' })
  assertTrustedAuthor(comment, trustedFounderLogins, 'adopt-finding implementation RESULT')
  assertIssueAttachment(comment, options, 'adopt-finding implementation RESULT')
  assertNotSuperseded(comments, comment, 'adopt-finding implementation RESULT')
  assertBodyContains(body, '## RESULT', 'adopt-finding implementation RESULT')
  assertTaskPrBinding(body, options, 'adopt-finding implementation RESULT')
  assertBodyContains(body, 'bemoat:mission-control:adopt-finding', 'adopt-finding implementation RESULT')
  const head = normalizeSha(readLabeledValue(body, ['Head', 'Exact head']))
  if (!head) throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation RESULT must bind a full historical head')
  if (expectedHead && head !== expectedHead) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation RESULT head does not match its bound historical head')
  }
  assertBodyContains(body, readProperty(options, 'expectedBranch'), 'adopt-finding implementation RESULT')
  assertExecutionRemainedUnexecuted(body, ['live adoption', 'adopt-finding'], 'adopt-finding implementation RESULT')
  return { body, bodyHash: exactBodyHash(body), head }
}
export function parseImplementationReview(input: unknown): ImplementationEvidence {
  const comment = readInputProperty(input, 'comment')
  const comments = readInputProperty(input, 'comments')
  const options = readInputProperty(input, 'options')
  const trustedFounderLogins = readInputProperty(input, 'trustedFounderLogins')
  const expectedHead = readInputProperty(input, 'expectedHead')
  const body = String(readProperty(comment, 'body') ?? '')
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
  if (!head) throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation review must bind a full historical head')
  if (expectedHead && head !== expectedHead) {
    throw classifiedError('HEAD_DRIFT', 'adopt-finding implementation review head does not match its bound historical head')
  }
  return { body, bodyHash: exactBodyHash(body), head }
}
export function assertNoCompetingEvidence(input: unknown): void {
  const comments = readInputProperty(input, 'comments')
  const selectedIds = readInputProperty(input, 'selectedIds')
  const options = readInputProperty(input, 'options')
  const predecessor = readInputProperty(input, 'predecessor')
  const historicalHead = readInputProperty(input, 'historicalHead')
  if (selectedIds === null || selectedIds === undefined) throw new TypeError('Cannot convert undefined or null to object')
  const selected = new Set(Object.values(Object(selectedIds)).map((value) => String(value)))
  const sameHeadVerdicts = filterComments(comments, (comment) => {
    const body = String(readProperty(comment, 'body') ?? '')
    return REVIEW_VERDICT_HEADING_RE.test(body) && bodyContainsSha(body, readProperty(options, 'expectedHead')) &&
      (body.includes('ELIGIBLE FOR FOUNDER REVIEW') || body.includes('CORRECTION REQUIRED'))
  })
  if (sameHeadVerdicts.some((comment) => !selected.has(String(readProperty(comment, 'id'))))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing current-head REVIEW_VERDICT evidence exists')
  }
  const samePredecessorContracts = filterComments(comments, (comment) => {
    const body = String(readProperty(comment, 'body') ?? '')
    return REVIEW_VERDICT_HEADING_RE.test(body) && bodyContainsSha(body, readProperty(predecessor, 'reviewedHead')) && /CORRECTION REQUIRED/i.test(body)
  })
  if (samePredecessorContracts.some((comment) => !selected.has(String(readProperty(comment, 'id'))))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing predecessor correction-contract evidence exists')
  }
  const sameHeadResults = filterComments(comments, (comment) => {
    const body = String(readProperty(comment, 'body') ?? '')
    return RESULT_HEADING_RE.test(body) && bodyContainsSha(body, readProperty(options, 'expectedHead')) && body.includes('adopt-finding')
  })
  if (sameHeadResults.some((comment) => !selected.has(String(readProperty(comment, 'id'))))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing adopt-finding implementation RESULT evidence exists')
  }
  const sameHeadRecoveryResults = filterComments(comments, (comment) => {
    const body = String(readProperty(comment, 'body') ?? '')
    return RESULT_HEADING_RE.test(body) && bodyContainsSha(body, readProperty(options, 'expectedHead')) && body.includes(RECOVER_STATE_COMMAND)
  })
  if (sameHeadRecoveryResults.some((comment) => !selected.has(String(readProperty(comment, 'id'))))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing missing-state recovery implementation RESULT evidence exists')
  }
  const sameHistoricalResults = filterComments(comments, (comment) => {
    const body = String(readProperty(comment, 'body') ?? '')
    return RESULT_HEADING_RE.test(body) && bodyContainsSha(body, historicalHead) && body.includes('adopt-finding')
  })
  if (sameHistoricalResults.some((comment) => !selected.has(String(readProperty(comment, 'id'))))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing historical adopt-finding implementation RESULT evidence exists')
  }
  const sameHistoricalVerdicts = filterComments(comments, (comment) => {
    const body = String(readProperty(comment, 'body') ?? '')
    return REVIEW_VERDICT_HEADING_RE.test(body) && bodyContainsSha(body, historicalHead) &&
      body.includes(ADOPT_FINDING_ID) && body.includes('ELIGIBLE FOR FOUNDER REVIEW')
  })
  if (sameHistoricalVerdicts.some((comment) => !selected.has(String(readProperty(comment, 'id'))))) {
    throw classifiedError('EVIDENCE_CONFLICT', 'competing historical adopt-finding REVIEW_VERDICT evidence exists')
  }
  for (const comment of filterComments(comments, () => true)) {
    if (selected.has(String(readProperty(comment, 'id')))) continue
    const lines = String(readProperty(comment, 'body') ?? '').split(/\r?\n/)
    if (lines.some((line) => lineClaimsExecution(line, ['live adoption', 'adopt-finding']))) {
      throw classifiedError('AUTHORITY_CONFLICT', 'unknown evidence claims live finding adoption was executed')
    }
  }
}
