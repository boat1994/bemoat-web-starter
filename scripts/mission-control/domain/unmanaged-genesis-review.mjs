import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

import { canonicalSerialize, sha256Hex } from './task-attestation.mjs'

export const UGR_RECORD_SCHEMA = 'bemoat-mission-control-unmanaged-genesis-review'
export const UGR_RECORD_PREFIX = 'mc-ugr-v1-'
export const UGR_MARKER_START = '<!-- bemoat-mission-control-unmanaged-genesis-review:v1 -->'
export const UGR_MARKER_END = '<!-- bemoat-mission-control-unmanaged-genesis-review:end -->'
export const UGR_SIGNING_DOMAIN = 'bemoat-mission-control-unmanaged-genesis-review-v1'
export const UGR_AUTHORIZATION_SCHEMA = 'bemoat-mission-control-unmanaged-genesis-review-authorization'
export const UGR_AUTHORIZATION_PREFIX = 'mc-ugr-auth-v2-'
export const UGR_LIFECYCLE_ID = 'mc-ugr-262-266-v2'

export const UGR_CONTRACT = Object.freeze({
  repository: 'boat1994/bemoat-web-starter',
  taskIssue: 262,
  pullRequest: 266,
  base: 'main',
  branch: 'feature/262-task-bootstrap',
  historicalFullSourceCommentId: 5167077714,
  historicalFullReviewedHead: '0ad7ec2cddc5dae999afebb9050bdbaaa396f176',
  historicalFullSourceBodySha256: '962f6058775c59fd52489557b37171a3461a2a42e9210f744a6c1fad0b2fdaff',
  legacyDeltaEvidenceCommentId: 5168547881,
  legacyDeltaEvidenceBodySha256: 'bd3bc32c138b0aa3b6e8a7602d81ec9fd2bce51398790458343a43482c768328',
  legacyDeltaEvidenceBase: '0ad7ec2cddc5dae999afebb9050bdbaaa396f176',
  legacyDeltaEvidenceHead: '50879fe28e0293ef4c1f93edcb1f378e9ee8f7e6',
  protectedBaseSha: 'f6ac355b98aa281dda2a49bcf2ddaeb279d8173d',
  observedHead: '50879fe28e0293ef4c1f93edcb1f378e9ee8f7e6',
  policySource: 'docs/mission-control/mission-control-guide.md',
  policyVersion: '1.3.0',
  policySha: 'f46f5de1d5ee17669c7c4663893164ffb835b339',
  policySourceCommit: 'b74027aed2cf2930e15bf4260ac86533cb069604',
  authorizationBundle: 'unmanaged-genesis-review-recording',
  authorizationScope: 'record-existing-semantic-review',
  authorizationActionFull: 'record-full',
  authorizationActionDelta: 'record-delta',
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base
  const output = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value)
    } else {
      output[key] = value
    }
  }
  return output
}

function normalizeRecordClass(recordClass, evidenceClass) {
  const candidate = recordClass ?? (evidenceClass === 'delta' ? 'DELTA_RECORDING' : 'FULL_RECORDING')
  if (candidate !== 'FULL_RECORDING' && candidate !== 'DELTA_RECORDING') {
    throw stateConflict('record_class must be FULL_RECORDING or DELTA_RECORDING')
  }
  return candidate
}

function evidenceClassForRecordClass(recordClass) {
  return recordClass === 'FULL_RECORDING' ? 'full' : 'delta'
}

function requiredCheckNames(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw stateConflict(`${label} must be a non-empty array`)
  const names = value.map((entry) => String(entry).toLowerCase())
  for (const required of ['ci', 'starter-ci']) {
    if (!names.includes(required)) throw stateConflict(`${label} must include ${required}`)
  }
  return names
}

function actualAppSlug(comment) {
  return comment?.performed_via_github_app?.slug ??
    comment?.performed_via_github_app?.name ??
    null
}

export function computeFounderUnmanagedGenesisAuthorizationId(authorization) {
  if (!isPlainObject(authorization)) throw stateConflict('Founder authorization must be one JSON object')
  return `${UGR_AUTHORIZATION_PREFIX}${sha256Hex(canonicalSerialize({
    ...authorization,
    authorization_id: null,
  }))}`
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
  const combinedLine = text.match(/\*\*PR\s*\/\s*base\s*\/\s*head\*\*:\s*([^\n]+)/i)?.[1] ?? null
  const combinedParts = combinedLine
    ? combinedLine.split(/\s*[·|,]\s*/).map((part) => part.trim().replace(/^`|`$/g, ''))
    : []
  const combinedPr = combinedLine?.match(/(?:\/pull\/|#)(\d+)/i)?.[1] ?? null
  const pr = Number(text.match(/\*\*PR\*\*:\s*#(\d+)/)?.[1] ?? combinedPr ?? NaN)
  const base = text.match(/\*\*Base\*\*:\s*`([^`]+)`/)?.[1] ?? combinedParts[1] ?? null
  const head = text.match(/\*\*Exact Head\*\*:\s*`([0-9a-f]{40})`/i)?.[1] ??
    combinedParts.find((part) => /^[0-9a-f]{40}$/i.test(part)) ?? null
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

export function parseLegacyDeltaEvidence(body = '') {
  const text = String(body ?? '')
  if (!text.startsWith('## RESULT')) throw stateConflict('legacy Delta evidence must be a RESULT comment')
  const range = text.match(/Reviewed correction range:\s*\**\s*`([0-9a-f]{40})\.\.([0-9a-f]{40})`/i)
  const head = text.match(/Evidence:\s*\**\s*GitHub head\s*`([0-9a-f]{40})`/i)?.[1] ?? null
  const verdict = /ELIGIBLE FOR FOUNDER REVIEW/.test(text) ? 'ELIGIBLE FOR FOUNDER REVIEW' : null
  const evidenceOnly = /This RESULT is durable semantic evidence only\./i.test(text) &&
    /It is not a canonical `REVIEW_VERDICT`\./i.test(text) &&
    /It is not a signed Full or Delta record\./i.test(text) &&
    /It is not Founder authorization\./i.test(text) &&
    /It is not merge authority\./i.test(text)
  return {
    verdict,
    base: range?.[1] ?? null,
    head: range?.[2] ?? head,
    pullRequest: Number(text.match(/PR\s+#(\d+)/)?.[1] ?? NaN),
    evidenceOnly,
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
  recordClass = null,
  evidenceClass = null,
  repository = UGR_CONTRACT.repository,
  taskIssue = UGR_CONTRACT.taskIssue,
  pullRequest = UGR_CONTRACT.pullRequest,
  observedHead = UGR_CONTRACT.observedHead,
  reviewedHead = UGR_CONTRACT.historicalFullReviewedHead,
  authorLogin = 'boat1994',
  sourceSha = UGR_CONTRACT.protectedBaseSha,
  githubAppSlug = 'bemoat-mc',
  signingKeyId = 'ugr-test-key',
  authorizedAt = '2026-08-03T21:00:00Z',
  expectedPr = {},
  policy = {},
  executor = {},
  full = {},
  delta = {},
  authorizationOverrides = {},
  // v1 helper aliases are accepted only to keep older local callers readable.
  sourceReviewCommentId = UGR_CONTRACT.historicalFullSourceCommentId,
  protectedBaseSha = UGR_CONTRACT.protectedBaseSha,
  policySource = UGR_CONTRACT.policySource,
  policyVersion = UGR_CONTRACT.policyVersion,
  policySha = UGR_CONTRACT.policySha,
  priorFullRecordCommentId = null,
  priorFullRecordId = null,
  correctionBase = null,
  correctionHead = null,
  correctionCommitOids = null,
  correctionDiffSha256 = null,
  overallDiffSha256 = null,
  predecessorDeltaRecordId = null,
  findingDisposition = null,
  findings: _findings = [],
} = {}) {
  const normalizedRecordClass = normalizeRecordClass(recordClass, evidenceClass)
  const defaultFull = {
    reviewed_head: reviewedHead,
    require_ancestor_of_observed_head: true,
    source_evidence: {
      comment_id: Number(sourceReviewCommentId),
      body_sha256: UGR_CONTRACT.historicalFullSourceBodySha256,
      role: 'FULL_REVIEW_VERDICT',
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
    },
    required_historical_checks: ['ci', 'starter-ci'],
  }
  const defaultDelta = {
    parent_full: {
      authorization_id: null,
      authorization_comment_id: null,
      record_id: null,
      record_comment_id: null,
      record_body_sha256: null,
    },
    predecessor_delta_record_id: predecessorDeltaRecordId,
    exact_current_head: observedHead,
    coverage_segments: [{
      base: UGR_CONTRACT.legacyDeltaEvidenceBase,
      head: UGR_CONTRACT.legacyDeltaEvidenceHead,
      comment_id: UGR_CONTRACT.legacyDeltaEvidenceCommentId,
      body_sha256: UGR_CONTRACT.legacyDeltaEvidenceBodySha256,
      role: 'LEGACY_DELTA_EVIDENCE_RESULT',
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
    }],
    correction_commit_oids: correctionCommitOids ?? [],
    correction_diff_sha256: correctionDiffSha256,
    overall_diff_sha256: overallDiffSha256 ?? correctionDiffSha256,
    finding_disposition: findingDisposition ?? [],
    required_current_checks: ['ci', 'starter-ci'],
  }
  const authorization = {
    schema_version: 2,
    authorization_schema: UGR_AUTHORIZATION_SCHEMA,
    authorization_id: null,
    lifecycle_id: UGR_LIFECYCLE_ID,
    status: 'approved',
    authority: 'Founder',
    author_login: authorLogin,
    repository,
    task_issue: Number(taskIssue),
    pull_request: Number(pullRequest),
    record_class: normalizedRecordClass,
    bundle_kind: UGR_CONTRACT.authorizationBundle,
    scope: UGR_CONTRACT.authorizationScope,
    action: normalizedRecordClass === 'FULL_RECORDING'
      ? UGR_CONTRACT.authorizationActionFull
      : UGR_CONTRACT.authorizationActionDelta,
    expected_pr: {
      state: 'OPEN',
      draft: true,
      head_ref: UGR_CONTRACT.branch,
      observed_head: observedHead,
      base_ref: UGR_CONTRACT.base,
      base_sha: protectedBaseSha,
    },
    policy: {
      source: policySource,
      version: policyVersion,
      source_commit: UGR_CONTRACT.policySourceCommit,
      blob_sha: policySha,
    },
    executor: {
      source_sha: sourceSha,
      github_app_slug: githubAppSlug,
      signing_key_id: signingKeyId,
    },
    supersedes_authorization_id: null,
    authorized_at: authorizedAt,
  }
  authorization.expected_pr = { ...authorization.expected_pr, ...expectedPr }
  authorization.policy = { ...authorization.policy, ...policy }
  authorization.executor = { ...authorization.executor, ...executor }
  if (normalizedRecordClass === 'FULL_RECORDING') {
    authorization.full = deepMerge(defaultFull, full)
  } else {
    let legacyDelta = defaultDelta
    if (priorFullRecordCommentId != null || priorFullRecordId != null) {
      legacyDelta = deepMerge(legacyDelta, {
        parent_full: {
          record_comment_id: priorFullRecordCommentId == null ? null : Number(priorFullRecordCommentId),
          record_id: priorFullRecordId,
        },
      })
    }
    if (correctionBase != null) legacyDelta.coverage_segments[0].base = correctionBase
    if (correctionHead != null) {
      legacyDelta.exact_current_head = correctionHead
      legacyDelta.coverage_segments[0].head = correctionHead
    }
    if (correctionDiffSha256 != null) legacyDelta.correction_diff_sha256 = correctionDiffSha256
    if (overallDiffSha256 != null) legacyDelta.overall_diff_sha256 = overallDiffSha256
    if (correctionCommitOids != null) legacyDelta.correction_commit_oids = correctionCommitOids
    if (findingDisposition != null) legacyDelta.finding_disposition = findingDisposition
    authorization.delta = deepMerge(legacyDelta, delta)
  }
  const merged = deepMerge(authorization, authorizationOverrides)
  merged.authorization_id = computeFounderUnmanagedGenesisAuthorizationId(merged)
  return JSON.stringify(merged, null, 2)
}

export function validateFounderUnmanagedGenesisAuthorization({
  authorization,
  authorizationComment,
  repository,
  founderLogins,
  issueComments = [],
  workflow = null,
  signingKeyId = null,
  githubAppSlug = null,
} = {}) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw stateConflict('Founder authorization is missing')
  }
  if (authorization.schema_version !== 2) throw stateConflict('Founder authorization schema_version must be 2')
  if (authorization.authorization_schema !== UGR_AUTHORIZATION_SCHEMA) {
    throw stateConflict('Founder authorization schema is invalid')
  }
  if (authorization.authorization_id !== computeFounderUnmanagedGenesisAuthorizationId(authorization)) {
    throw stateConflict('Founder authorization authorization_id does not match its canonical body')
  }
  if (authorization.lifecycle_id !== UGR_LIFECYCLE_ID) throw stateConflict('Founder authorization lifecycle_id is invalid')
  if (authorization.status !== 'approved') throw stateConflict('Founder authorization status must be approved')
  if (authorization.authority !== 'Founder') throw stateConflict('Founder authorization authority must be Founder')
  if (authorization.bundle_kind !== UGR_CONTRACT.authorizationBundle) throw stateConflict('Founder authorization bundle_kind is invalid')
  if (authorization.scope !== UGR_CONTRACT.authorizationScope) throw stateConflict('Founder authorization scope is invalid')
  const recordClass = normalizeRecordClass(authorization.record_class)
  const expectedAction = recordClass === 'FULL_RECORDING'
    ? UGR_CONTRACT.authorizationActionFull
    : UGR_CONTRACT.authorizationActionDelta
  if (authorization.action !== expectedAction) throw stateConflict('Founder authorization action is invalid')
  if (authorization.repository !== repository) throw stateConflict('Founder authorization repository binding mismatches')
  if (Number(authorization.task_issue) !== UGR_CONTRACT.taskIssue) throw stateConflict('Founder authorization task_issue must be #262')
  if (Number(authorization.pull_request) !== UGR_CONTRACT.pullRequest) throw stateConflict('Founder authorization pull_request must be #266')
  const expectedPr = authorization.expected_pr
  if (!isPlainObject(expectedPr) ||
      expectedPr.state !== 'OPEN' ||
      expectedPr.draft !== true ||
      expectedPr.head_ref !== UGR_CONTRACT.branch ||
      !validFullSha(expectedPr.observed_head) ||
      expectedPr.base_ref !== UGR_CONTRACT.base ||
      expectedPr.base_sha !== UGR_CONTRACT.protectedBaseSha) {
    throw stateConflict('Founder authorization expected_pr binding is invalid')
  }
  const policy = authorization.policy
  if (!isPlainObject(policy) ||
      policy.source !== UGR_CONTRACT.policySource ||
      policy.version !== UGR_CONTRACT.policyVersion ||
      policy.source_commit !== UGR_CONTRACT.policySourceCommit ||
      policy.blob_sha !== UGR_CONTRACT.policySha) {
    throw stateConflict('Founder authorization policy tuple mismatches')
  }
  const executor = authorization.executor
  if (!isPlainObject(executor) ||
      !validFullSha(executor.source_sha) ||
      typeof executor.github_app_slug !== 'string' ||
      !executor.github_app_slug ||
      typeof executor.signing_key_id !== 'string' ||
      !executor.signing_key_id) {
    throw stateConflict('Founder authorization executor binding is invalid')
  }
  if (signingKeyId != null && executor.signing_key_id !== signingKeyId) {
    throw stateConflict('Founder authorization signing key ID mismatches protected configuration')
  }
  if (githubAppSlug != null && executor.github_app_slug !== githubAppSlug) {
    throw stateConflict('Founder authorization GitHub App slug mismatches protected configuration')
  }
  if (workflow?.sha != null && executor.source_sha !== workflow.sha) {
    throw stateConflict('Founder authorization executor source_sha mismatches workflow source')
  }
  if (authorization.supersedes_authorization_id != null) {
    throw stateConflict('Founder authorization must not supersede another authorization')
  }
  if (typeof authorization.authorized_at !== 'string' || Number.isNaN(Date.parse(authorization.authorized_at))) {
    throw stateConflict('Founder authorization authorized_at is invalid')
  }
  if (typeof authorization.author_login !== 'string' || !authorization.author_login) {
    throw stateConflict('Founder authorization author_login is required')
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
  for (const comment of issueComments) {
    if (Number(comment?.id) === Number(authorizationComment.id)) continue
    try {
      const candidate = parseFounderUnmanagedGenesisAuthorization(comment?.body ?? '')
      if (candidate.supersedes_authorization_id === authorization.authorization_id) {
        throw stateConflict('Founder authorization has been superseded')
      }
    } catch (error) {
      if (error?.code === 'STATE_CONFLICT' && /superseded/.test(error.message)) throw error
    }
  }
  if (recordClass === 'FULL_RECORDING') {
    const full = authorization.full
    if (!isPlainObject(full) ||
        full.reviewed_head !== UGR_CONTRACT.historicalFullReviewedHead ||
        full.require_ancestor_of_observed_head !== true ||
        !isPlainObject(full.source_evidence) ||
        Number(full.source_evidence.comment_id) !== UGR_CONTRACT.historicalFullSourceCommentId ||
        full.source_evidence.role !== 'FULL_REVIEW_VERDICT' ||
        full.source_evidence.verdict !== 'ELIGIBLE FOR FOUNDER REVIEW' ||
        !validSha256(full.source_evidence.body_sha256)) {
      throw stateConflict('Full authorization historical source evidence is invalid')
    }
    requiredCheckNames(full.required_historical_checks, 'Full required_historical_checks')
  } else {
    const delta = authorization.delta
    if (!isPlainObject(delta) || !isPlainObject(delta.parent_full)) {
      throw stateConflict('Delta authorization parent_full is required')
    }
    const parent = delta.parent_full
    if (!positiveId(parent.authorization_comment_id) ||
        !positiveId(parent.record_comment_id) ||
        typeof parent.authorization_id !== 'string' ||
        !parent.authorization_id.startsWith(UGR_AUTHORIZATION_PREFIX) ||
        typeof parent.record_id !== 'string' ||
        !parent.record_id.startsWith(UGR_RECORD_PREFIX) ||
        !validSha256(parent.record_body_sha256)) {
      throw stateConflict('Delta authorization parent_full binding is invalid')
    }
    if (!validFullSha(delta.exact_current_head)) throw stateConflict('Delta exact_current_head is invalid')
    if (!Array.isArray(delta.coverage_segments) || delta.coverage_segments.length === 0) {
      throw stateConflict('Delta coverage_segments are required')
    }
    for (const segment of delta.coverage_segments) {
      if (!isPlainObject(segment) ||
          !validFullSha(segment.base) ||
          !validFullSha(segment.head) ||
          !positiveId(segment.comment_id) ||
          !validSha256(segment.body_sha256) ||
          (segment.role !== 'LEGACY_DELTA_EVIDENCE_RESULT' && segment.role !== 'DELTA_REVIEW_VERDICT') ||
          typeof segment.verdict !== 'string') {
        throw stateConflict('Delta coverage segment is invalid')
      }
    }
    if (delta.predecessor_delta_record_id != null &&
        (typeof delta.predecessor_delta_record_id !== 'string' || !delta.predecessor_delta_record_id.startsWith(UGR_RECORD_PREFIX))) {
      throw stateConflict('Delta predecessor_delta_record_id is invalid')
    }
    if (!Array.isArray(delta.correction_commit_oids) ||
        delta.correction_commit_oids.some((oid) => !validFullSha(oid))) {
      throw stateConflict('Delta correction_commit_oids are invalid')
    }
    if (!validSha256(delta.correction_diff_sha256) || !validSha256(delta.overall_diff_sha256)) {
      throw stateConflict('Delta diff hashes are required')
    }
    if (!Array.isArray(delta.finding_disposition)) throw stateConflict('Delta finding_disposition is required')
    requiredCheckNames(delta.required_current_checks, 'Delta required_current_checks')
  }
  return {
    recordClass,
    evidenceClass: evidenceClassForRecordClass(recordClass),
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
  livePrHead = null,
  exactHeadCi,
  findings = [],
  full = null,
  delta = null,
  workflow,
  signingKeyId,
}) {
  if (evidenceClass !== 'full' && evidenceClass !== 'delta') throw stateConflict('evidence_class must be full or delta')
  const authorization = founderAuthorization.authorization ?? founderAuthorization
  const recordClass = authorization.record_class ?? (evidenceClass === 'full' ? 'FULL_RECORDING' : 'DELTA_RECORDING')
  const record = {
    schema_version: 1,
    record_schema: UGR_RECORD_SCHEMA,
    evidence_class: evidenceClass,
    record_class: recordClass,
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
      head_ref: String(pullRequest.headRefName ?? pullRequest.head_ref ?? ''),
    },
    founder_authorization: {
      authorization_id: authorization.authorization_id ?? null,
      lifecycle_id: authorization.lifecycle_id ?? null,
      comment_id: Number(founderAuthorization.commentId),
      comment_body_sha256: founderAuthorization.bodySha256,
      author_login: founderAuthorization.authorLogin,
    },
    source_review: {
      comment_id: Number(sourceReview.commentId),
      comment_body_sha256: sourceReview.bodySha256,
      author_login: sourceReview.authorLogin,
      verdict: sourceReview.verdict,
      role: sourceReview.role ?? null,
      base: sourceReview.base ?? null,
      head: sourceReview.head ?? null,
    },
    reviewed_head: reviewedHead,
    live_pr_head: livePrHead,
    executor: authorization.executor ?? null,
    exact_head_ci: {
      head: exactHeadCi.head,
      checks: sortChecks(exactHeadCi.checks ?? []),
    },
    findings: sortFindings(findings),
    full: evidenceClass === 'full' ? {
      ...full,
      reviewed_head: full?.reviewed_head ?? full?.reviewed_old_head ?? reviewedHead,
      reviewed_old_head: full?.reviewed_old_head ?? full?.reviewed_head ?? reviewedHead,
      require_ancestor_of_observed_head: full?.require_ancestor_of_observed_head ?? true,
      source_evidence: full?.source_evidence ?? authorization.full?.source_evidence ?? null,
      required_historical_checks: full?.required_historical_checks ?? authorization.full?.required_historical_checks ?? [],
    } : null,
    delta: evidenceClass === 'delta' ? {
      ...delta,
      parent_full: delta?.parent_full ?? {
        authorization_id: delta?.prior_full_authorization_id ?? null,
        authorization_comment_id: delta?.prior_full_authorization_comment_id ?? null,
        record_id: delta?.prior_full_record_id ?? null,
        record_comment_id: delta?.prior_full_record_comment_id ?? null,
        record_body_sha256: delta?.prior_full_record_sha256 ?? null,
      },
      predecessor_delta_record_id: delta?.predecessor_delta_record_id ?? null,
      exact_current_head: delta?.exact_current_head ?? reviewedHead,
      coverage_segments: delta?.coverage_segments ?? [],
      correction_diff_sha256: delta?.correction_diff_sha256 ?? null,
      overall_diff_sha256: delta?.overall_diff_sha256 ?? null,
      required_current_checks: delta?.required_current_checks ?? [],
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
    const fullRecord = record.full
    if (!fullRecord || !validFullSha(fullRecord.reviewed_head)) {
      throw stateConflict('full record requires reviewed_head')
    }
  } else {
    const deltaRecord = record.delta
    if (!deltaRecord?.parent_full?.record_id ||
        !positiveId(deltaRecord.parent_full.record_comment_id) ||
        !validSha256(deltaRecord.parent_full.record_body_sha256)) {
      throw stateConflict('delta record requires parent_full binding fields')
    }
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
    return { eligible: false, reason: 'competing valid Full roots exist', classification: 'STATE_CONFLICT' }
  }

  const full = fullRecords[0].record
  const fullReviewedHead = full.full?.reviewed_head ?? full.reviewed_head
  if (fullReviewedHead !== UGR_CONTRACT.historicalFullReviewedHead) {
    return { eligible: false, reason: 'Full root is not bound to the approved historical head', classification: 'STATE_CONFLICT' }
  }

  const rootedDeltas = []
  for (const entry of deltaRecords) {
    const delta = entry.record.delta ?? {}
    const parentId = delta.parent_full?.record_id ?? delta.prior_full_record_id
    if (parentId !== full.record_id) {
      return { eligible: false, reason: 'Delta is not cryptographically linked to the Full root', classification: 'STATE_CONFLICT' }
    }
    if (!Array.isArray(delta.coverage_segments) || delta.coverage_segments.length === 0) {
      return { eligible: false, reason: 'Delta coverage is missing', classification: 'STATE_CONFLICT' }
    }
    let cursor = fullReviewedHead
    for (const segment of delta.coverage_segments) {
      if (segment.base !== cursor) {
        return { eligible: false, reason: 'Delta coverage is not contiguous', classification: 'STATE_CONFLICT' }
      }
      cursor = segment.head
    }
    const exactHead = delta.exact_current_head ?? entry.record.reviewed_head
    if (cursor !== exactHead) {
      return { eligible: false, reason: 'Delta coverage does not end at exact_current_head', classification: 'STATE_CONFLICT' }
    }
    if (delta.predecessor_delta_record_id != null &&
        !deltaRecords.some((candidate) => candidate.record.record_id === delta.predecessor_delta_record_id)) {
      return { eligible: false, reason: 'Delta predecessor link is missing', classification: 'STATE_CONFLICT' }
    }
    rootedDeltas.push(entry)
  }
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
  const tipHead = tip.delta?.exact_current_head ?? tip.reviewed_head
  if (tipHead !== livePullRequestHead) {
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
    reviewedHead: tipHead,
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
  if (pullRequest?.baseRefOid !== UGR_CONTRACT.protectedBaseSha) {
    throw stateConflict('PR #266 base must point at the approved protected base')
  }
  if (pullRequest?.headRefName !== UGR_CONTRACT.branch) {
    throw stateConflict('PR #266 head branch is not the authorized task branch')
  }
}

export function collectVerifiedRecords(comments, {
  publicKey,
  signingKeyId = null,
  githubAppSlug = null,
} = {}) {
  const records = []
  for (const comment of comments ?? []) {
    const parsed = parseUnmanagedGenesisReviewComment(comment?.body ?? '')
    if (!parsed.ok) continue
    if (githubAppSlug != null && actualAppSlug(comment) !== githubAppSlug) {
      throw stateConflict(`signed unmanaged-genesis record comment ${comment.id} was not posted by the expected GitHub App`)
    }
    const verified = verifyUnmanagedGenesisReviewRecord(parsed.record, { publicKey, signingKeyId })
    if (!verified.ok) {
      throw stateConflict(`competing or invalid signed unmanaged-genesis record on comment ${comment.id}: ${verified.reason}`)
    }
    if (githubAppSlug != null && parsed.record.executor?.github_app_slug !== githubAppSlug) {
      throw stateConflict(`signed unmanaged-genesis record ${comment.id} has the wrong executor GitHub App`)
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
    if (existing) {
      throw stateConflict(`duplicate signed unmanaged-genesis record_id: ${entry.record.record_id}`)
    }
    byId.set(entry.record.record_id, entry)
  }
  return [...byId.values()]
}
