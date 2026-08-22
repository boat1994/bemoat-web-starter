import { createHash } from 'node:crypto'

import { z } from 'zod'

type RuntimeObject = Record<string, unknown>

export const RecoveryRecordSchema = z.object({
  schema_version: z.number().optional(),
  record_kind: z.string().optional(),
  repository: z.string().optional(),
  task_issue: z.number().optional(),
  pr: z.number().optional(),
  base: z.string().optional(),
  exact_head: z.string().optional(),
  prior_last_reviewed_head: z.string().optional(),
  review_type: z.string().optional(),
  verdict: z.string().optional(),
  expected_prior_state: z.string().optional(),
  expected_prior_counters: z.object({ review_cycle: z.number().optional(), full_review_count: z.number().optional() }).catchall(z.unknown()).optional(),
  resulting_counters: z.object({ review_cycle: z.number().optional(), full_review_count: z.number().optional() }).catchall(z.unknown()).optional(),
  lineage: z.object({ original_review_comment_id: z.union([z.string(), z.number()]).optional(), correction_result_comment_id: z.union([z.string(), z.number()]).optional() }).catchall(z.unknown()).optional(),
  reviewer_identity: z.object({ login: z.string().optional(), github_database_id: z.union([z.string(), z.number()]).optional(), author_association: z.string().optional(), trust_source: z.string().optional() }).catchall(z.unknown()).optional(),
  protected_base_sha: z.unknown().optional(), incident_base_sha: z.string().optional(), execution_policy_sha: z.string().optional(), policy_source_sha: z.string().optional(),
  ci: z.array(z.object({ name: z.string().optional(), conclusion: z.string().optional(), check_run_id: z.union([z.string(), z.number()]).optional(), head_sha: z.string().optional() }).catchall(z.unknown())).optional(),
  resolved_findings: z.array(z.union([z.string(), z.number()])).optional(),
  source_evidence: z.array(z.object({ location: z.union([z.string(), z.number()]).optional(), comment_id: z.union([z.string(), z.number()]).optional(), classification: z.union([z.string(), z.number()]).optional(), body_sha256: z.union([z.string(), z.number()]).optional() }).catchall(z.unknown())).optional(),
  transition_identity_sha256: z.string().optional(),
}).catchall(z.unknown())

export type RecoveryRecord = z.infer<typeof RecoveryRecordSchema>

export type ValidationResult = { ok: true; record: RecoveryRecord } | { ok: false; errors: string[] }
export type ParseResult =
  | { ok: true; record: RecoveryRecord }
  | { ok: false; errors: string[] }
export type RecoverySourceEvidence = {
  location: string
  comment_id: number
  classification: string
  body_sha256: string
}
export type ReviewEvidenceComment = {
  id?: string | number
  databaseId?: string | number
  body?: string
  createdAt?: string
  created_at?: string
  author?: string
  author_association?: string
}
export type RecoveryInput = Record<string, unknown>

/**
 * The v2 recovery receipt binds one exact incident-class transport:
 *
 * - incident_base_sha is the immutable historical PR #275 baseRefOid and
 *   managed-state lineage. It is history only, not the current policy source.
 * - execution_policy_sha is the live protected main tip from which trusted
 *   recovery loads policy. It is serialized into the receipt and transition
 *   identity, then reverified before mutation.
 * - policy_source_sha remains the separate merged-guide content identity.
 *
 * The two base SHAs are independent and need not be equal. A v1 receipt or
 * record containing only protected_base_sha is ambiguous and fails closed.
 */
export const RECOVERY_SCHEMA_VERSION = 2
export const RECOVERY_RECORD_KIND = 'review_recovery'
export const RECOVERY_COMMAND = 'bemoat:mission-control:recover-review'
export const RECOVERY_SOURCE_COMMENT_IDS = Object.freeze({
  taskIssue: '5187836238',
  prConversation: '5187837555',
})
export const RECOVERY_FINDING_IDS = Object.freeze(
  Array.from({ length: 7 }, (_, index) => `MC-R1-00${index + 1}`),
)
export const RECOVERY_MARKER_START = '<!-- bemoat:review-recovery:v2 -->'
export const RECOVERY_MARKER_END = '<!-- /bemoat:review-recovery:v2 -->'
const LEGACY_RECOVERY_MARKER_START = '<!-- bemoat:review-recovery:v1 -->'

export function isReviewRecoveryIncident({ taskIssue, activePr }: { taskIssue?: unknown; activePr?: unknown } = {}): boolean {
  return String(taskIssue).replace(/^#/, '') === '274' &&
    String(activePr).replace(/^#/, '') === '275'
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const COMMENT_SHA_RE = /^[0-9a-f]{64}$/i
const ROLE_RE = /^##\s+(HANDOFF|RESULT|REVIEW_VERDICT)\s*$/m
const CANONICAL_BINDING_RE =
  /^\*\*PR\s*\/\s*base\s*\/\s*head:\*\*[^\n]*\b(?:https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/|PR\s*#)(\d+)\b[^\n]*`([0-9a-f]{7,40})`/im

function isRecord(value: unknown): value is RuntimeObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function property(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function requiredProperty(value: unknown, key: string): unknown {
  if (value === null || value === undefined) {
    throw new TypeError(`Cannot read properties of ${value === null ? 'null' : 'undefined'} (reading '${key}')`)
  }
  return property(value, key)
}

function sha256(value: unknown): string {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    )
  }
  return value
}

export function stableRecoverySerialize(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function normalizedSourceEvidence(entries: unknown[]): RecoverySourceEvidence[] {
  return entries.map((entry) => ({
    location: String(requiredProperty(entry, 'location')),
    comment_id: Number(requiredProperty(entry, 'comment_id')),
    classification: String(requiredProperty(entry, 'classification')),
    body_sha256: String(requiredProperty(entry, 'body_sha256')).toLowerCase(),
  }))
}

function validateSourceEvidence(record: RecoveryRecord, errors: string[]): void {
  const sourceEvidence = record.source_evidence
  if (!Array.isArray(sourceEvidence) || sourceEvidence.length !== 2) {
    errors.push('source_evidence must contain exactly the Task Issue and PR conversation records')
    return
  }

  const byLocation = new Map<unknown, RuntimeObject>()
  for (const entry of sourceEvidence) {
    if (!isRecord(entry)) {
      errors.push('source_evidence entries must be mappings')
      continue
    }
    const location = entry.location
    if (!['issue:274', 'pull:275'].includes(String(location))) {
      errors.push(`unsupported source_evidence location: ${String(location)}`)
    }
    if (!/^[1-9]\d*$/.test(String(entry.comment_id ?? ''))) {
      errors.push('source_evidence comment_id must be a positive immutable comment ID')
    }
    if (!COMMENT_SHA_RE.test(String(entry.body_sha256 ?? ''))) {
      errors.push('source_evidence body_sha256 must be a full SHA-256')
    }
    if (!['noncanonical_malformed', 'noncanonical_duplicate'].includes(String(entry.classification))) {
      errors.push(`unsupported source_evidence classification: ${String(entry.classification)}`)
    }
    if (byLocation.has(location)) errors.push(`duplicate source_evidence location: ${String(location)}`)
    byLocation.set(location, entry)
  }

  if (String(byLocation.get('issue:274')?.comment_id) !== RECOVERY_SOURCE_COMMENT_IDS.taskIssue) {
    errors.push(`Task Issue source comment must be ${RECOVERY_SOURCE_COMMENT_IDS.taskIssue}`)
  }
  if (String(byLocation.get('pull:275')?.comment_id) !== RECOVERY_SOURCE_COMMENT_IDS.prConversation) {
    errors.push(`PR conversation source comment must be ${RECOVERY_SOURCE_COMMENT_IDS.prConversation}`)
  }
  if (
    byLocation.get('issue:274')?.body_sha256 &&
    byLocation.get('pull:275')?.body_sha256 &&
    byLocation.get('issue:274')?.body_sha256 !== byLocation.get('pull:275')?.body_sha256
  ) {
    errors.push('source comments must be byte-equivalent')
  }
}

function validateFindingIds(record: RecoveryRecord, errors: string[]): void {
  const findings = record.resolved_findings
  if (!Array.isArray(findings) || findings.length !== RECOVERY_FINDING_IDS.length) {
    errors.push('findings must contain exactly the seven immutable MC-R1 finding IDs')
    return
  }
  if (JSON.stringify([...findings].map(String)) !== JSON.stringify([...RECOVERY_FINDING_IDS])) {
    errors.push('findings must preserve MC-R1-001 through MC-R1-007 in order')
  }
}

export function validateRecoveryRecord(record: unknown = {}): ValidationResult {
  const errors: string[] = []
  if (!isRecord(record)) return { ok: false, errors: ['recovery record must be a mapping'] }
  if (record.schema_version !== RECOVERY_SCHEMA_VERSION) errors.push('schema_version must be 2')
  if (record.record_kind !== RECOVERY_RECORD_KIND) errors.push('record_kind must be review_recovery')
  if (record.repository !== 'boat1994/bemoat-web-starter') errors.push('repository must be boat1994/bemoat-web-starter')
  if (record.task_issue !== 274) errors.push('task_issue must be 274')
  if (record.pr !== 275) errors.push('pr must be 275')
  if (record.base !== 'main') errors.push('base must be main')
  if (!FULL_SHA_RE.test(String(record.exact_head ?? ''))) errors.push('exact_head must be a full SHA')
  if (!FULL_SHA_RE.test(String(record.prior_last_reviewed_head ?? ''))) errors.push('prior_last_reviewed_head must be a full SHA')
  if (record.review_type !== 'delta') errors.push('review_type must be delta')
  if (record.verdict !== 'ELIGIBLE FOR FOUNDER REVIEW') errors.push('verdict must be ELIGIBLE FOR FOUNDER REVIEW')
  if (record.expected_prior_state !== 'AWAITING_REVIEW_2') errors.push('expected_prior_state must be AWAITING_REVIEW_2')
  const priorCounters = record.expected_prior_counters
  if (property(priorCounters, 'review_cycle') !== 1 || property(priorCounters, 'full_review_count') !== 1) errors.push('prior counters must be exactly 1/1')
  const resultingCounters = record.resulting_counters
  if (property(resultingCounters, 'review_cycle') !== 2 || property(resultingCounters, 'full_review_count') !== 1) errors.push('resulting counters must be exactly 2/1')
  const lineage = record.lineage
  if (!/^[1-9]\d*$/.test(String(property(lineage, 'original_review_comment_id') ?? ''))) errors.push('lineage.original_review_comment_id must be an immutable comment ID')
  if (!/^[1-9]\d*$/.test(String(property(lineage, 'correction_result_comment_id') ?? ''))) errors.push('lineage.correction_result_comment_id must be an immutable comment ID')
  const reviewer = record.reviewer_identity
  if (!isRecord(reviewer)) errors.push('reviewer_identity must be a mapping')
  else {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(String(reviewer.login ?? ''))) errors.push('reviewer_identity.login must be an authenticated GitHub login')
    if (String(reviewer.github_database_id) !== '36528988') errors.push('reviewer_identity.github_database_id must bind boat1994')
    if (reviewer.author_association !== 'OWNER') errors.push('reviewer_identity.author_association must be OWNER')
    if (reviewer.trust_source !== 'repository-owned reviewer trust policy') errors.push('reviewer_identity.trust_source must name the repository-owned reviewer trust policy')
  }
  if (Object.hasOwn(record, 'protected_base_sha')) errors.push('protected_base_sha is an ambiguous legacy recovery binding')
  const shaFields: Array<[keyof RecoveryRecord, string]> = [
    ['incident_base_sha', 'incident_base_sha must be a full SHA'],
    ['execution_policy_sha', 'execution_policy_sha must be a full SHA'],
    ['policy_source_sha', 'policy_source_sha must be a full SHA'],
  ]
  for (const [key, message] of shaFields) if (!FULL_SHA_RE.test(String(record[key] ?? ''))) errors.push(message)
  const ci = record.ci
  if (!Array.isArray(ci) || ci.length < 2) errors.push('ci must include ci and starter-ci')
  else for (const required of ['ci', 'starter-ci']) {
    const check = ci.find((entry) => property(entry, 'name') === required)
    if (!check || property(check, 'conclusion') !== 'success' || !/^[1-9]\d*$/.test(String(property(check, 'check_run_id') ?? '')) || property(check, 'head_sha') !== record.exact_head) {
      errors.push(`${required} must be a successful exact-head check with a check_run_id`)
    }
  }
  validateFindingIds(record, errors)
  validateSourceEvidence(record, errors)
  const identity = record.transition_identity_sha256
  if (typeof identity !== 'string' || !COMMENT_SHA_RE.test(identity)) errors.push('transition_identity_sha256 must be a full SHA-256')
  else {
    const withoutIdentity = { ...record }
    delete withoutIdentity.transition_identity_sha256
    if (sha256(stableRecoverySerialize(withoutIdentity)) !== identity) errors.push('transition_identity_sha256 does not match canonical recovery evidence')
  }
  if (errors.length === 0) {
    try {
      return { ok: true, record: RecoveryRecordSchema.parse(record) }
    } catch {
      errors.push('recovery record validation failed against schema')
    }
  }
  return { ok: false, errors }
}

export function buildRecoveryRecord(input: RecoveryInput = {}): RecoveryRecord {
  const provided = { ...input }
  if (Object.hasOwn(provided, 'protected_base_sha')) throw new Error('STATE_CONFLICT: protected_base_sha is an ambiguous legacy recovery binding')
  delete provided.transition_identity_sha256
  delete provided.schema_version
  delete provided.record_kind
  const sourceEvidence = provided.source_evidence
  const exactHeadChecks = provided.exact_head_checks
  const record: Record<string, unknown> = {
    schema_version: RECOVERY_SCHEMA_VERSION, record_kind: RECOVERY_RECORD_KIND,
    repository: 'boat1994/bemoat-web-starter', task_issue: 274, pr: 275, base: 'main',
    exact_head: provided.exact_head, review_type: 'delta', verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
    expected_prior_state: 'AWAITING_REVIEW_2', expected_prior_counters: { review_cycle: 1, full_review_count: 1 },
    resulting_counters: { review_cycle: 2, full_review_count: 1 },
    prior_last_reviewed_head: provided.prior_last_reviewed_head ?? provided.previous_reviewed_head,
    resolved_findings: Array.isArray(provided.resolved_findings) ? [...provided.resolved_findings] : [...(provided.findings as Iterable<unknown> ?? [])],
    reviewer_identity: provided.reviewer_identity ?? { login: provided.reviewer_login, github_database_id: 36528988, author_association: 'OWNER', trust_source: 'repository-owned reviewer trust policy' },
    source_evidence: Array.isArray(sourceEvidence) ? normalizedSourceEvidence(sourceEvidence) : sourceEvidence,
    lineage: provided.lineage ?? { original_review_comment_id: provided.original_review_comment_id, correction_result_comment_id: provided.correction_result_comment_id },
    ci: Array.isArray(provided.ci)
      ? provided.ci.map((check) => isRecord(check) ? { ...check } : {})
      : Array.isArray(exactHeadChecks)
        ? exactHeadChecks.map((check) => {
          const name = requiredProperty(check, 'name')
          return {
            name: name === 'CI' ? 'ci' : name === 'CI (starter strict)' ? 'starter-ci' : name,
            check_run_id: Number(requiredProperty(check, 'check_run_id') ?? requiredProperty(check, 'run_id') ?? requiredProperty(check, 'id')),
            conclusion: String(requiredProperty(check, 'conclusion') ?? '').toLowerCase(),
            head_sha: requiredProperty(check, 'head_sha') ?? provided.exact_head,
          }
        })
        : provided.ci,
    incident_base_sha: String(provided.incident_base_sha ?? '').toLowerCase(), execution_policy_sha: String(provided.execution_policy_sha ?? '').toLowerCase(), policy_source_sha: String(provided.policy_source_sha ?? '').toLowerCase(),
  }
  const preliminary = validateRecoveryRecord({ ...record, transition_identity_sha256: sha256(stableRecoverySerialize(record)) })
  if (preliminary.ok === false) throw new Error(`STATE_CONFLICT: ${preliminary.errors.join('; ')}`)
  return { ...record, transition_identity_sha256: sha256(stableRecoverySerialize(record)) }
}

export function renderRecoveryReceipt(record: RecoveryRecord): string {
  const validation = validateRecoveryRecord(record)
  if (validation.ok === false) throw new Error(`STATE_CONFLICT: ${validation.errors.join('; ')}`)
  return [RECOVERY_MARKER_START, '```json', stableRecoverySerialize(record), '```', RECOVERY_MARKER_END].join('\n')
}

export function parseRecoveryReceipt(body: string = ''): ParseResult {
  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const markerStart = escapeRegExp(RECOVERY_MARKER_START)
  const markerEnd = escapeRegExp(RECOVERY_MARKER_END)
  const starts = body.match(new RegExp(markerStart, 'g')) ?? []
  const ends = body.match(new RegExp(markerEnd, 'g')) ?? []
  if (starts.length !== 1 || ends.length !== 1) return { ok: false, errors: ['exactly one recovery receipt marker pair is required'] }
  const match = body.match(new RegExp(`${markerStart}\\s*` + '```json\\s*\\n([\\s\\S]*?)\\n```\\s*' + markerEnd))
  if (!match) return { ok: false, errors: ['recovery receipt must contain one JSON fence'] }
  try {
    const record: unknown = JSON.parse(match[1])
    const validation = validateRecoveryRecord(record)
    if (validation.ok) return { ok: true, record: validation.record }
    if ('errors' in validation) return { ok: false, errors: validation.errors }
    return { ok: false, errors: ['recovery receipt validation failed'] }
  } catch { return { ok: false, errors: ['recovery receipt JSON is invalid'] } }
}

export function parseOrdinaryReviewEvidence(body: string = ''): { role: string | null; canonical: boolean; pr: string | null; head: string | null } {
  const role = body.match(ROLE_RE)?.[1] ?? null
  if (role !== 'REVIEW_VERDICT') return { role, canonical: false, pr: null, head: null }
  const binding = body.match(CANONICAL_BINDING_RE)
  return { role, canonical: Boolean(binding), pr: binding?.[1] ?? null, head: binding?.[2] ?? null }
}

function commentId(comment: ReviewEvidenceComment | null | undefined): string {
  return String(comment?.id ?? comment?.databaseId ?? '')
}
function isAfterState(comment: ReviewEvidenceComment | null | undefined, state: RuntimeObject | null | undefined): boolean {
  const commentTime = Date.parse(comment?.createdAt ?? comment?.created_at ?? '')
  const stateTime = Date.parse(String(state?.updated_at ?? ''))
  return Number.isNaN(commentTime) || Number.isNaN(stateTime) ? true : commentTime >= stateTime
}
function commentSha(comment: ReviewEvidenceComment | null | undefined): string {
  return sha256(String(comment?.body ?? ''))
}
function isRecoveryReceipt(comment: ReviewEvidenceComment | null | undefined): ParseResult {
  return parseRecoveryReceipt(String(comment?.body ?? ''))
}
function sourceMatchesReceipt(source: unknown, comment: ReviewEvidenceComment | null | undefined, location: string): boolean {
  return property(source, 'location') === location && String(property(source, 'comment_id')) === commentId(comment) && String(property(source, 'body_sha256')).toLowerCase() === commentSha(comment)
}

export function detectUnaccountedReviewEvidence({
  repository = 'boat1994/bemoat-web-starter', taskIssue, activePr, managedState = {}, issueComments = [], prComments = [],
}: {
  repository?: string
  taskIssue?: string | number
  activePr?: string | number
  managedState?: RuntimeObject | null
  issueComments?: Array<ReviewEvidenceComment | null | undefined>
  prComments?: Array<ReviewEvidenceComment | null | undefined>
} = {}): RuntimeObject {
  const receipts: Array<{ comment: ReviewEvidenceComment | null | undefined; record: RecoveryRecord }> = []
  for (const comment of issueComments) {
    const parsed = isRecoveryReceipt(comment)
    if (parsed.ok) receipts.push({ comment, record: parsed.record })
    else if (String(comment?.body ?? '').includes(RECOVERY_MARKER_START) || String(comment?.body ?? '').includes(LEGACY_RECOVERY_MARKER_START)) return { ok: false, code: 'STATE_CONFLICT', reason: `invalid recovery receipt on comment ${commentId(comment)}`, recoveryCommand: RECOVERY_COMMAND }
  }
  if (receipts.length > 1) return { ok: false, code: 'STATE_CONFLICT', reason: 'multiple canonical review recovery receipts exist', recoveryCommand: RECOVERY_COMMAND }
  const receipt = receipts[0]?.record ?? null
  const quarantined: string[] = []
  const receiptSources = Array.isArray(receipt?.source_evidence) ? receipt.source_evidence : []
  const unaccounted: RuntimeObject[] = []
  const sourceIssue = issueComments.find((comment) => sourceMatchesReceipt(receiptSources.find((source) => property(source, 'location') === 'issue:274'), comment, 'issue:274'))
  const sourcePr = prComments.find((comment) => sourceMatchesReceipt(receiptSources.find((source) => property(source, 'location') === 'pull:275'), comment, 'pull:275'))
  if (sourceIssue && sourcePr) quarantined.push(commentId(sourceIssue), commentId(sourcePr))
  const commentGroups: Array<[string, Array<ReviewEvidenceComment | null | undefined>]> = [['issue:274', issueComments], ['pull:275', prComments]]
  for (const [location, comments] of commentGroups) {
    for (const comment of comments) {
      const parsed = parseOrdinaryReviewEvidence(String(comment?.body ?? ''))
      if (parsed.role !== 'REVIEW_VERDICT' || isRecoveryReceipt(comment).ok) continue
      const id = commentId(comment)
      const isBoundPointer = location === 'issue:274' && id === String(managedState?.latest_review_verdict_comment_id ?? '')
      const isQuarantined = quarantined.includes(id)
      const activePrMatches = parsed.pr == null || String(parsed.pr) === String(activePr ?? '').replace(/^#/, '')
      const relevant = location === 'pull:275' || (activePrMatches && (isAfterState(comment, managedState) || parsed.canonical === false))
      if (relevant && !isBoundPointer && !isQuarantined) unaccounted.push({ location, comment_id: id, canonical: parsed.canonical, pr: parsed.pr, head: parsed.head })
    }
  }
  if (unaccounted.length > 0) return { ok: false, code: 'NONCANONICAL_ROLE_EVIDENCE', reason: 'relevant REVIEW_VERDICT evidence is not projected or quarantined', unaccounted, recoveryCommand: RECOVERY_COMMAND }
  if (receipt && (receipt.repository !== repository || receipt.task_issue !== Number(taskIssue) || receipt.pr !== Number(activePr))) return { ok: false, code: 'STATE_CONFLICT', reason: 'recovery receipt is not bound to the active repository, Task Issue, and PR', recoveryCommand: RECOVERY_COMMAND }
  return { ok: true, quarantined, recoveryReceipt: receipt }
}
