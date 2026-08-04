/**
 * Pure campaign expansion authority, range, and transition helpers.
 * No GitHub, filesystem, process, or command execution.
 */

import { createHash } from 'node:crypto'

import { FULL_COMMIT_SHA } from './campaign-enums.mjs'
import { sameCampaignValue } from './campaign-equality.mjs'

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

function invalid(code, reason, classification = 'STATE_CONFLICT') {
  return { valid: false, code, reason, classification }
}

function isMapping(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isDecimalId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isCanonicalSliceKey(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && String(Number(value)) === value
}

export function expectedSliceKeys(maxSlice) {
  return Array.from({ length: maxSlice }, (_, index) => String(index + 1))
}

export function sortedSliceKeys(slices) {
  return Object.keys(slices ?? {}).sort((left, right) => Number(left) - Number(right))
}

export function inspectSliceRange(slices) {
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

function normalizeStringList(value, fieldName, { allowEmpty = true } = {}) {
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

function validateAuthorityShape(authority) {
  if (!isMapping(authority)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign_expansion_authority must be a mapping')
  }
  if (authority.schema_version !== 1 || authority.decision !== 'APPROVED' || authority.scope !== 'campaign_slice_range' || authority.action !== 'append_only_expand') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority decision lineage is invalid')
  }
  if (!isMapping(authority.source) || authority.source.kind !== 'github_issue_comment') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority source must be a GitHub issue comment')
  }
  if (
    typeof authority.source.repository !== 'string' ||
    !/^[^/\s]+\/[^/\s]+$/.test(authority.source.repository) ||
    typeof authority.source.issue !== 'string' ||
    !/^#\d+$/.test(authority.source.issue) ||
    !isDecimalId(authority.source.comment_id) ||
    typeof authority.source.author_login !== 'string' ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(authority.source.author_login) ||
    !isSha256(authority.source.body_sha256)
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
  if (!Number.isInteger(authority.authorized_max_slice) || authority.authorized_max_slice < LEGACY_MAX_SLICE + 1) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority must authorize a slice beyond the legacy maximum')
  }

  const expectedAppendKeys = expectedSliceKeys(authority.authorized_max_slice).slice(LEGACY_MAX_SLICE)
  if (!Array.isArray(authority.authorized_append_keys) ||
      !sameCampaignValue(authority.authorized_append_keys, expectedAppendKeys)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority append keys must equal the authorized contiguous range')
  }

  const related = normalizeStringList(authority.related_authority_comment_ids, 'related_authority_comment_ids', { allowEmpty: false })
  if (!related.valid) return related

  return {
    valid: true,
    expectedAppendKeys,
  }
}

function commentAuthor(comment) {
  return comment?.user?.login ?? comment?.author_login ?? null
}

function commentIssueUrl(comment) {
  return comment?.issue_url ?? comment?.issue_url_html ?? null
}

function commentSupersedes(comment, commentId) {
  const body = String(comment?.body ?? '')
  if (!body.includes(String(commentId))) return false
  return /supersed|not authoritative|replaced|revoked/i.test(body)
}

function expectedIssueUrl(repository, issue) {
  return `https://api.github.com/repos/${repository}/issues/${String(issue).replace(/^#/, '')}`
}

function findAuthorityComments(evidence) {
  const envelope = evidence?.campaignExpansionAuthority
  if (!isMapping(envelope)) return null
  if (Array.isArray(envelope.comments)) return envelope.comments
  if (isMapping(envelope.comment)) return [envelope.comment]
  return null
}

export function verifyCampaignExpansionAuthority(authority, evidence = null) {
  const shape = validateAuthorityShape(authority)
  if (!shape.valid) return shape

  const comments = findAuthorityComments(evidence)
  const envelope = evidence?.campaignExpansionAuthority
  if (!comments || !Array.isArray(envelope.trustedFounderLogins) || typeof envelope.currentProtectedBaseSha !== 'string') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_UNAVAILABLE, 'required live campaign expansion authority evidence is unavailable', 'BLOCKED_EXTERNAL')
  }
  if (envelope.contradictory === true) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority evidence is contradictory')
  }

  const source = comments.find((comment) => String(comment?.id) === authority.source.comment_id)
  if (!source || typeof source.body !== 'string') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_UNAVAILABLE, 'campaign expansion authority source comment is unavailable', 'BLOCKED_EXTERNAL')
  }

  const sourceAuthor = commentAuthor(source)
  const sourceIssueUrl = commentIssueUrl(source)
  if (
    sourceAuthor !== authority.source.author_login ||
    !envelope.trustedFounderLogins.includes(sourceAuthor) ||
    sourceIssueUrl !== expectedIssueUrl(authority.source.repository, authority.source.issue)
  ) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority source identity does not match its binding')
  }

  const bodySha = createHash('sha256').update(source.body, 'utf8').digest('hex')
  if (bodySha !== authority.source.body_sha256) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_STALE, 'campaign expansion authority source comment body has changed')
  }
  if (!/CAMPAIGN EXPANSION/i.test(source.body) || !/APPEND SLICES/i.test(source.body)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority source comment is not an expansion decision')
  }
  if (
    envelope.superseded === true ||
    comments.some((comment) => String(comment?.id) !== authority.source.comment_id && commentSupersedes(comment, authority.source.comment_id))
  ) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_STALE, 'campaign expansion authority source comment is superseded')
  }
  if (envelope.currentProtectedBaseSha !== authority.protected_base_sha) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_STALE, 'campaign expansion authority protected base is no longer current')
  }

  for (const commentId of authority.related_authority_comment_ids) {
    const related = comments.find((comment) => String(comment?.id) === commentId)
    if (!related) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_UNAVAILABLE, `related campaign authority comment ${commentId} is unavailable`, 'BLOCKED_EXTERNAL')
    }
    if (commentAuthor(related) !== authority.source.author_login || commentIssueUrl(related) !== sourceIssueUrl) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, `related campaign authority comment ${commentId} has mismatched provenance`)
    }
  }

  return { valid: true, authority, maxSlice: authority.authorized_max_slice }
}

export function validateCampaignExpansionAuthority(authority, evidence = null) {
  if (authority == null) {
    return { valid: true, expanded: false, maxSlice: LEGACY_MAX_SLICE, authority: null }
  }
  const verified = verifyCampaignExpansionAuthority(authority, evidence)
  if (!verified.valid) return verified
  return { ...verified, expanded: true }
}

function copyWithout(value, keys) {
  const copy = { ...(value ?? {}) }
  for (const key of keys) delete copy[key]
  return copy
}

function sameExpansionRoot(left, right) {
  const leftRoot = copyWithout(left, ['campaign_expansion_authority', 'root_script_map', 'slices', 'updated_at', 'updated_by'])
  const rightRoot = copyWithout(right, ['campaign_expansion_authority', 'root_script_map', 'slices', 'updated_at', 'updated_by'])
  if (!sameCampaignValue(leftRoot, rightRoot)) return false

  const leftMap = copyWithout(left?.root_script_map, ['validation_status'])
  const rightMap = copyWithout(right?.root_script_map, ['validation_status'])
  return sameCampaignValue(leftMap, rightMap)
}

function sameAuthority(left, right) {
  return sameCampaignValue(left ?? null, right ?? null)
}

function sameBlockerResolutionRoot(left, right) {
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

  const leftMap = copyWithout(left?.root_script_map, ['validation_status'])
  const rightMap = copyWithout(right?.root_script_map, ['validation_status'])
  return sameCampaignValue(leftMap, rightMap)
}

function changedKeys(left, right, keys) {
  return keys.filter((key) => !sameCampaignValue(left?.slices?.[key], right?.slices?.[key]))
}

function validateNewExpansionRows(campaign, keys) {
  for (const key of keys) {
    const slice = campaign.slices[key]
    if (
      slice?.status !== 'NOT_STARTED' ||
      slice.issue != null ||
      slice.pr != null ||
      slice.reviewed_head != null ||
      slice.merged_commit != null ||
      !Array.isArray(slice.authority_comment_ids) ||
      slice.authority_comment_ids.length !== 0 ||
      !Array.isArray(slice.blocker_ids) ||
      slice.blocker_ids.length !== 0
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.EXPANSION_ROW_INVALID, `new campaign slice ${key} must be an empty NOT_STARTED row`)
    }
  }
  return { valid: true }
}

function validateExactBlockerRemoval(previous, next, blockerId) {
  if (typeof blockerId !== 'string' || blockerId.length === 0) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, 'blocker-resolution requires one exact blocker id')
  }
  if (!Array.isArray(previous.campaign_blockers) || !Array.isArray(next.campaign_blockers)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, 'campaign blocker bindings must be arrays')
  }
  const matches = previous.campaign_blockers.filter((blocker) => blocker?.id === blockerId)
  if (matches.length !== 1) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, `campaign blocker ${blockerId} is not bound exactly once`)
  }
  const expected = previous.campaign_blockers.filter((blocker) => blocker?.id !== blockerId)
  if (!sameCampaignValue(expected, next.campaign_blockers)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, 'blocker-resolution may remove only the exactly bound campaign blocker')
  }
  return { valid: true }
}

function validateBlockerResolutionSlices(previous, next, priorRange, blockerId) {
  for (const key of priorRange.keys) {
    const priorSlice = previous.slices[key]
    const nextSlice = next.slices[key]
    if (!nextSlice) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, `existing campaign slice ${key} cannot be replaced or removed`)
    }

    const priorWithoutBlockers = copyWithout(priorSlice, ['blocker_ids'])
    const nextWithoutBlockers = copyWithout(nextSlice, ['blocker_ids'])
    if (!sameCampaignValue(priorWithoutBlockers, nextWithoutBlockers)) {
      if (priorSlice?.status !== nextSlice?.status) {
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

    const priorBlockerIds = Array.isArray(priorSlice?.blocker_ids) ? priorSlice.blocker_ids : null
    const nextBlockerIds = Array.isArray(nextSlice?.blocker_ids) ? nextSlice.blocker_ids : null
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

export function validateCampaignBlockerResolutionTransition(previous, next, options = {}) {
  if (!isMapping(previous) || !isMapping(next)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.BLOCKER_BINDING_INVALID, 'blocker-resolution requires two campaign mappings')
  }

  const blockerRemoval = validateExactBlockerRemoval(previous, next, options.blockerId)
  if (!blockerRemoval.valid) return blockerRemoval

  const priorRange = inspectSliceRange(previous.slices)
  if (!priorRange.valid) return priorRange
  const nextRange = inspectSliceRange(next.slices)
  if (!nextRange.valid) return nextRange

  const nextAuthority = validateCampaignExpansionAuthority(next.campaign_expansion_authority, options.evidence ?? null)
  if (!nextAuthority.valid) return nextAuthority
  const priorAuthority = validateCampaignExpansionAuthority(previous.campaign_expansion_authority, options.evidence ?? null)
  if (!priorAuthority.valid) return priorAuthority

  if (!sameBlockerResolutionRoot(previous, next)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.EXPANSION_ROOT_MUTATION, 'blocker-resolution may not mutate unrelated campaign root fields')
  }
  if (
    previous.campaign_lifecycle !== next.campaign_lifecycle &&
    !(previous.campaign_lifecycle === 'BLOCKED' && next.campaign_lifecycle === 'ACTIVE')
  ) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.EXPANSION_ROOT_MUTATION, 'blocker-resolution may only clear the blocking campaign lifecycle')
  }

  const missingPriorKeys = priorRange.keys.filter((key) => !Object.hasOwn(next.slices, key))
  if (missingPriorKeys.length > 0 || nextRange.maxSlice < priorRange.maxSlice) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_SHRINK, 'blocker-resolution may not shrink or renumber campaign slices')
  }

  if (nextRange.maxSlice > LEGACY_MAX_SLICE && !nextAuthority.expanded) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED, 'campaign slice range exceeds Founder-authorized maximum')
  }
  if (priorRange.maxSlice > LEGACY_MAX_SLICE && !sameAuthority(previous.campaign_expansion_authority, next.campaign_expansion_authority)) {
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
      previous.root_script_map?.validation_status === 'PENDING_IMPLEMENTATION' &&
      next.root_script_map?.validation_status !== 'PENDING_EXPANDED_IMPLEMENTATION'
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'expanded campaign requires PENDING_EXPANDED_IMPLEMENTATION root status')
    }
    if (
      previous.root_script_map?.validation_status !== 'PENDING_IMPLEMENTATION' &&
      previous.root_script_map?.validation_status !== next.root_script_map?.validation_status
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'campaign root validation status may not change during blocker-resolution expansion')
    }
    const newRows = validateNewExpansionRows(next, actualNewKeys)
    if (!newRows.valid) return newRows
  } else {
    if (!sameAuthority(previous.campaign_expansion_authority, next.campaign_expansion_authority)) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.AUTHORITY_INVALID, 'campaign expansion authority is immutable during blocker-resolution')
    }
    if (previous.root_script_map?.validation_status !== next.root_script_map?.validation_status) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'campaign root validation status may not change during blocker-resolution')
    }
  }

  return validateBlockerResolutionSlices(previous, next, priorRange, options.blockerId)
}

export function validateCampaignTransition(previous, next, options = {}) {
  const mode = options.mode ?? 'lifecycle'
  if (!isMapping(previous) || !isMapping(next)) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, 'campaign transition requires two campaign mappings')
  }

  if (mode === 'blocker-resolution') {
    return validateCampaignBlockerResolutionTransition(previous, next, options)
  }

  const priorRange = inspectSliceRange(previous.slices)
  if (!priorRange.valid) return priorRange

  const nextKeys = Object.keys(next.slices ?? {})
  const nextCanonicalKeys = nextKeys.filter((key) => isCanonicalSliceKey(key))
  const nextRawMax = nextCanonicalKeys.length === 0 ? 0 : Math.max(...nextCanonicalKeys.map(Number))
  if (nextCanonicalKeys.length === nextKeys.length && nextRawMax < priorRange.maxSlice) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_SHRINK, 'campaign slice range cannot shrink')
  }
  const missingPriorKeys = priorRange.keys.filter((key) => !nextKeys.includes(key))
  if (missingPriorKeys.length > 0) {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.RANGE_RENUMBERED, 'existing campaign slice keys cannot be renumbered or replaced')
  }
  const nextRange = inspectSliceRange(next.slices)
  if (!nextRange.valid) return nextRange

  const nextAuthority = validateCampaignExpansionAuthority(next.campaign_expansion_authority, options.evidence ?? null)
  if (!nextAuthority.valid) return nextAuthority
  const priorAuthority = validateCampaignExpansionAuthority(previous.campaign_expansion_authority, options.evidence ?? null)
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
    if (priorRange.maxSlice > LEGACY_MAX_SLICE && !sameAuthority(previous.campaign_expansion_authority, next.campaign_expansion_authority)) {
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
      previous.root_script_map?.validation_status === 'PENDING_IMPLEMENTATION' &&
      next.root_script_map?.validation_status !== 'PENDING_EXPANDED_IMPLEMENTATION'
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'expanded campaign requires PENDING_EXPANDED_IMPLEMENTATION root status')
    }
    if (
      previous.root_script_map?.validation_status !== 'PENDING_IMPLEMENTATION' &&
      previous.root_script_map?.validation_status !== next.root_script_map?.validation_status
    ) {
      return invalid(CAMPAIGN_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID, 'campaign root validation status may not change during append-only expansion')
    }
    for (const key of priorRange.keys) {
      if (!sameCampaignValue(previous.slices[key], next.slices[key])) {
        if (previous.slices[key]?.status === 'DONE') {
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
  if (!sameAuthority(previous.campaign_expansion_authority, next.campaign_expansion_authority)) {
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
  if (previous.slices[targetSlice]?.status === 'DONE') {
    return invalid(CAMPAIGN_DIAGNOSTIC_CODES.COMPLETED_SLICE_MUTATION, `completed campaign slice ${targetSlice} cannot be changed`)
  }
  return { valid: true }
}

export function selectNextCampaignAction(campaign) {
  const range = inspectSliceRange(campaign?.slices)
  if (!range.valid) return { slice: null, action: 'none on this campaign', started: false }
  const next = range.keys.find((key) => campaign.slices[key]?.status === 'NOT_STARTED')
  return {
    slice: next ?? null,
    action: next ? `Campaign slice ${next} is selected for a future bounded action.` : 'none on this campaign',
    started: false,
  }
}
