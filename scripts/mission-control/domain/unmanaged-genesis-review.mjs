import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

import { canonicalSerialize, sha256Hex } from './task-attestation.mjs'

export const UGR_RECORD_SCHEMA = 'bemoat-mission-control-unmanaged-genesis-review'
export const UGR_RECORD_PREFIX = 'mc-ugr-v1-'
export const UGR_MARKER_START = '<!-- bemoat-mission-control-unmanaged-genesis-review:v1 -->'
export const UGR_MARKER_END = '<!-- bemoat-mission-control-unmanaged-genesis-review:end -->'
export const UGR_SIGNING_DOMAIN = 'bemoat-mission-control-unmanaged-genesis-review-v1'

export const UGR_CONTRACT = Object.freeze({
  repository: 'boat1994/bemoat-web-starter',
  taskIssue: 262,
  pullRequest: 266,
  base: 'main',
  historicalFullSourceCommentId: 5167077714,
  historicalFullReviewedHead: '0ad7ec2cddc5dae999afebb9050bdbaaa396f176',
  protectedBaseSha: 'f6ac355b98aa281dda2a49bcf2ddaeb279d8173d',
  policySource: 'docs/mission-control/mission-control-guide.md',
  policyVersion: '1.3.0',
  policySha: 'f46f5de1d5ee17669c7c4663893164ffb835b339',
  policySourceCommit: 'b74027aed2cf2930e15bf4260ac86533cb069604',
  authorizationBundle: 'unmanaged-genesis-review',
  authorizationScope: 'record-existing-semantic-review',
  authorizationAction: 'record-review',
  publicKeyPath: '.bemoat/mission-control/unmanaged-genesis-review-public-key.pem',
  commandName: 'bemoat:mission-control:unmanaged-genesis-review',
})

export const UGR_VERDICTS = Object.freeze([
  'CORRECTION REQUIRED',
  'ELIGIBLE FOR FOUNDER REVIEW',
  'BLOCKED FOR FOUNDER DECISION',
  'BLOCKED EXTERNAL',
  'STATE CONFLICT',
])

function fail(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  error.classification = code
  return error
}

export function stateConflict(message, cause) {
  return fail('STATE_CONFLICT', message, cause)
}

export function blockedExternal(message, cause) {
  return fail('BLOCKED_EXTERNAL', message, cause)
}

function positiveId(value) {
  return /^[1-9]\d*$/.test(String(value ?? ''))
}

function validFullSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
}

function validSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

function normalizeLogin(comment) {
  return comment?.user?.login ?? comment?.author?.login ?? comment?.author_login ?? null
}

function sortFindings(findings) {
  if (!Array.isArray(findings)) return []
  return [...findings].map((finding) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      throw stateConflict('findings entries must be objects')
    }
    return { ...finding }
  }).sort((left, right) => {
    const leftId = String(left.id ?? left.finding_id ?? '')
    const rightId = String(right.id ?? right.finding_id ?? '')
    if (leftId !== rightId) return leftId.localeCompare(rightId)
    return canonicalSerialize(left).localeCompare(canonicalSerialize(right))
  })
}

function sortChecks(checks) {
  if (!Array.isArray(checks)) return []
  return [...checks].map((check) => ({ ...check })).sort((left, right) => {
    const leftName = String(left.name ?? left.context ?? '')
    const rightName = String(right.name ?? right.context ?? '')
    if (leftName !== rightName) return leftName.localeCompare(rightName)
    return String(left.id ?? '').localeCompare(String(right.id ?? ''))
  })
}

function sortDispositions(dispositions) {
  if (!Array.isArray(dispositions)) return []
  return [...dispositions].map((entry) => ({ ...entry })).sort((left, right) => {
    const leftId = String(left.finding_id ?? left.id ?? '')
    const rightId = String(right.finding_id ?? right.id ?? '')
    if (leftId !== rightId) return leftId.localeCompare(rightId)
    return canonicalSerialize(left).localeCompare(canonicalSerialize(right))
  })
}

function sortCommitOids(oids) {
  if (!Array.isArray(oids)) return []
  return [...oids].map(String)
}

/** Semantic payload used for record_id hashing (excludes identity/signature/runtime fields). */
export function semanticRecordPayload(record) {
  const {
    record_id: _recordId,
    signing,
    workflow,
    ...rest
  } = record ?? {}
  return {
    ...rest,
    signing: signing
      ? {
          algorithm: signing.algorithm,
          key_id: signing.key_id,
        }
      : null,
    workflow: workflow
      ? {
          file: workflow.file,
          ref: workflow.ref,
          sha: workflow.sha,
        }
      : null,
  }
}

export function computeRecordId(record) {
  return `${UGR_RECORD_PREFIX}${sha256Hex(canonicalSerialize(semanticRecordPayload(record)))}`
}

function unsignedSigningMaterial(record) {
  const {
    signing,
    ...rest
  } = record
  return {
    domain: UGR_SIGNING_DOMAIN,
    record: {
      ...rest,
      signing: {
        algorithm: signing?.algorithm ?? 'Ed25519',
        key_id: signing?.key_id ?? null,
        signature: null,
      },
    },
  }
}

export function signUnmanagedGenesisReviewRecord(record, { privateKey, keyId } = {}) {
  if (!keyId || typeof keyId !== 'string') throw blockedExternal('signing key ID is required')
  if (!privateKey || typeof privateKey !== 'string') throw blockedExternal('protected signing material is unavailable')
  const withKey = {
    ...record,
    signing: {
      algorithm: 'Ed25519',
      key_id: keyId,
      signature: null,
    },
  }
  const recordId = computeRecordId(withKey)
  const unsigned = {
    ...withKey,
    record_id: recordId,
  }
  const material = canonicalSerialize(unsignedSigningMaterial(unsigned))
  const signature = sign(null, Buffer.from(material, 'utf8'), createPrivateKey(privateKey)).toString('base64')
  return {
    ...unsigned,
    signing: {
      algorithm: 'Ed25519',
      key_id: keyId,
      signature,
    },
  }
}

export function verifyUnmanagedGenesisReviewRecord(record, { publicKey, signingKeyId = null } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'signed unmanaged-genesis review record is missing' }
  }
  if (record.schema_version !== 1 || record.record_schema !== UGR_RECORD_SCHEMA) {
    return { ok: false, reason: 'record schema is invalid' }
  }
  if (record.evidence_class !== 'full' && record.evidence_class !== 'delta') {
    return { ok: false, reason: 'evidence_class must be full or delta' }
  }
  if (!record.signing || record.signing.algorithm !== 'Ed25519' || !record.signing.key_id || !record.signing.signature) {
    return { ok: false, reason: 'signing block is incomplete' }
  }
  if (signingKeyId != null && record.signing.key_id !== signingKeyId) {
    return { ok: false, reason: 'signing key ID does not match protected configuration' }
  }
  if (!publicKey || typeof publicKey !== 'string') {
    return { ok: false, reason: 'committed public verification key is unavailable' }
  }
  if (computeRecordId(record) !== record.record_id) {
    return { ok: false, reason: 'record_id does not match canonical semantic payload' }
  }
  try {
    const material = canonicalSerialize(unsignedSigningMaterial({
      ...record,
      signing: {
        algorithm: record.signing.algorithm,
        key_id: record.signing.key_id,
        signature: null,
      },
    }))
    if (!verify(null, Buffer.from(material, 'utf8'), createPublicKey(publicKey), Buffer.from(record.signing.signature, 'base64'))) {
      return { ok: false, reason: 'record signature is invalid' }
    }
  } catch (error) {
    return { ok: false, reason: `record signature could not be verified: ${error.message}` }
  }
  return { ok: true, reason: null, record }
}

export function renderUnmanagedGenesisReviewComment({ verdict, record, findingsSummary = null } = {}) {
  if (!UGR_VERDICTS.includes(verdict)) throw stateConflict(`unsupported verdict ${verdict}`)
  const lines = [
    '## REVIEW_VERDICT',
    '',
    verdict,
    '',
    '### Task log',
    '- Role: Independent Reviewer (unmanaged-genesis trusted transport)',
    `- Evidence class: \`${record.evidence_class}\``,
    `- Record ID: \`${record.record_id}\``,
    `- PR: #${record.pull_request.number}`,
    `- Base: \`${record.pull_request.base_ref}\``,
    `- Exact head: \`${record.reviewed_head}\``,
    `- Founder authorization comment: \`${record.founder_authorization.comment_id}\``,
    `- Source review comment: \`${record.source_review.comment_id}\``,
    '',
    '### Findings',
    findingsSummary ?? '- See signed record findings array.',
    '',
    UGR_MARKER_START,
    '```json',
    JSON.stringify(record, null, 2),
    '```',
    UGR_MARKER_END,
    '',
  ]
  return lines.join('\n')
}

export function parseUnmanagedGenesisReviewComment(body = '') {
  const text = String(body ?? '')
  if (!text.includes(UGR_MARKER_START) || !text.includes(UGR_MARKER_END)) {
    return { ok: false, reason: 'signed unmanaged-genesis review markers are missing', record: null, verdict: null }
  }
  const starts = [...text.matchAll(new RegExp(escapeRegExp(UGR_MARKER_START), 'g'))]
  const ends = [...text.matchAll(new RegExp(escapeRegExp(UGR_MARKER_END), 'g'))]
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    return { ok: false, reason: 'exactly one balanced signed-record marker pair is required', record: null, verdict: null }
  }
  const raw = text.slice(starts[0].index + UGR_MARKER_START.length, ends[0].index)
    .replace(/```json\s*|```/g, '')
    .trim()
  let record
  try {
    record = JSON.parse(raw)
  } catch (error) {
    return { ok: false, reason: `signed record is not valid JSON: ${error.message}`, record: null, verdict: null }
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'signed record must be one JSON object', record: null, verdict: null }
  }
  const verdictMatch = text.match(/^## REVIEW_VERDICT\s*\n+([A-Z][A-Z _]+)\s*$/m)
  const verdict = verdictMatch?.[1]?.trim() ?? null
  return { ok: true, reason: null, record, verdict }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Evidence-only historical Review 1 occurrence; never merge authority by itself. */
export function parseHistoricalReviewOccurrence(body = '') {
  const text = String(body ?? '')
  if (!text.startsWith('## REVIEW_VERDICT')) {
    throw stateConflict('source review comment is not a REVIEW_VERDICT')
  }
  const verdictMatch = text.match(/^## REVIEW_VERDICT\s*\n+([A-Z][A-Z _]+)\s*$/m)
  const verdict = verdictMatch?.[1]?.trim() ?? null
  if (!UGR_VERDICTS.includes(verdict)) throw stateConflict('source review verdict is unsupported')
  const pr = Number(text.match(/\*\*PR\*\*:\s*#(\d+)/)?.[1] ?? NaN)
  const base = text.match(/\*\*Base\*\*:\s*`([^`]+)`/)?.[1] ?? null
  const head = text.match(/\*\*Exact Head\*\*:\s*`([0-9a-f]{40})`/i)?.[1] ?? null
  const criticalImportant = /Critical or Important findings:\s*None/i.test(text) ||
    /There are no Critical or Important findings/i.test(text)
  return {
    verdict,
    pullRequest: pr,
    base,
    reviewedHead: head,
    unresolvedCriticalOrImportant: !criticalImportant,
    evidenceOnly: true,
    hasSignedRecord: text.includes(UGR_MARKER_START),
  }
}

export function parseFounderUnmanagedGenesisAuthorization(body = '') {
  if (typeof body !== 'string' || !body.trim() || body.trim().startsWith('```')) {
    throw stateConflict('Founder authorization comment must contain exactly one raw JSON object')
  }
  let authorization
  try {
    authorization = JSON.parse(body.trim())
  } catch {
    throw stateConflict('Founder authorization comment body is not valid JSON')
  }
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw stateConflict('Founder authorization comment body must decode to one JSON object')
  }
  return authorization
}

export function createFounderUnmanagedGenesisAuthorizationBody({
  evidenceClass = 'full',
  repository = UGR_CONTRACT.repository,
  taskIssue = UGR_CONTRACT.taskIssue,
  pullRequest = UGR_CONTRACT.pullRequest,
  base = UGR_CONTRACT.base,
  reviewedHead = UGR_CONTRACT.historicalFullReviewedHead,
  sourceReviewCommentId = UGR_CONTRACT.historicalFullSourceCommentId,
  protectedBaseSha = UGR_CONTRACT.protectedBaseSha,
  policySource = UGR_CONTRACT.policySource,
  policyVersion = UGR_CONTRACT.policyVersion,
  policySha = UGR_CONTRACT.policySha,
  authorLogin = 'boat1994',
  commentId = null,
  priorFullRecordCommentId = null,
  priorFullRecordId = null,
  correctionBase = null,
  correctionHead = null,
  correctionCommitOids = null,
  correctionDiffSha256 = null,
  correctionResultCommentId = null,
  predecessorDeltaRecordId = null,
  correctionOfRecordId = null,
  findingDisposition = null,
  findings = [],
} = {}) {
  const record = {
    schema_version: 1,
    status: 'approved',
    authority: 'Founder',
    author_login: authorLogin,
    comment_id: commentId == null ? '<immutable-comment-id>' : String(commentId),
    immutable_comment_reference: true,
    non_superseded: true,
    superseded_by: null,
    repository,
    bundle_kind: UGR_CONTRACT.authorizationBundle,
    scope: UGR_CONTRACT.authorizationScope,
    action: UGR_CONTRACT.authorizationAction,
    evidence_class: evidenceClass,
    task_issue: Number(taskIssue),
    pr: Number(pullRequest),
    base,
    reviewed_head: reviewedHead,
    source_review_comment_id: Number(sourceReviewCommentId),
    protected_base_sha: protectedBaseSha,
    policy_source: policySource,
    policy_version: policyVersion,
    policy_source_sha: policySha,
    findings: sortFindings(findings),
  }
  if (evidenceClass === 'delta') {
    record.prior_full_record_comment_id = priorFullRecordCommentId == null ? null : Number(priorFullRecordCommentId)
    record.prior_full_record_id = priorFullRecordId
    record.correction_base = correctionBase
    record.correction_head = correctionHead
    record.correction_commit_oids = sortCommitOids(correctionCommitOids ?? [])
    record.correction_diff_sha256 = correctionDiffSha256
    record.correction_result_comment_id = correctionResultCommentId == null ? null : Number(correctionResultCommentId)
    record.predecessor_delta_record_id = predecessorDeltaRecordId
    record.correction_of_record_id = correctionOfRecordId
    record.finding_disposition = sortDispositions(findingDisposition ?? [])
  }
  record.comment_sha256 = sha256Hex(canonicalSerialize({ ...record, comment_sha256: null }))
  return JSON.stringify(record, null, 2)
}

function supersedesComment(comment, targetId) {
  let candidate
  try { candidate = parseFounderUnmanagedGenesisAuthorization(comment?.body ?? '') } catch { return false }
  const ids = [
    candidate.supersedes_comment_id,
    ...(Array.isArray(candidate.supersedes_comment_ids) ? candidate.supersedes_comment_ids : []),
  ].filter((id) => id != null).map(String)
  return ids.includes(String(targetId))
}

export function validateFounderUnmanagedGenesisAuthorization({
  authorization,
  authorizationComment,
  repository,
  founderLogins,
  issueComments = [],
} = {}) {
  if (!authorization || typeof authorization !== 'object') throw stateConflict('Founder authorization is missing')
  if (authorization.schema_version !== 1) throw stateConflict('Founder authorization schema_version must be 1')
  if (authorization.status !== 'approved') throw stateConflict('Founder authorization status must be approved')
  if (authorization.authority !== 'Founder') throw stateConflict('Founder authorization authority must be Founder')
  if (authorization.bundle_kind !== UGR_CONTRACT.authorizationBundle) throw stateConflict('Founder authorization bundle_kind is invalid')
  if (authorization.scope !== UGR_CONTRACT.authorizationScope) throw stateConflict('Founder authorization scope is invalid')
  if (authorization.action !== UGR_CONTRACT.authorizationAction) throw stateConflict('Founder authorization action is invalid')
  if (authorization.evidence_class !== 'full' && authorization.evidence_class !== 'delta') {
    throw stateConflict('Founder authorization evidence_class must be full or delta')
  }
  if (authorization.repository !== repository) throw stateConflict('Founder authorization repository binding mismatches')
  if (Number(authorization.task_issue) !== UGR_CONTRACT.taskIssue) throw stateConflict('Founder authorization task_issue must be #262')
  if (Number(authorization.pr) !== UGR_CONTRACT.pullRequest) throw stateConflict('Founder authorization pr must be #266')
  if (authorization.base !== UGR_CONTRACT.base) throw stateConflict('Founder authorization base must be main')
  if (!validFullSha(authorization.reviewed_head)) throw stateConflict('Founder authorization reviewed_head is invalid')
  if (!positiveId(authorization.source_review_comment_id)) throw stateConflict('Founder authorization source_review_comment_id is required')
  if (authorization.protected_base_sha !== UGR_CONTRACT.protectedBaseSha) throw stateConflict('Founder authorization protected_base_sha mismatches')
  if (authorization.policy_source !== UGR_CONTRACT.policySource || authorization.policy_version !== UGR_CONTRACT.policyVersion || authorization.policy_source_sha !== UGR_CONTRACT.policySha) {
    throw stateConflict('Founder authorization policy tuple mismatches')
  }
  if (authorization.immutable_comment_reference !== true || authorization.non_superseded !== true || authorization.superseded_by != null) {
    throw stateConflict('Founder authorization must be immutable and non-superseded')
  }
  const author = normalizeLogin(authorizationComment)
  if (!author || !Array.isArray(founderLogins) || !founderLogins.map(String).includes(String(author))) {
    throw stateConflict('Founder authorization author is not a trusted Founder login')
  }
  if (authorization.author_login && authorization.author_login !== author) {
    throw stateConflict('Founder authorization author_login does not match the live comment author')
  }
  if (!authorizationComment || !positiveId(authorizationComment.id)) throw stateConflict('Founder authorization comment identity is missing')
  if (authorizationComment.created_at && authorizationComment.updated_at && authorizationComment.created_at !== authorizationComment.updated_at) {
    throw stateConflict('Founder authorization comment was edited')
  }
  if (issueComments.some((comment) => supersedesComment(comment, authorizationComment.id))) {
    throw stateConflict('Founder authorization comment has been superseded')
  }
  if (authorization.evidence_class === 'delta') {
    if (!positiveId(authorization.prior_full_record_comment_id)) throw stateConflict('delta authorization requires prior_full_record_comment_id')
    if (typeof authorization.prior_full_record_id !== 'string' || !authorization.prior_full_record_id.startsWith(UGR_RECORD_PREFIX)) {
      throw stateConflict('delta authorization requires prior_full_record_id')
    }
    if (!validFullSha(authorization.correction_base) || !validFullSha(authorization.correction_head)) {
      throw stateConflict('delta authorization requires correction_base and correction_head')
    }
    if (authorization.correction_head !== authorization.reviewed_head) {
      throw stateConflict('delta authorization correction_head must equal reviewed_head')
    }
    if (!validSha256(authorization.correction_diff_sha256)) throw stateConflict('delta authorization requires correction_diff_sha256')
    if (!Array.isArray(authorization.correction_commit_oids)) throw stateConflict('delta authorization requires correction_commit_oids')
    if (!Array.isArray(authorization.finding_disposition)) throw stateConflict('delta authorization requires finding_disposition')
  }
  return {
    evidenceClass: authorization.evidence_class,
    authorLogin: author,
    commentId: Number(authorizationComment.id),
    bodySha256: sha256Hex(String(authorizationComment.body ?? '')),
    authorization,
  }
}

export function buildUnmanagedGenesisReviewRecord({
  evidenceClass,
  repository,
  taskIssue,
  pullRequest,
  founderAuthorization,
  sourceReview,
  reviewedHead,
  exactHeadCi,
  findings = [],
  full = null,
  delta = null,
  workflow,
  signingKeyId,
}) {
  if (evidenceClass !== 'full' && evidenceClass !== 'delta') throw stateConflict('evidence_class must be full or delta')
  const record = {
    schema_version: 1,
    record_schema: UGR_RECORD_SCHEMA,
    evidence_class: evidenceClass,
    record_id: null,
    repository: {
      name_with_owner: repository.nameWithOwner ?? repository.name_with_owner,
      id: String(repository.id),
      node_id: String(repository.node_id),
    },
    task_issue: {
      number: Number(taskIssue.number),
      id: String(taskIssue.id),
      node_id: String(taskIssue.node_id),
    },
    pull_request: {
      number: Number(pullRequest.number),
      id: String(pullRequest.id),
      node_id: String(pullRequest.node_id),
      base_ref: String(pullRequest.baseRefName ?? pullRequest.base_ref),
      review_base_sha: String(pullRequest.baseRefOid ?? pullRequest.review_base_sha ?? ''),
    },
    founder_authorization: {
      comment_id: Number(founderAuthorization.commentId),
      comment_body_sha256: founderAuthorization.bodySha256,
      author_login: founderAuthorization.authorLogin,
    },
    source_review: {
      comment_id: Number(sourceReview.commentId),
      comment_body_sha256: sourceReview.bodySha256,
      author_login: sourceReview.authorLogin,
      verdict: sourceReview.verdict,
    },
    reviewed_head: reviewedHead,
    exact_head_ci: {
      head: exactHeadCi.head,
      checks: sortChecks(exactHeadCi.checks ?? []),
    },
    findings: sortFindings(findings),
    full: evidenceClass === 'full' ? full : null,
    delta: evidenceClass === 'delta' ? {
      ...delta,
      correction_commit_oids: sortCommitOids(delta?.correction_commit_oids ?? []),
      finding_disposition: sortDispositions(delta?.finding_disposition ?? []),
    } : null,
    workflow: {
      file: workflow?.file ?? null,
      ref: workflow?.ref ?? null,
      sha: workflow?.sha ?? null,
      run_id: workflow?.runId != null ? String(workflow.runId) : null,
    },
    signing: {
      algorithm: 'Ed25519',
      key_id: signingKeyId,
      signature: null,
    },
  }
  if (evidenceClass === 'full') {
    if (!full || !validFullSha(full.reviewed_old_head) || !validSha256(full.findings_sha256)) {
      throw stateConflict('full record requires reviewed_old_head and findings_sha256')
    }
  } else if (!delta || !delta.prior_full_record_id || !positiveId(delta.prior_full_record_comment_id) || !validSha256(delta.prior_full_record_sha256)) {
    throw stateConflict('delta record requires prior Full binding fields')
  }
  return record
}

/**
 * Merge eligibility for unmanaged-genesis topology.
 * Full alone is insufficient. Delta alone is insufficient.
 */
export function evaluateUnmanagedGenesisMergeEligibility({
  records = [],
  livePullRequestHead,
} = {}) {
  const fullRecords = records.filter((entry) => entry.record?.evidence_class === 'full' && entry.verified)
  const deltaRecords = records.filter((entry) => entry.record?.evidence_class === 'delta' && entry.verified)

  if (fullRecords.length === 0) {
    return { eligible: false, reason: 'no valid signed Full root exists', classification: 'STATE_CONFLICT' }
  }
  if (fullRecords.length > 1) {
    const ids = new Set(fullRecords.map((entry) => entry.record.record_id))
    if (ids.size > 1) {
      return { eligible: false, reason: 'competing valid Full roots exist', classification: 'STATE_CONFLICT' }
    }
  }

  const full = fullRecords[0].record
  if (full.reviewed_head !== UGR_CONTRACT.historicalFullReviewedHead) {
    return { eligible: false, reason: 'Full root is not bound to the approved historical head', classification: 'STATE_CONFLICT' }
  }

  const rootedDeltas = deltaRecords.filter((entry) => entry.record.delta?.prior_full_record_id === full.record_id)
  if (rootedDeltas.length === 0) {
    return { eligible: false, reason: 'Full evidence alone cannot authorize the corrected head', classification: 'STATE_CONFLICT' }
  }

  const tips = rootedDeltas.filter((entry) => {
    const later = rootedDeltas.some((candidate) => candidate.record.delta?.predecessor_delta_record_id === entry.record.record_id)
    return !later
  })
  if (tips.length !== 1) {
    return { eligible: false, reason: 'Delta chain is forked or ambiguous', classification: 'STATE_CONFLICT' }
  }

  const tip = tips[0].record
  if (tip.reviewed_head !== livePullRequestHead) {
    return { eligible: false, reason: 'head drift: Delta tip does not bind the live PR head', classification: 'STATE_CONFLICT' }
  }
  if (tip.exact_head_ci?.head !== livePullRequestHead) {
    return { eligible: false, reason: 'Delta exact-head CI does not bind the live PR head', classification: 'STATE_CONFLICT' }
  }
  if (tip.source_review?.verdict !== 'ELIGIBLE FOR FOUNDER REVIEW') {
    return { eligible: false, reason: 'Delta tip verdict is not ELIGIBLE FOR FOUNDER REVIEW', classification: 'STATE_CONFLICT' }
  }
  const unresolved = (tip.delta?.finding_disposition ?? []).some((entry) => {
    const status = String(entry.status ?? entry.disposition ?? '').toUpperCase()
    return status === 'UNRESOLVED' || status === 'OPEN' || status === 'BLOCKING'
  })
  if (unresolved) {
    return { eligible: false, reason: 'Delta tip still has unresolved Critical/Important findings', classification: 'STATE_CONFLICT' }
  }

  return {
    eligible: true,
    reason: null,
    classification: null,
    fullRecordId: full.record_id,
    deltaRecordId: tip.record_id,
    reviewedHead: tip.reviewed_head,
    next: 'ELIGIBLE FOR FOUNDER REVIEW',
  }
}

export function assertUnmanagedTopology({ issue, pullRequest, repositoryName }) {
  if (repositoryName !== UGR_CONTRACT.repository) {
    throw blockedExternal('unmanaged-genesis review transport is not enabled for child repositories')
  }
  if (Number(issue?.number) !== UGR_CONTRACT.taskIssue || String(issue?.state ?? '').toUpperCase() !== 'OPEN') {
    throw stateConflict('Issue #262 must remain open for unmanaged-genesis review')
  }
  if (/bemoat-mission-control-state/i.test(String(issue?.body ?? ''))) {
    throw stateConflict('Issue #262 must remain unmanaged; managed-state block is prohibited')
  }
  if (/\breview_cycle\b/.test(String(issue?.body ?? '')) || /\bfull_review_count\b/.test(String(issue?.body ?? ''))) {
    throw stateConflict('Issue #262 must not gain review_cycle or full_review_count')
  }
  if (Number(pullRequest?.number) !== UGR_CONTRACT.pullRequest) {
    throw stateConflict('unmanaged-genesis review may target only PR #266')
  }
  if (String(pullRequest?.state ?? '').toUpperCase() !== 'OPEN' || pullRequest?.isDraft !== true) {
    throw stateConflict('PR #266 must remain Draft/Open')
  }
  if (pullRequest?.baseRefName !== UGR_CONTRACT.base) {
    throw stateConflict('PR #266 base must be main')
  }
}

export function collectVerifiedRecords(comments, { publicKey, signingKeyId = null } = {}) {
  const records = []
  for (const comment of comments ?? []) {
    const parsed = parseUnmanagedGenesisReviewComment(comment?.body ?? '')
    if (!parsed.ok) continue
    const verified = verifyUnmanagedGenesisReviewRecord(parsed.record, { publicKey, signingKeyId })
    if (!verified.ok) {
      throw stateConflict(`competing or invalid signed unmanaged-genesis record on comment ${comment.id}: ${verified.reason}`)
    }
    records.push({
      commentId: Number(comment.id),
      bodySha256: sha256Hex(String(comment.body ?? '')),
      verified: true,
      record: verified.record,
      verdict: parsed.verdict,
    })
  }

  const byId = new Map()
  for (const entry of records) {
    const existing = byId.get(entry.record.record_id)
    if (existing && canonicalSerialize(existing.record) !== canonicalSerialize(entry.record)) {
      throw stateConflict(`same record_id with different payloads: ${entry.record.record_id}`)
    }
    byId.set(entry.record.record_id, entry)
  }
  return [...byId.values()]
}
