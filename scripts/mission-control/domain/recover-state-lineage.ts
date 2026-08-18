import { hashExactBody } from './correction-contract-fingerprint.ts'

const RECOVERY_AUTHORIZATION_ID = 'MC-MISSING-MANAGED-STATE-RECOVERY-001'
const LINEAGE_CORRECTION_AUTHORIZATION_ID = 'RECOVER-STATE-LINEAGE-001'
const RECOVER_STATE_COMMAND = 'bemoat:mission-control:recover-state'
const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const RECOVERY_AUTHORIZATION_HEADING_RE = /^##\s+FOUNDER AUTHORIZATION\s+[—-]\s+MC-MISSING-MANAGED-STATE-RECOVERY-001\s*$/mi
const LINEAGE_CORRECTION_AUTHORIZATION_HEADING_RE = /^##\s+FOUNDER AUTHORIZATION\s+[—-]\s+RECOVER-STATE-LINEAGE-001\s*$/mi

class ClassifiedError extends Error {
  readonly classification: string

  constructor(classification: string, message: string) {
    super(`${classification}: ${message}`)
    this.classification = classification
  }
}

type AuthorLike = { login?: unknown }

type CommentLike = {
  id?: unknown
  body?: unknown
  issue_url?: unknown
  user?: AuthorLike | null
  author?: AuthorLike | null
  author_login?: unknown
  author_association?: unknown
  created_at?: unknown
  updated_at?: unknown
}

type CommentSnapshot = CommentLike | null | undefined

type LineageOptions = {
  repo: string
  issueNumber: string | number
  expectedPr: string | number
  expectedBase: string
  expectedBaseSha: string
  expectedHead: string
  expectedBranch: string
  predecessorComment: string | number
  adoptionAuthorizationComment: string | number
  implementationResultComment: string | number
  implementationReviewComment: string | number
  recoveryAuthorizationComment: string | number
  correctionResultComment: string | number
  correctionReviewComment: string | number
  [key: string]: unknown
}

type LineageCorrectionAuthorization = {
  body: string
  bodyHash: string
  authorizationId: string
  historicalImplementationResult: string
  historicalImplementationReview: string
  recoveryAuthorization: string
  recoveryImplementationResult: string
  recoveryImplementationReview: string
  currentHead: string
}

type ParsedEvidence = { body: string; bodyHash: string; head: string }
type RecoveryAuthorization = {
  body: string
  bodyHash: string
  authorizationId: string
  expectedState: string
  authorizedHead: string
}
type HistoricalImplementationResult = { head: string }
type DerivedState = { state: string }
type AncestryVerificationInput = {
  repository: string
  base: string
  baseSha: string
  ancestor: string
  descendant: string
}
type VerifyCommitAncestry = (input: AncestryVerificationInput) => unknown | Promise<unknown>
type AncestryRelation = {
  name: string
  ancestor: string
  descendant: string
  failure: string
}

function classifiedError(classification: string, message: string): ClassifiedError {
  return new ClassifiedError(classification, message)
}

function readProperty(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return Reflect.get(value, key)
}

function normalizeSha(value: unknown): string | null {
  return typeof value === 'string' && FULL_SHA_RE.test(value.trim()) ? value.trim().toLowerCase() : null
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/^`+|`+$/g, '').trim()
}

function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readLabeledValue(body: unknown, labels: string | readonly string[]): string | null {
  for (const rawLine of String(body).split(/\r?\n/)) {
    const line = rawLine.trim()
      .replace(/^[-*][ \t]+/, '')
      .replace(/^\*\*/, '')
      .replace(/:\*\*(?=[ \t]|$)/, ':')
    const candidateLabels = typeof labels === 'string' ? [labels] : labels
    for (const label of candidateLabels) {
      const match = line.match(new RegExp(`^${escapeRegExp(label)}:[ \t]*(.+?)[ \t]*$`, 'i'))
      if (match) return normalizeText(match[1])
    }
  }
  return null
}

function readExactCommentId(body: unknown, label: string, context: string): string {
  const candidate = readLabeledValue(body, label)?.match(/^(?:comment\s+)?`?#?([1-9]\d*)`?$/i)?.[1] ?? null
  if (!candidate) throw classifiedError('EVIDENCE_CONFLICT', `${context} is missing an immutable ${label} selector`)
  return candidate
}

function hasExactId(body: unknown, label: string, id: string | number): boolean {
  return (readLabeledValue(body, label)?.match(/(?:comment\s+)?`?#?([1-9]\d*)`?/i)?.[1] ?? null) === String(id)
}

function extractIssueNumber(body: unknown): string | null {
  return String(readLabeledValue(body, ['Task / Issue', 'Issue']) ?? '').match(/^#?([1-9]\d*)\b/)?.[1] ?? null
}

function extractPrNumber(body: unknown): string | null {
  const value = readLabeledValue(body, ['Reviewed PR', 'PR'])
  return String(value ?? '').match(/^#?([1-9]\d*)\b/)?.[1]
    ?? String(value ?? '').match(/\/pull\/([1-9]\d*)\b/i)?.[1]
    ?? String(body).match(/\/pull\/([1-9]\d*)\b/i)?.[1]
    ?? null
}

function assertImmutable({
  comment,
  comments,
  options,
  label,
  commentId = options[label],
}: {
  comment: CommentSnapshot
  comments: readonly CommentSnapshot[]
  options: LineageOptions
  label: string
  commentId?: unknown
}): void {
  const id = readProperty(comment, 'id')
  if (!comment || String(id) !== String(commentId)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} does not identify the selected immutable comment`)
  }
  const live = comments.filter((entry) => String(readProperty(entry, 'id')) === String(id))
  if (live.length !== 1 || String(readProperty(live[0], 'body') ?? '') !== String(readProperty(comment, 'body') ?? '')) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} is missing or changed in the live Issue comments`)
  }
  const createdAt = readProperty(live[0], 'created_at')
  const updatedAt = readProperty(live[0], 'updated_at')
  if (createdAt && updatedAt && String(createdAt) !== String(updatedAt)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} has an edited GitHub comment snapshot`)
  }
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function assertFounder(comment: CommentSnapshot, founders: unknown, label: string): void {
  const user = readProperty(comment, 'user')
  const author = readProperty(user, 'login')
    ?? readProperty(readProperty(comment, 'author'), 'login')
    ?? readProperty(comment, 'author_login')
    ?? null
  if (!author) throw classifiedError('AUTHORITY_CONFLICT', `${label} author is missing`)
  if (!isUnknownArray(founders) || founders.length === 0) {
    throw classifiedError('BLOCKED_EXTERNAL', 'repository-owned Founder identity configuration is unavailable')
  }
  if (!founders.includes(author)) throw classifiedError('AUTHORITY_CONFLICT', `${label} author is not a trusted Founder login`)
  const association = readProperty(comment, 'author_association')
  if (association && association !== 'OWNER' && association !== 'MEMBER') {
    throw classifiedError('AUTHORITY_CONFLICT', `${label} author association is not trusted`)
  }
}

function assertIssue(comment: CommentSnapshot, options: LineageOptions, label: string): void {
  const issueUrl = readProperty(comment, 'issue_url')
  if (issueUrl && issueUrl !== `https://api.github.com/repos/${options.repo}/issues/${options.issueNumber}`) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} is not attached to the Task Issue`)
  }
}

function assertNotSuperseded(comments: readonly CommentSnapshot[], comment: CommentSnapshot, label: string): void {
  const id = escapeRegExp(readProperty(comment, 'id'))
  const commentId = String(readProperty(comment, 'id'))
  const superseded = comments.some((candidate) => String(readProperty(candidate, 'id')) !== commentId
    && String(readProperty(candidate, 'body') ?? '').split(/\r?\n/).some((line) => (
      new RegExp(`\\bsupersedes(?:_comment_id)?[ \t]*:[ \t]*#?${id}\\b`, 'i').test(line)
      || (new RegExp(`\\b#?${id}\\b`, 'i').test(line) && /\\b(?:superseded|not[ \t]+authoritative)\\b/i.test(line))
    )))
  if (superseded) {
    const supersedingComment = comments.find((candidate) => String(readProperty(candidate, 'id')) !== commentId
      && String(readProperty(candidate, 'body') ?? '').includes(commentId))
    throw classifiedError('AUTHORITY_CONFLICT', `${label} is superseded by comment ${readProperty(supersedingComment, 'id')}`)
  }
}

function assertSingleHeading(
  comments: readonly CommentSnapshot[],
  selected: CommentSnapshot,
  heading: RegExp,
  label: string,
): void {
  const candidates = comments.filter((comment) => heading.test(String(readProperty(comment, 'body') ?? '')))
  if (candidates.length !== 1 || String(readProperty(candidates[0], 'id')) !== String(readProperty(selected, 'id'))) {
    throw classifiedError('AUTHORITY_CONFLICT', `${label} is ambiguous or has competing immutable authority`)
  }
}

function assertTaskPr(body: unknown, options: LineageOptions, label: string): void {
  if (extractIssueNumber(body) !== String(options.issueNumber)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} Task Issue binding does not match`)
  }
  if (extractPrNumber(body) !== String(options.expectedPr)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} PR binding does not match`)
  }
}

function assertContains(body: unknown, needle: string, label: string, classification = 'EVIDENCE_CONFLICT'): void {
  if (!String(body).toLowerCase().includes(String(needle).toLowerCase())) {
    throw classifiedError(classification, `${label} is missing required evidence: ${needle}`)
  }
}

function assertApprovedBase(body: unknown, options: LineageOptions, label: string): void {
  const value = readLabeledValue(body, 'Approved base')
  if (!value) return
  const sha = normalizeSha(value)
  if (sha && sha !== options.expectedBaseSha) throw classifiedError('HEAD_DRIFT', `${label} protected base SHA does not match`)
  if (!sha && !new RegExp(`\\b${escapeRegExp(options.expectedBase)}\\b`, 'i').test(value)) {
    throw classifiedError('HEAD_DRIFT', `${label} protected base binding does not match`)
  }
}

function assertUnexecuted(body: unknown, subjects: readonly string[], label: string): void {
  const lines = String(body).split(/\r?\n/)
  const hasProof = (line: string): boolean => {
    const text = String(line).toLowerCase()
    return subjects.some((subject) => text.includes(String(subject).toLowerCase()))
      && /\b(?:execute|executed|execution)\b/.test(text)
      && (/\b(?:did\s+not|not|never|no)\b/.test(text) || /\bunexecuted\b/.test(text))
  }
  const claimsExecution = (line: string): boolean => {
    const text = String(line).toLowerCase()
    return subjects.some((subject) => text.includes(String(subject).toLowerCase()))
      && /\bexecuted\b/.test(text)
      && !/\b(?:did\s+not|not|never|no)\b/.test(text)
  }
  if (!lines.some(hasProof)) throw classifiedError('AUTHORITY_CONFLICT', `${label} does not prove that the live operation remained unexecuted`)
  if (lines.some(claimsExecution)) throw classifiedError('AUTHORITY_CONFLICT', `${label} claims that the live operation was executed`)
}

export function parseLineageCorrectionAuthorization({
  comment,
  comments,
  options,
  trustedFounderLogins,
}: {
  comment: CommentSnapshot
  comments: readonly CommentSnapshot[]
  options: LineageOptions
  trustedFounderLogins: unknown
}): LineageCorrectionAuthorization {
  const body = String(readProperty(comment, 'body') ?? '')
  const label = 'recover-state lineage-correction authorization'
  assertImmutable({ comment, comments, options, label: 'lineageCorrectionAuthorizationComment' })
  assertFounder(comment, trustedFounderLogins, label)
  assertIssue(comment, options, label)
  assertNotSuperseded(comments, comment, label)
  assertSingleHeading(comments, comment, LINEAGE_CORRECTION_AUTHORIZATION_HEADING_RE, label)
  if (!LINEAGE_CORRECTION_AUTHORIZATION_HEADING_RE.test(body)) throw classifiedError('AUTHORITY_CONFLICT', `${label} heading is malformed`)
  assertContains(body, LINEAGE_CORRECTION_AUTHORIZATION_ID, label)
  assertContains(body, `Repository: \`${options.repo}\``, label)
  assertContains(body, `Issue: #${options.issueNumber}`, label)
  assertContains(body, `PR: #${options.expectedPr}`, label)
  assertContains(body, `Branch: \`${options.expectedBranch}\``, label)
  assertContains(body, `Protected base: \`${options.expectedBase}@${options.expectedBaseSha}\``, label, 'HEAD_DRIFT')
  const currentHead = normalizeSha(readLabeledValue(body, ['Current exact head', 'Current exact head at authorization']))
  if (!currentHead) throw classifiedError('HEAD_DRIFT', `${label} must bind a full recovery-anchor head`)
  const selectors = {
    historicalImplementationResult: readExactCommentId(body, 'Historical adopt-finding implementation RESULT', label),
    historicalImplementationReview: readExactCommentId(body, 'Historical adopt-finding implementation REVIEW_VERDICT', label),
    recoveryAuthorization: readExactCommentId(body, 'Missing-state recovery authorization', label),
    recoveryImplementationResult: readExactCommentId(body, 'Missing-state recovery implementation RESULT', label),
    recoveryImplementationReview: readExactCommentId(body, 'Missing-state recovery bounded REVIEW_VERDICT', label),
  }
  if (new Set(Object.values(selectors)).size !== 5) throw classifiedError('EVIDENCE_CONFLICT', `${label} contains duplicate immutable evidence selectors`)
  if (selectors.historicalImplementationResult !== String(options.implementationResultComment)
    || selectors.historicalImplementationReview !== String(options.implementationReviewComment)
    || selectors.recoveryAuthorization !== String(options.recoveryAuthorizationComment)) {
    throw classifiedError('EVIDENCE_CONFLICT', `${label} selectors do not match the explicit historical evidence invocation`)
  }
  return { body, bodyHash: hashExactBody(body), authorizationId: LINEAGE_CORRECTION_AUTHORIZATION_ID, ...selectors, currentHead }
}

export async function validateRecoverStateLineage({
  comments,
  options,
  trustedFounderLogins,
  derivedState,
  historicalImplementationResult,
  recoveryAuthorizationComment,
  lineageCorrectionAuthorization,
  recoveryImplementationResultComment,
  recoveryImplementationReviewComment,
  correctionResultComment,
  correctionReviewComment,
  verifyCommitAncestry,
}: {
  comments: readonly CommentSnapshot[]
  options: LineageOptions
  trustedFounderLogins: unknown
  derivedState: DerivedState
  historicalImplementationResult: HistoricalImplementationResult
  recoveryAuthorizationComment: CommentSnapshot
  lineageCorrectionAuthorization: LineageCorrectionAuthorization
  recoveryImplementationResultComment: CommentSnapshot
  recoveryImplementationReviewComment: CommentSnapshot
  correctionResultComment: CommentSnapshot
  correctionReviewComment: CommentSnapshot
  verifyCommitAncestry?: VerifyCommitAncestry
}): Promise<{
  recoveryAuthorization: RecoveryAuthorization
  lineageCorrectionAuthorization: LineageCorrectionAuthorization
  recoveryImplementationResult: ParsedEvidence
  recoveryImplementationReview: ParsedEvidence
  correctionImplementationResult: ParsedEvidence
  correctionImplementationReview: ParsedEvidence
  ancestryProofs: string[]
}> {
  const recoveryLabel = 'missing-state recovery authorization'
  const recoveryBody = String(readProperty(recoveryAuthorizationComment, 'body') ?? '')
  assertImmutable({ comment: recoveryAuthorizationComment, comments, options, label: 'recoveryAuthorizationComment' })
  assertFounder(recoveryAuthorizationComment, trustedFounderLogins, recoveryLabel)
  assertIssue(recoveryAuthorizationComment, options, recoveryLabel)
  assertNotSuperseded(comments, recoveryAuthorizationComment, recoveryLabel)
  assertSingleHeading(comments, recoveryAuthorizationComment, RECOVERY_AUTHORIZATION_HEADING_RE, recoveryLabel)
  if (!RECOVERY_AUTHORIZATION_HEADING_RE.test(recoveryBody)) throw classifiedError('AUTHORITY_CONFLICT', `${recoveryLabel} heading is malformed`)
  assertContains(recoveryBody, RECOVERY_AUTHORIZATION_ID, recoveryLabel)
  assertContains(recoveryBody, `Repository: \`${options.repo}\``, recoveryLabel)
  assertTaskPr(recoveryBody, options, recoveryLabel)
  assertContains(recoveryBody, `Branch: \`${options.expectedBranch}\``, recoveryLabel)
  assertContains(recoveryBody, `Base: \`${options.expectedBase}@${options.expectedBaseSha}\``, recoveryLabel, 'HEAD_DRIFT')
  const authorizedHead = normalizeSha(readLabeledValue(recoveryBody, 'Current exact head'))
  if (!authorizedHead) throw classifiedError('HEAD_DRIFT', 'missing-state recovery authorization must bind a full authorization head')
  if (!hasExactId(recoveryBody, 'Existing predecessor correction contract', options.predecessorComment)
    || !hasExactId(recoveryBody, 'Existing Founder finding-adoption authorization', options.adoptionAuthorizationComment)
    || !hasExactId(recoveryBody, 'Reviewed adopt-finding implementation verdict', options.implementationReviewComment)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'recovery authorization evidence selectors do not match')
  }
  const expectedState = readLabeledValue(recoveryBody, 'Expected reconstructable historical state for this incident')
  if (!expectedState) throw classifiedError('EVIDENCE_CONFLICT', 'missing-state recovery authorization expected state is missing')
  if (expectedState !== derivedState.state) throw classifiedError('EVIDENCE_CONFLICT', 'recovery authorization expected state conflicts with derived evidence')
  if (!/do not execute(?: the)? live recovery(?: transition)?/i.test(recoveryBody)) throw classifiedError('AUTHORITY_CONFLICT', 'missing-state recovery authorization does not prohibit live recovery execution')
  const recoveryAuthorization = { body: recoveryBody, bodyHash: hashExactBody(recoveryBody), authorizationId: RECOVERY_AUTHORIZATION_ID, expectedState, authorizedHead }

  function parseRecoveryImplementationResult(comment: CommentSnapshot): ParsedEvidence {
    const body = String(readProperty(comment, 'body') ?? '')
    const label = 'missing-state recovery implementation RESULT'
    assertImmutable({ comment, comments, options, label: 'recoveryImplementationResultComment', commentId: lineageCorrectionAuthorization.recoveryImplementationResult })
    assertFounder(comment, trustedFounderLogins, label)
    assertIssue(comment, options, label)
    assertNotSuperseded(comments, comment, label)
    assertContains(body, '## RESULT', label)
    assertTaskPr(body, options, label)
    assertContains(body, RECOVER_STATE_COMMAND, label)
    assertContains(body, options.expectedBranch, label)
    const head = normalizeSha(readLabeledValue(body, ['Head', 'Exact head']))
    if (!head) throw classifiedError('HEAD_DRIFT', `${label} must bind the current recovery head`)
    if (head !== lineageCorrectionAuthorization.currentHead) throw classifiedError('HEAD_DRIFT', `${label} head does not match the current recovery head`)
    assertUnexecuted(body, ['live recovery', 'recover-state', 'adopt-finding'], label)
    return { body, bodyHash: hashExactBody(body), head }
  }

  function parseRecoveryImplementationReview(comment: CommentSnapshot): ParsedEvidence {
    const body = String(readProperty(comment, 'body') ?? '')
    const label = 'missing-state recovery implementation review'
    assertImmutable({ comment, comments, options, label: 'recoveryImplementationReviewComment', commentId: lineageCorrectionAuthorization.recoveryImplementationReview })
    assertFounder(comment, trustedFounderLogins, label)
    assertIssue(comment, options, label)
    assertNotSuperseded(comments, comment, label)
    assertContains(body, '## REVIEW_VERDICT', label)
    assertTaskPr(body, options, label)
    assertContains(body, 'ELIGIBLE FOR FOUNDER REVIEW', label)
    assertApprovedBase(body, options, label)
    const head = normalizeSha(readLabeledValue(body, ['Exact head reviewed', 'Head']))
    if (!head) throw classifiedError('HEAD_DRIFT', `${label} must bind the current recovery head`)
    if (head !== lineageCorrectionAuthorization.currentHead) throw classifiedError('HEAD_DRIFT', `${label} head does not match the current recovery head`)
    return { body, bodyHash: hashExactBody(body), head }
  }

  function parseCorrectionImplementationResult(comment: CommentSnapshot): ParsedEvidence {
    const body = String(readProperty(comment, 'body') ?? '')
    const label = 'lineage correction implementation RESULT'
    assertImmutable({ comment, comments, options, label: 'correctionResultComment', commentId: options.correctionResultComment })
    assertFounder(comment, trustedFounderLogins, label)
    assertIssue(comment, options, label)
    assertNotSuperseded(comments, comment, label)
    assertContains(body, '## RESULT', label)
    assertTaskPr(body, options, label)
    assertContains(body, 'recover-state', label)
    assertContains(body, options.expectedBranch, label)
    const head = normalizeSha(readLabeledValue(body, ['Head', 'Exact head']))
    if (!head) throw classifiedError('HEAD_DRIFT', `${label} must bind a full correction-reviewed head`)
    if (head !== options.expectedHead) throw classifiedError('HEAD_DRIFT', `${label} head does not match the exact live PR head`)
    assertUnexecuted(body, ['live recovery', 'recover-state', 'adopt-finding'], label)
    return { body, bodyHash: hashExactBody(body), head }
  }

  function parseCorrectionImplementationReview(comment: CommentSnapshot): ParsedEvidence {
    const body = String(readProperty(comment, 'body') ?? '')
    const label = 'lineage correction bounded REVIEW_VERDICT'
    assertImmutable({ comment, comments, options, label: 'correctionReviewComment', commentId: options.correctionReviewComment })
    assertFounder(comment, trustedFounderLogins, label)
    assertIssue(comment, options, label)
    assertNotSuperseded(comments, comment, label)
    assertContains(body, '## REVIEW_VERDICT', label)
    assertTaskPr(body, options, label)
    assertContains(body, 'ELIGIBLE FOR FOUNDER REVIEW', label)
    assertApprovedBase(body, options, label)
    const head = normalizeSha(readLabeledValue(body, ['Exact head reviewed', 'Head']))
    if (!head) throw classifiedError('HEAD_DRIFT', `${label} must bind a full correction-reviewed head`)
    if (head !== options.expectedHead) throw classifiedError('HEAD_DRIFT', `${label} head does not match the exact live PR head`)
    return { body, bodyHash: hashExactBody(body), head }
  }

  const recoveryImplementationResult = parseRecoveryImplementationResult(recoveryImplementationResultComment)
  const recoveryImplementationReview = parseRecoveryImplementationReview(recoveryImplementationReviewComment)
  if (recoveryImplementationReview.head !== recoveryImplementationResult.head) throw classifiedError('HEAD_DRIFT', 'recovery implementation RESULT and REVIEW_VERDICT bind different recovery-anchor heads')
  if (lineageCorrectionAuthorization.currentHead !== recoveryImplementationResult.head) throw classifiedError('HEAD_DRIFT', 'lineage-correction authorization does not bind the recovery implementation anchor head')
  const correctionImplementationResult = parseCorrectionImplementationResult(correctionResultComment)
  const correctionImplementationReview = parseCorrectionImplementationReview(correctionReviewComment)
  if (correctionImplementationReview.head !== correctionImplementationResult.head) throw classifiedError('HEAD_DRIFT', 'correction RESULT and REVIEW_VERDICT bind different correction-reviewed heads')
  if (typeof verifyCommitAncestry !== 'function') throw classifiedError('BLOCKED_EXTERNAL', 'trusted Git ancestry verification is unavailable')
  const relations: AncestryRelation[] = [
    { name: 'historical_adopt_finding_head_is_ancestor_of_current_recovery_head', ancestor: historicalImplementationResult.head, descendant: recoveryImplementationResult.head, failure: 'historical adopt-finding head is not an ancestor of the current recovery head' },
    { name: 'recovery_authorization_bound_head_is_ancestor_of_recovery_implementation_anchor_head', ancestor: recoveryAuthorization.authorizedHead, descendant: recoveryImplementationResult.head, failure: 'recovery authorization head is not an ancestor of the recovery implementation anchor head' },
    { name: 'recovery_implementation_anchor_head_is_ancestor_of_correction_reviewed_head', ancestor: recoveryImplementationResult.head, descendant: correctionImplementationResult.head, failure: 'recovery implementation anchor head is not an ancestor of the correction-reviewed head' },
  ]
  const ancestryProofs: string[] = []
  const seen = new Set<string>()
  for (const relation of relations) {
    const key = `${relation.ancestor}:${relation.descendant}`
    if (seen.has(key) || relation.ancestor === relation.descendant) {
      ancestryProofs.push(relation.name)
      seen.add(key)
      continue
    }
    seen.add(key)
    let verified: unknown
    try {
      verified = await verifyCommitAncestry({ repository: options.repo, base: options.expectedBase, baseSha: options.expectedBaseSha, ancestor: relation.ancestor, descendant: relation.descendant })
    } catch (error: unknown) {
      if (readProperty(error, 'classification')) throw error
      throw classifiedError('BLOCKED_EXTERNAL', `trusted Git ancestry verification failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (verified !== true) {
      if (verified === false) throw classifiedError('HEAD_DRIFT', relation.failure)
      throw classifiedError('BLOCKED_EXTERNAL', 'trusted Git ancestry verification did not return a boolean proof')
    }
    ancestryProofs.push(relation.name)
  }
  return { recoveryAuthorization, lineageCorrectionAuthorization, recoveryImplementationResult, recoveryImplementationReview, correctionImplementationResult, correctionImplementationReview, ancestryProofs }
}
