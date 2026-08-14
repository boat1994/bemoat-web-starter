/**
 * Pure campaign expansion authority, range, and transition helpers.
 * No GitHub, filesystem, process, or command execution.
 */

import { createHash } from 'node:crypto'

import { FULL_COMMIT_SHA } from './campaign-enums.ts'
import { sameCampaignValue } from './campaign-equality.ts'

type Mapping = Record<string, unknown>
type InvalidResult = {
  valid: false
  code: string
  reason: string
  classification: string
}
type SliceRangeResult = InvalidResult | { valid: true; keys: string[]; maxSlice: number }
type AuthorityShapeResult = InvalidResult | { valid: true; expectedAppendKeys: string[] }
type AuthorityVerificationResult = InvalidResult | { valid: true; authority: Mapping; maxSlice: number }
type AuthorityValidationResult =
  | InvalidResult
  | { valid: true; expanded: boolean; maxSlice: number; authority: Mapping | null }
type TransitionOptions = {
  blockerId?: unknown
  evidence?: unknown
  mode?: unknown
  targetSlice?: unknown
}
type TransitionResult = InvalidResult | { valid: true }

export const LEGACY_MAX_SLICE = 7
export const CAMPAIGN_EXPANSION_POLICY_VERSION = '1.3.0'
export const CAMPAIGN_EXPANSION_APPROVED_BASE = 'main'

export const CAMPAIGN_DIAGNOSTIC_CODES = Object.freeze({
  DUPLICATE_KEY: 'CAMPAIGN_YAML_DUPLICATE_KEY',
  SLICE_KEYS_NOT_CONTIGUOUS: 'CAMPAIGN_SLICE_KEYS_NOT_CONTIGUOUS',
  RANGE_UNAUTHORIZED: 'CAMPAIGN_SLICE_RANGE_UNAUTHORIZED',
  RANGE_SHRINK: 'CAMPAIGN_SLICE_RANGE_SHRINK',
  RANGE_RENUMBERED: 'CAMPAIGN_SLICE_RANGE_RENUMBERED',
  AUTHORITY_INVALID: 'CAMPAIGN_AUTHORITY_INVALID',
  AUTHORITY_STALE: 'CAMPAIGN_AUTHORITY_STALE',
  AUTHORITY_UNAVAILABLE: 'CAMPAIGN_AUTHORITY_UNAVAILABLE',
  ROOT_SCRIPT_MAP_STATUS_INVALID: 'CAMPAIGN_ROOT_SCRIPT_MAP_STATUS_INVALID',
  COMPLETED_SLICE_MUTATION: 'CAMPAIGN_COMPLETED_SLICE_MUTATION',
  EXPANSION_ROOT_MUTATION: 'CAMPAIGN_EXPANSION_ROOT_MUTATION',
  EXPANSION_ROW_INVALID: 'CAMPAIGN_EXPANSION_ROW_INVALID',
  BLOCKER_BINDING_INVALID: 'CAMPAIGN_BLOCKER_BINDING_INVALID',
  BLOCKER_SLICE_STATUS_MUTATION: 'CAMPAIGN_BLOCKER_RESOLUTION_SLICE_STATUS_MUTATION',
  BLOCKER_SLICE_MUTATION: 'CAMPAIGN_BLOCKER_RESOLUTION_SLICE_MUTATION',
})

function invalid(code: string, reason: string, classification = 'STATE_CONFLICT'): InvalidResult {
  return { valid: false, code, reason, classification }
}

function isMapping(value: unknown): value is Mapping {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isDecimalId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isCanonicalSliceKey(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && String(Number(value)) === value
}

function field(value: unknown, key: string): unknown {
  return isMapping(value) ? value[key] : undefined
}

function sliceAt(campaign: Mapping, key: string): unknown {
  const slices = field(campaign, 'slices')
  return isMapping(slices) ? slices[key] : undefined
}

function rootValidationStatus(campaign: Mapping): unknown {
  return field(field(campaign, 'root_script_map'), 'validation_status')
}

function objectKeys(value: unknown): string[] {
  const objectLike = value !== null && typeof value === 'object' ? value : {}
  return Object.keys(objectLike)
}

function hasSlice(campaign: Mapping, key: string): boolean {
  const slices = field(campaign, 'slices')
  return isMapping(slices) && Object.hasOwn(slices, key)
}

export function expectedSliceKeys(maxSlice: number): string[] {
  return Array.from({ length: maxSlice }, (_, index) => String(index + 1))
}

export function sortedSliceKeys(slices: unknown): string[] {
  const sortable = slices !== null && typeof slices === 'object' ? slices : {}
  return Object.keys(sortable).sort((left, right) => Number(left) - Number(right))
}

export function inspectSliceRange(slices: unknown): SliceRangeResult {
  if (!isMapping(slices)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.SLICE_KEYS_NOT_CONTIGUOUS, 'campaign slices must be contiguous starting at "1"')
  }

  const keys = Object.keys(slices)
  if (keys.some((key) => !isCanonicalSliceKey(key))) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.SLICE_KEYS_NOT_CONTIGUOUS, 'campaign slices must be contiguous starting at "1"')
  }

  const maxSlice = keys.length === 0 ? 0 : Math.max(...keys.map(Number))
  const expected = expectedSliceKeys(maxSlice)
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(slices, key))) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.SLICE_KEYS_NOT_CONTIGUOUS, 'campaign slices must be contiguous starting at "1"')
  }

  return { valid: true, keys: expected, maxSlice }
}

function normalizeStringList(
  value: unknown,
  fieldName: string,
  { allowEmpty = true }: { allowEmpty?: boolean } = {},
): InvalidResult | { valid: true } {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, `${fieldName} must be a ${allowEmpty ? '' : 'non-empty '}array`)
  }
  if (value.some((entry) => !isDecimalId(entry))) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, `${fieldName} entries must be decimal id strings`)
  }
  if (new Set(value).size !== value.length) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, `${fieldName} entries must be unique`)
  }
  return { valid: true }
}

function validateAuthorityShape(authority: unknown): AuthorityShapeResult {
  if (!isMapping(authority)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign_expansion_authority must be a mapping')
  }
  if (authority.schema_version !== 1 || authority.decision !== 'APPROVED' || authority.scope !== 'campaign_slice_range' || authority.action !== 'append_only_expand') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority decision lineage is invalid')
  }
  const source = authority.source
  if (!isMapping(source) || source.kind !== 'github_issue_comment') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority source must be a GitHub issue comment')
  }
  if (
    typeof source.repository !== 'string' ||
    !/^[^/\s]+\/[^/\s]+$/.test(source.repository) ||
    typeof source.issue !== 'string' ||
    !/^#\d+$/.test(source.issue) ||
    !isDecimalId(source.comment_id) ||
    typeof source.author_login !== 'string' ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(source.author_login) ||
    !isSha256(source.body_sha256)
  ) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority source provenance is invalid')
  }
  if (
    authority.approved_base !== CAMPAIGN_EXPANSION_APPROVED_BASE ||
    authority.policy_version !== CAMPAIGN_EXPANSION_POLICY_VERSION ||
    authority.legacy_max_slice !== LEGACY_MAX_SLICE ||
    authority.append_only !== true ||
    typeof authority.protected_base_sha !== 'string' ||
    !FULL_COMMIT_SHA.test(authority.protected_base_sha) ||
    authority.protected_base_sha !== authority.protected_base_sha.toLowerCase()
  ) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority base or policy binding is invalid')
  }
  const authorizedMaxSlice = authority.authorized_max_slice
  if (typeof authorizedMaxSlice !== 'number' || !Number.isInteger(authorizedMaxSlice) || authorizedMaxSlice < LEGACY_MAX_SLICE + 1) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority must authorize a slice beyond the legacy maximum')
  }

  const expectedAppendKeys = expectedSliceKeys(authorizedMaxSlice).slice(LEGACY_MAX_SLICE)
  if (!Array.isArray(authority.authorized_append_keys) ||
      !sameCampaignValue(authority.authorized_append_keys, expectedAppendKeys)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority append keys must equal the authorized contiguous range')
  }

  const related = normalizeStringList(authority.related_authority_comment_ids, 'related_authority_comment_ids', { allowEmpty: false })
  if (related.valid !== true) return related

  return {
    valid: true,
    expectedAppendKeys,
  }
}

function commentAuthor(comment: unknown): unknown {
  return field(field(comment, 'user'), 'login') ?? field(comment, 'author_login') ?? null
}

function commentIssueUrl(comment: unknown): unknown {
  return field(comment, 'issue_url') ?? field(comment, 'issue_url_html') ?? null
}

function commentSupersedes(comment: unknown, commentId: string): boolean {
  const body = String(field(comment, 'body') ?? '')
  if (!body.includes(String(commentId))) return false
  return /supersed|not authoritative|replaced|revoked/i.test(body)
}

function expectedIssueUrl(repository: string, issue: string): string {
  return `https://api.github.com/repos/${repository}/issues/${String(issue).replace(/^#/, '')}`
}

function findAuthorityComments(evidence: unknown): unknown[] | null {
  const envelope = field(evidence, 'campaignExpansionAuthority')
  if (!isMapping(envelope)) return null
  if (Array.isArray(envelope.comments)) return envelope.comments
  if (isMapping(envelope.comment)) return [envelope.comment]
  return null
}

export function verifyCampaignExpansionAuthority(authority: unknown, evidence: unknown = null): AuthorityVerificationResult {
  const shape = validateAuthorityShape(authority)
  if (shape.valid !== true) return shape

  if (!isMapping(authority)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign_expansion_authority must be a mapping')
  }

  const comments = findAuthorityComments(evidence)
  const envelope = field(evidence, 'campaignExpansionAuthority')
  if (!comments || !isMapping(envelope) || !Array.isArray(envelope.trustedFounderLogins) || typeof envelope.currentProtectedBaseSha !== 'string') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_UNAVAILABLE, 'required live campaign expansion authority evidence is unavailable', 'BLOCKED_EXTERNAL')
  }
  if (envelope.contradictory === true) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority evidence is contradictory')
  }

  const source = comments.find((comment) => String(field(comment, 'id')) === String(field(authority.source, 'comment_id')))
  const sourceBody = source ? field(source, 'body') : undefined
  if (!source || typeof sourceBody !== 'string') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_UNAVAILABLE, 'campaign expansion authority source comment is unavailable', 'BLOCKED_EXTERNAL')
  }

  const sourceAuthor = commentAuthor(source)
  const sourceIssueUrl = commentIssueUrl(source)
  const authoritySource = authority.source
  if (!isMapping(authoritySource) || typeof authoritySource.author_login !== 'string' || typeof authoritySource.repository !== 'string' || typeof authoritySource.issue !== 'string' || typeof authoritySource.body_sha256 !== 'string') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority source provenance is invalid')
  }
  if (
    sourceAuthor !== authoritySource.author_login ||
    !envelope.trustedFounderLogins.includes(sourceAuthor) ||
    sourceIssueUrl !== expectedIssueUrl(authoritySource.repository, authoritySource.issue)
  ) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority source identity does not match its binding')
  }

  const bodySha = createHash('sha256').update(sourceBody, 'utf8').digest('hex')
  if (bodySha !== authoritySource.body_sha256) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_STALE, 'campaign expansion authority source comment body has changed')
  }
  if (!/CAMPAIGN EXPANSION/i.test(sourceBody) || !/APPEND SLICES/i.test(sourceBody)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority source comment is not an expansion decision')
  }
  if (
    envelope.superseded === true ||
    comments.some((comment) => String(field(comment, 'id')) !== String(authoritySource.comment_id) && commentSupersedes(comment, String(authoritySource.comment_id)))
  ) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_STALE, 'campaign expansion authority source comment is superseded')
  }
  if (envelope.currentProtectedBaseSha !== authority.protected_base_sha) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_STALE, 'campaign expansion authority protected base is no longer current')
  }

  const relatedCommentIds = authority.related_authority_comment_ids
  if (!Array.isArray(relatedCommentIds)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'related_authority_comment_ids must be a non-empty array')
  }
  for (const commentId of relatedCommentIds) {
    const related = comments.find((comment) => String(field(comment, 'id')) === String(commentId))
    if (!related) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_UNAVAILABLE, `related campaign authority comment ${commentId} is unavailable`, 'BLOCKED_EXTERNAL')
    }
    if (commentAuthor(related) !== authoritySource.author_login || commentIssueUrl(related) !== sourceIssueUrl) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, `related campaign authority comment ${commentId} has mismatched provenance`)
    }
  }

  const authorizedMaxSlice = authority.authorized_max_slice
  if (typeof authorizedMaxSlice !== 'number' || !Number.isInteger(authorizedMaxSlice)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority must authorize a slice beyond the legacy maximum')
  }
  return { valid: true, authority, maxSlice: authorizedMaxSlice }
}

export function validateCampaignExpansionAuthority(authority: unknown, evidence: unknown = null): AuthorityValidationResult {
  if (authority == null) {
    return { valid: true, expanded: false, maxSlice: LEGACY_MAX_SLICE, authority: null }
  }
  const verified = verifyCampaignExpansionAuthority(authority, evidence)
  if (verified.valid !== true) return verified
  return { ...verified, expanded: true }
}

function copyWithout(value: unknown, keys: string[]): Mapping {
  const copy = { ...(isMapping(value) ? value : {}) }
  for (const key of keys) delete copy[key]
  return copy
}

function sameExpansionRoot(left: Mapping, right: Mapping): boolean {
  const leftRoot = copyWithout(left, ['campaign_expansion_authority', 'root_script_map', 'slices', 'updated_at', 'updated_by'])
  const rightRoot = copyWithout(right, ['campaign_expansion_authority', 'root_script_map', 'slices', 'updated_at', 'updated_by'])
  if (!sameCampaignValue(leftRoot, rightRoot)) return false

  const leftMap = copyWithout(field(left, 'root_script_map'), ['validation_status'])
  const rightMap = copyWithout(field(right, 'root_script_map'), ['validation_status'])
  return sameCampaignValue(leftMap, rightMap)
}

function sameAuthority(left: unknown, right: unknown): boolean {
  return sameCampaignValue(left ?? null, right ?? null)
}

function sameBlockerResolutionRoot(left: Mapping, right: Mapping): boolean {
  const leftRoot = copyWithout(left, [
    'campaign_blockers',
    'campaign_lifecycle',
    'campaign_expansion_authority',
    'root_script_map',
    'slices',
    'updated_at',
    'updated_by',
  ])
  const rightRoot = copyWithout(right, [
    'campaign_blockers',
    'campaign_lifecycle',
    'campaign_expansion_authority',
    'root_script_map',
    'slices',
    'updated_at',
    'updated_by',
  ])
  if (!sameCampaignValue(leftRoot, rightRoot)) return false

  const leftMap = copyWithout(field(left, 'root_script_map'), ['validation_status'])
  const rightMap = copyWithout(field(right, 'root_script_map'), ['validation_status'])
  return sameCampaignValue(leftMap, rightMap)
}

function changedKeys(left: Mapping, right: Mapping, keys: string[]): string[] {
  return keys.filter((key) => !sameCampaignValue(sliceAt(left, key), sliceAt(right, key)))
}

function validateNewExpansionRows(campaign: Mapping, keys: string[]): TransitionResult {
  for (const key of keys) {
    const slice = sliceAt(campaign, key)
    const authorityCommentIds = field(slice, 'authority_comment_ids')
    const blockerIds = field(slice, 'blocker_ids')
    if (
      field(slice, 'status') !== 'NOT_STARTED' ||
      field(slice, 'issue') != null ||
      field(slice, 'pr') != null ||
      field(slice, 'reviewed_head') != null ||
      field(slice, 'merged_commit') != null ||
      !Array.isArray(authorityCommentIds) ||
      authorityCommentIds.length !== 0 ||
      !Array.isArray(blockerIds) ||
      blockerIds.length !== 0
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.EXPANSION_ROW_INVALID, `new campaign slice ${key} must be an empty NOT_STARTED row`)
    }
  }
  return { valid: true }
}

function validateExactBlockerRemoval(previous: Mapping, next: Mapping, blockerId: unknown): TransitionResult {
  if (typeof blockerId !== 'string' || blockerId.length === 0) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, 'blocker-resolution requires one exact blocker id')
  }
  const previousBlockers = field(previous, 'campaign_blockers')
  const nextBlockers = field(next, 'campaign_blockers')
  if (!Array.isArray(previousBlockers) || !Array.isArray(nextBlockers)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, 'campaign blocker bindings must be arrays')
  }
  const matches = previousBlockers.filter((blocker) => field(blocker, 'id') === blockerId)
  if (matches.length !== 1) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, `campaign blocker ${blockerId} is not bound exactly once`)
  }
  const expected = previousBlockers.filter((blocker) => field(blocker, 'id') !== blockerId)
  if (!sameCampaignValue(expected, nextBlockers)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, 'blocker-resolution may remove only the exactly bound campaign blocker')
  }
  return { valid: true }
}

function validateBlockerResolutionSlices(previous: Mapping, next: Mapping, priorRange: { keys: string[] }, blockerId: unknown): TransitionResult {
  for (const key of priorRange.keys) {
    const priorSlice = sliceAt(previous, key)
    const nextSlice = sliceAt(next, key)
    if (!nextSlice) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, `existing campaign slice ${key} cannot be replaced or removed`)
    }

    const priorWithoutBlockers = copyWithout(priorSlice, ['blocker_ids'])
    const nextWithoutBlockers = copyWithout(nextSlice, ['blocker_ids'])
    if (!sameCampaignValue(priorWithoutBlockers, nextWithoutBlockers)) {
      if (field(priorSlice, 'status') !== field(nextSlice, 'status')) {
        return invalid(
          CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_SLICE_STATUS_MUTATION,
          `blocker-resolution may not mutate campaign slice ${key} status`,
        )
      }
      return invalid(
        CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_SLICE_MUTATION,
        `blocker-resolution may mutate only blocker references on campaign slices`,
      )
    }

    const priorBlockerIdsValue = field(priorSlice, 'blocker_ids')
    const nextBlockerIdsValue = field(nextSlice, 'blocker_ids')
    const priorBlockerIds = Array.isArray(priorBlockerIdsValue) ? priorBlockerIdsValue : null
    const nextBlockerIds = Array.isArray(nextBlockerIdsValue) ? nextBlockerIdsValue : null
    const expectedBlockerIds = priorBlockerIds?.filter((id) => id !== blockerId) ?? null
    if (!sameCampaignValue(expectedBlockerIds, nextBlockerIds)) {
      return invalid(
        CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_SLICE_MUTATION,
        `blocker-resolution may remove only blocker references for ${blockerId}`,
      )
    }
  }
  return { valid: true }
}

export function validateCampaignBlockerResolutionTransition(
  previous: unknown,
  next: unknown,
  options: TransitionOptions = {},
): TransitionResult {
  if (!isMapping(previous) || !isMapping(next)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, 'blocker-resolution requires two campaign mappings')
  }

  const blockerRemoval = validateExactBlockerRemoval(previous, next, options.blockerId)
  if (!blockerRemoval.valid) return blockerRemoval

  const priorRange = inspectSliceRange(field(previous, 'slices'))
  if (!priorRange.valid) return priorRange
  const nextRange = inspectSliceRange(field(next, 'slices'))
  if (!nextRange.valid) return nextRange

  const nextAuthority = validateCampaignExpansionAuthority(field(next, 'campaign_expansion_authority'), options.evidence ?? null)
  if (!nextAuthority.valid) return nextAuthority
  const priorAuthority = validateCampaignExpansionAuthority(field(previous, 'campaign_expansion_authority'), options.evidence ?? null)
  if (!priorAuthority.valid) return priorAuthority

  if (!sameBlockerResolutionRoot(previous, next)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.EXPANSION_ROOT_MUTATION, 'blocker-resolution may not mutate unrelated campaign root fields')
  }
  if (
    field(previous, 'campaign_lifecycle') !== field(next, 'campaign_lifecycle') &&
    !(field(previous, 'campaign_lifecycle') === 'BLOCKED' && field(next, 'campaign_lifecycle') === 'ACTIVE')
  ) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.EXPANSION_ROOT_MUTATION, 'blocker-resolution may only clear the blocking campaign lifecycle')
  }

  const missingPriorKeys = priorRange.keys.filter((key) => !hasSlice(next, key))
  if (missingPriorKeys.length > 0 || nextRange.maxSlice < priorRange.maxSlice) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_SHRINK, 'blocker-resolution may not shrink or renumber campaign slices')
  }

  if (nextRange.maxSlice > LEGACY_MAX_SLICE && !nextAuthority.expanded) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED, 'campaign slice range exceeds Founder-authorized maximum')
  }
  if (priorRange.maxSlice > LEGACY_MAX_SLICE && !sameAuthority(field(previous, 'campaign_expansion_authority'), field(next, 'campaign_expansion_authority'))) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority cannot change during blocker-resolution')
  }

  if (nextRange.maxSlice > priorRange.maxSlice) {
    if (!nextAuthority.expanded || nextRange.maxSlice > nextAuthority.maxSlice) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED, 'campaign slice range exceeds Founder-authorized maximum')
    }
    const expectedNewKeys = expectedSliceKeys(nextRange.maxSlice).slice(priorRange.maxSlice)
    const actualNewKeys = nextRange.keys.slice(priorRange.maxSlice)
    if (!sameCampaignValue(expectedNewKeys, actualNewKeys)) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, 'new campaign slice keys must be appended contiguously')
    }
    if (
      rootValidationStatus(previous) === 'PENDING_IMPLEMENTATION' &&
      rootValidationStatus(next) !== 'PENDING_EXPANDED_IMPLEMENTATION'
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'expanded campaign requires PENDING_EXPANDED_IMPLEMENTATION root status')
    }
    if (
      rootValidationStatus(previous) !== 'PENDING_IMPLEMENTATION' &&
      rootValidationStatus(previous) !== rootValidationStatus(next)
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'campaign root validation status may not change during blocker-resolution expansion')
    }
    const newRows = validateNewExpansionRows(next, actualNewKeys)
    if (!newRows.valid) return newRows
  } else {
    if (!sameAuthority(field(previous, 'campaign_expansion_authority'), field(next, 'campaign_expansion_authority'))) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority is immutable during blocker-resolution')
    }
    if (rootValidationStatus(previous) !== rootValidationStatus(next)) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'campaign root validation status may not change during blocker-resolution')
    }
  }

  return validateBlockerResolutionSlices(previous, next, priorRange, options.blockerId)
}

export function validateCampaignTransition(
  previous: unknown,
  next: unknown,
  options: TransitionOptions = {},
): TransitionResult {
  const mode = options.mode ?? 'lifecycle'
  if (!isMapping(previous) || !isMapping(next)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, 'campaign transition requires two campaign mappings')
  }

  if (mode === 'blocker-resolution') {
    return validateCampaignBlockerResolutionTransition(previous, next, options)
  }

  const priorRange = inspectSliceRange(field(previous, 'slices'))
  if (!priorRange.valid) return priorRange

  const nextKeys = objectKeys(field(next, 'slices'))
  const nextCanonicalKeys = nextKeys.filter((key) => isCanonicalSliceKey(key))
  const nextRawMax = nextCanonicalKeys.length === 0 ? 0 : Math.max(...nextCanonicalKeys.map(Number))
  if (nextCanonicalKeys.length === nextKeys.length && nextRawMax < priorRange.maxSlice) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_SHRINK, 'campaign slice range cannot shrink')
  }
  const missingPriorKeys = priorRange.keys.filter((key) => !nextKeys.includes(key))
  if (missingPriorKeys.length > 0) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, 'existing campaign slice keys cannot be renumbered or replaced')
  }
  const nextRange = inspectSliceRange(field(next, 'slices'))
  if (!nextRange.valid) return nextRange

  const nextAuthority = validateCampaignExpansionAuthority(field(next, 'campaign_expansion_authority'), options.evidence ?? null)
  if (!nextAuthority.valid) return nextAuthority
  const priorAuthority = validateCampaignExpansionAuthority(field(previous, 'campaign_expansion_authority'), options.evidence ?? null)
  if (!priorAuthority.valid) return priorAuthority

  if (nextRange.maxSlice > LEGACY_MAX_SLICE && !nextAuthority.expanded) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED, 'campaign slice range exceeds Founder-authorized maximum')
  }

  if (mode === 'append') {
    if (nextRange.maxSlice <= priorRange.maxSlice) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED, 'append transition must add at least one campaign slice')
    }
    if (!nextAuthority.expanded || nextRange.maxSlice > nextAuthority.maxSlice) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED, 'campaign slice range exceeds Founder-authorized maximum')
    }
    if (priorRange.maxSlice > LEGACY_MAX_SLICE && !sameAuthority(field(previous, 'campaign_expansion_authority'), field(next, 'campaign_expansion_authority'))) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority cannot change during append-only expansion')
    }
    const expectedNewKeys = expectedSliceKeys(nextRange.maxSlice).slice(priorRange.maxSlice)
    const actualNewKeys = nextRange.keys.slice(priorRange.maxSlice)
    if (!sameCampaignValue(expectedNewKeys, actualNewKeys)) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, 'new campaign slice keys must be appended contiguously')
    }
    if (!sameExpansionRoot(previous, next)) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.EXPANSION_ROOT_MUTATION, 'campaign expansion may not mutate unrelated root fields')
    }
    if (
      rootValidationStatus(previous) === 'PENDING_IMPLEMENTATION' &&
      rootValidationStatus(next) !== 'PENDING_EXPANDED_IMPLEMENTATION'
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'expanded campaign requires PENDING_EXPANDED_IMPLEMENTATION root status')
    }
    if (
      rootValidationStatus(previous) !== 'PENDING_IMPLEMENTATION' &&
      rootValidationStatus(previous) !== rootValidationStatus(next)
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'campaign root validation status may not change during append-only expansion')
    }
    for (const key of priorRange.keys) {
      if (!sameCampaignValue(sliceAt(previous, key), sliceAt(next, key))) {
        if (field(sliceAt(previous, key), 'status') === 'DONE') {
          return invalid(CAMPAIGN_DIAGNOSTIC_CODES.COMPLETED_SLICE_MUTATION, `completed campaign slice ${key} cannot be changed`)
        }
        return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, `existing campaign slice ${key} cannot be replaced during expansion`)
      }
    }
    return validateNewExpansionRows(next, actualNewKeys)
  }

  if (mode !== 'lifecycle') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED, 'campaign transition mode is invalid')
  }
  if (nextRange.maxSlice !== priorRange.maxSlice) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED, 'lifecycle transition may not expand the campaign slice range')
  }
  if (!sameAuthority(field(previous, 'campaign_expansion_authority'), field(next, 'campaign_expansion_authority'))) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority is immutable during lifecycle projection')
  }
  if (!sameExpansionRoot(previous, next)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.EXPANSION_ROOT_MUTATION, 'lifecycle projection may not mutate unrelated root fields')
  }

  const differing = changedKeys(previous, next, priorRange.keys)
  if (differing.length === 0) return { valid: true }
  const targetSlice = options.targetSlice == null ? (differing.length === 1 ? differing[0] : null) : String(options.targetSlice)
  if (!targetSlice || differing.length !== 1 || differing[0] !== targetSlice) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, 'lifecycle projection may update only one selected campaign slice')
  }
  if (field(sliceAt(previous, targetSlice), 'status') === 'DONE') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.COMPLETED_SLICE_MUTATION, `completed campaign slice ${targetSlice} cannot be changed`)
  }
  return { valid: true }
}

export function selectNextCampaignAction(campaign: unknown): { slice: string | null; action: string; started: false } {
  const slices = field(campaign, 'slices')
  const range = inspectSliceRange(slices)
  if (!range.valid) return { slice: null, action: 'none on this campaign', started: false }
  const next = range.keys.find((key) => field(isMapping(slices) ? slices[key] : undefined, 'status') === 'NOT_STARTED')
  return {
    slice: next ?? null,
    action: next ? `Campaign slice ${next} is selected for a future bounded action.` : 'none on this campaign',
    started: false,
  }
}
