import { hashExactBody } from './correction-contract-fingerprint.ts'

export const ADOPT_FINDING_AUTHORIZATION_HEADING_RE =
  /^##\s+FOUNDER AUTHORIZATION\s+[—-]\s+([A-Z0-9][A-Z0-9._-]*)\s*$/m
export const ADOPT_FINDING_BUNDLE_KIND = 'founder-correction-finding-adoption'
export const ADOPT_FINDING_TRANSPORT = 'bemoat:mission-control:adopt-finding'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const POSITIVE_ID_RE = /^[1-9]\d*$/

type ClassifiedError = Error & { classification: string }
type LegacyComment = {
  id?: unknown
  body?: unknown
  issue_url?: unknown
  user?: { login?: unknown } | null
  author?: { login?: unknown } | null
  author_login?: unknown
  author_association?: unknown
}

type BaseBinding = { base: string; baseSha: string }

type AdoptedFinding = {
  id: string
  canonical_summary: string
  source_thread: string
  required_evidence: string[]
  expected_areas: string[]
  prohibited_areas: string[]
}

export type FounderAdoptFindingAuthorization = {
  schema_version: number
  authority: string
  status: string
  bundle_kind: string
  authorization_id: string
  transport: string
  repository: string
  task_issue: number
  pr: number
  base: string
  base_sha: string
  adoption_head: string
  predecessor_comment_id: string
  predecessor_reviewed_head: string
  existing_finding_ids: string[]
  adopted_finding: AdoptedFinding
  body_sha256: string
  comment_id?: string
  founder_author_login?: string
  non_superseded?: boolean
}

type AuthorizationOptions = {
  authorizationComment: string | number
  repo: string
  issueNumber: string | number
  expectedPr: string | number
  expectedBase: string
  expectedBaseSha: string
  expectedAdoptionHead: string
  expectedReviewedHead: string
  predecessorComment: string | number
}

function classifiedError(classification: string, message: string): ClassifiedError {
  const error = new Error(`${classification}: ${message}`) as ClassifiedError
  error.classification = classification
  return error
}

function readBulletValue(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = body.match(new RegExp(`^[ \\t]*[-*][ \\t]+${escaped}:[ \\t]*(.+?)\\s*$`, 'mi'))
  return match?.[1]?.trim() ?? null
}

function stripTicks(value: unknown): string {
  return String(value ?? '').replace(/^`+|`+$/g, '').trim()
}

function parseIssueOrPr(value: unknown): string | null {
  const match = String(value ?? '').match(/#?([1-9]\d*)/)
  return match ? match[1] : null
}

function parseBaseBinding(value: string | null): BaseBinding | null {
  const cleaned = stripTicks(value)
  const match = cleaned.match(/^([^@\s]+)@([0-9a-f]{40})$/i)
  if (!match) return null
  return { base: match[1], baseSha: match[2].toLowerCase() }
}

function parseCommentId(value: string | null): string | null {
  const cleaned = stripTicks(value)
  const match = cleaned.match(/(?:comment\s+)?`?([1-9]\d*)`?/i) ?? cleaned.match(/([1-9]\d*)/)
  return match?.[1] ?? null
}

function extractBacktickListAfter(body: string, label: string): string[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const section = body.match(new RegExp(
    `^[ \\t]*[-*][ \\t]+${escaped}:\\s*\\r?\\n((?:[ \\t]{2,}[-*][ \\t]+.+\\r?\\n?)+)`,
    'mi',
  ))
  if (!section) return []
  return [...section[1].matchAll(/`([^`]+)`/g)].map((match) => match[1].trim()).filter(Boolean)
}

function extractSingleBacktickAfter(body: string, label: string): string | null {
  const values = extractBacktickListAfter(body, label)
  if (values.length === 1) return values[0]
  const inline = readBulletValue(body, label)
  if (inline) {
    const tick = inline.match(/`([^`]+)`/)
    if (tick) return tick[1].trim()
  }
  return null
}

/**
 * Parse the minimum Founder authorization representation for adopt-finding.
 * Fail closed on ambiguity. Does not invent a general policy language.
 */
export function parseFounderAdoptFindingAuthorization(body = ''): FounderAdoptFindingAuthorization {
  const text = String(body)
  const heading = text.match(ADOPT_FINDING_AUTHORIZATION_HEADING_RE)
  if (!heading) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization heading is missing or malformed')
  }
  const authorizationId = heading[1].trim()

  const transportMatch = text.match(
    /###\s+Approved canonical transport\s*\r?\n+`([^`]+)`/i,
  )
  const transport = transportMatch?.[1]?.trim() ?? null
  if (transport !== ADOPT_FINDING_TRANSPORT) {
    throw classifiedError(
      'AUTHORITY_CONFLICT',
      `Founder authorization transport must be ${ADOPT_FINDING_TRANSPORT}`,
    )
  }

  const repository = stripTicks(readBulletValue(text, 'Repository'))
  const issue = parseIssueOrPr(stripTicks(readBulletValue(text, 'Issue')))
  const pr = parseIssueOrPr(stripTicks(readBulletValue(text, 'PR')))
  const baseBinding = parseBaseBinding(readBulletValue(text, 'Base'))
  const adoptionHead = stripTicks(readBulletValue(text, 'Live adoption head'))
  const predecessorCommentId = parseCommentId(readBulletValue(text, 'Predecessor contract'))
  const predecessorReviewedHead = stripTicks(readBulletValue(text, 'Predecessor reviewed head'))
  const existingFindingIds = extractBacktickListAfter(text, 'Existing immutable findings')
  const appendedFindingId = extractSingleBacktickAfter(text, 'Authorized appended finding')

  if (!repository || !repository.includes('/')) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization repository binding is missing')
  }
  if (!issue || !POSITIVE_ID_RE.test(issue)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization Issue binding is missing')
  }
  if (!pr || !POSITIVE_ID_RE.test(pr)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization PR binding is missing')
  }
  if (!baseBinding) {
    throw classifiedError('HEAD_DRIFT', 'Founder authorization base@sha binding is missing or malformed')
  }
  if (!adoptionHead || !FULL_SHA_RE.test(adoptionHead)) {
    throw classifiedError('HEAD_DRIFT', 'Founder authorization live adoption head must be a full SHA')
  }
  if (!predecessorCommentId || !POSITIVE_ID_RE.test(predecessorCommentId)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization predecessor contract comment is missing')
  }
  if (!predecessorReviewedHead || !FULL_SHA_RE.test(predecessorReviewedHead)) {
    throw classifiedError('HEAD_DRIFT', 'Founder authorization predecessor reviewed head must be a full SHA')
  }
  if (existingFindingIds.length === 0) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization existing immutable findings are missing')
  }
  if (!appendedFindingId) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization appended finding is missing')
  }
  if (appendedFindingId !== authorizationId) {
    throw classifiedError(
      'EVIDENCE_CONFLICT',
      'Founder authorization heading finding ID does not match the authorized appended finding',
    )
  }
  if (existingFindingIds.includes(appendedFindingId)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'authorized appended finding must not already be listed as immutable')
  }

  // Exactly one appended finding: reject additional authorized finding bullets.
  const appendedSection = text.match(
    /^[ \t]*[-*][ \t]+Authorized appended finding:\s*\r?\n((?:[ \t]{2,}[-*][ \t]+.+\r?\n?)+)/im,
  )
  if (appendedSection) {
    const ids = [...appendedSection[1].matchAll(/`([^`]+)`/g)].map((match) => match[1].trim())
    if (ids.length !== 1) {
      throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization must authorize exactly one appended finding')
    }
  }

  const finding: AdoptedFinding = {
    id: appendedFindingId,
    canonical_summary:
      `Founder-authorized append-only adoption of ${appendedFindingId} via ${ADOPT_FINDING_TRANSPORT} under CORRECTION_REQUIRED_1|2 without changing managed review state.`,
    source_thread: `https://github.com/${repository}/issues/${issue}`,
    required_evidence: [
      `${ADOPT_FINDING_TRANSPORT} --help --json`,
      'focused adopt-finding contract tests',
      'active correction-contract identity CAS evidence',
    ],
    expected_areas: [],
    prohibited_areas: [],
  }

  return {
    schema_version: 1,
    authority: 'Founder',
    status: 'approved',
    bundle_kind: ADOPT_FINDING_BUNDLE_KIND,
    authorization_id: authorizationId,
    transport: ADOPT_FINDING_TRANSPORT,
    repository,
    task_issue: Number(issue),
    pr: Number(pr),
    base: baseBinding.base,
    base_sha: baseBinding.baseSha,
    adoption_head: adoptionHead.toLowerCase(),
    predecessor_comment_id: predecessorCommentId,
    predecessor_reviewed_head: predecessorReviewedHead.toLowerCase(),
    existing_finding_ids: existingFindingIds,
    adopted_finding: finding,
    body_sha256: hashExactBody(text),
  }
}

/**
 * Authenticate and bind a live Founder authorization comment.
 */
export function assertFounderAdoptFindingAuthorization({
  authorization,
  comment,
  comments,
  trustedFounderLogins,
  options,
}: {
  authorization: FounderAdoptFindingAuthorization
  comment: LegacyComment
  comments: LegacyComment[]
  trustedFounderLogins: string[]
  options: AuthorizationOptions
}): FounderAdoptFindingAuthorization {
  if (!comment || String(comment.id) !== String(options.authorizationComment)) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization comment ID is not the immutable live comment')
  }
  const expectedIssueUrl = `https://api.github.com/repos/${options.repo}/issues/${options.issueNumber}`
  if (comment.issue_url && comment.issue_url !== expectedIssueUrl) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization comment is not attached to the Task Issue')
  }

  const author = comment?.user?.login ?? comment?.author?.login ?? comment?.author_login ?? null
  if (!author) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization comment author is missing')
  }
  if (!Array.isArray(trustedFounderLogins) || trustedFounderLogins.length === 0) {
    throw classifiedError('BLOCKED_EXTERNAL', 'repository-owned Founder identity configuration is unavailable')
  }
  if (!trustedFounderLogins.includes(String(author))) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization author is not a trusted Founder login')
  }
  if (comment.author_association && comment.author_association !== 'OWNER' && comment.author_association !== 'MEMBER') {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization comment association is not trusted')
  }

  const bodyHash = hashExactBody(String(comment.body ?? ''))
  if (authorization.body_sha256 !== bodyHash) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization body hash does not match the live comment')
  }

  if (authorization.repository !== options.repo) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization repository does not match the invocation')
  }
  if (String(authorization.task_issue) !== String(options.issueNumber)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization Issue does not match the invocation')
  }
  if (String(authorization.pr) !== String(options.expectedPr)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization PR does not match the invocation')
  }
  if (authorization.base !== options.expectedBase || authorization.base_sha !== options.expectedBaseSha.toLowerCase()) {
    throw classifiedError('HEAD_DRIFT', 'Founder authorization base/SHA does not match the invocation')
  }
  if (authorization.adoption_head !== options.expectedAdoptionHead.toLowerCase()) {
    throw classifiedError('HEAD_DRIFT', 'Founder authorization adoption head does not match the invocation')
  }
  if (authorization.predecessor_reviewed_head !== options.expectedReviewedHead.toLowerCase()) {
    throw classifiedError('HEAD_DRIFT', 'Founder authorization predecessor reviewed head does not match the invocation')
  }
  if (String(authorization.predecessor_comment_id) !== String(options.predecessorComment)) {
    throw classifiedError('EVIDENCE_CONFLICT', 'Founder authorization predecessor comment does not match the invocation')
  }

  assertNonSupersession({ comments, targetComment: comment, authorization })
  assertNoCompetingAuthorizations({ comments, targetComment: comment, options })

  return {
    ...authorization,
    comment_id: String(comment.id),
    founder_author_login: String(author),
    non_superseded: true,
    body_sha256: bodyHash,
  }
}

function commentSupersedesId(comment: LegacyComment, targetId: string): boolean {
  const body = String(comment?.body ?? '')
  if (
    body.includes(`supersedes: ${targetId}`) ||
    body.includes(`superseded_comment_id: ${targetId}`) ||
    (body.includes(String(targetId)) && /superseded|not authoritative/i.test(body) && !ADOPT_FINDING_AUTHORIZATION_HEADING_RE.test(body))
  ) {
    return true
  }
  return false
}

function assertNonSupersession({
  comments,
  targetComment,
  authorization,
}: {
  comments: LegacyComment[]
  targetComment: LegacyComment
  authorization: FounderAdoptFindingAuthorization
}): void {
  const targetId = String(targetComment.id)
  for (const comment of comments) {
    if (String(comment?.id) === targetId) continue
    if (commentSupersedesId(comment, targetId)) {
      throw classifiedError(
        'AUTHORITY_CONFLICT',
        `Founder authorization ${targetId} is superseded by comment ${comment.id}`,
      )
    }
  }
  if (authorization.non_superseded === false) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization is already superseded')
  }
}

function assertNoCompetingAuthorizations({
  comments,
  targetComment,
  options,
}: {
  comments: LegacyComment[]
  targetComment: LegacyComment
  options: AuthorizationOptions
}): void {
  const targetId = String(targetComment.id)
  const competitors: string[] = []
  for (const comment of comments) {
    if (String(comment?.id) === targetId) continue
    const body = String(comment?.body ?? '')
    if (!ADOPT_FINDING_AUTHORIZATION_HEADING_RE.test(body)) continue
    try {
      const candidate = parseFounderAdoptFindingAuthorization(body)
      if (
        candidate.repository === options.repo &&
        String(candidate.task_issue) === String(options.issueNumber) &&
        String(candidate.pr) === String(options.expectedPr)
      ) {
        competitors.push(String(comment.id))
      }
    } catch {
      // Malformed candidates are not competing authorizations.
    }
  }
  if (competitors.length > 0) {
    throw classifiedError(
      'AUTHORITY_CONFLICT',
      `competing Founder adopt-finding authorization comment(s) exist: ${competitors.join(', ')}`,
    )
  }
}
