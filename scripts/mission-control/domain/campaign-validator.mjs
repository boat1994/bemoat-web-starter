/**
 * Pure campaign schema validator.
 * No GitHub, filesystem, process, or command execution.
 */

import {
  CAMPAIGN_REQUIRED_KEYS,
  FULL_COMMIT_SHA,
  INTERNAL_DESTINATION_PREFIXES,
  SLICE_REQUIRED_KEYS,
} from './campaign-enums.ts'
import {
  CAMPAIGN_DIAGNOSTIC_CODES as AUTHORITY_DIAGNOSTIC_CODES,
  inspectSliceRange,
  validateCampaignExpansionAuthority,
} from './campaign-authority.mjs'
import {
  normalizeCampaignLifecycle,
  normalizeFacadeDisposition,
  normalizeMigrationStatus,
  normalizeNullableCommitSha,
  normalizeNullableIssueRef,
  normalizeNullablePrRef,
  normalizeRootScriptMapValidationStatus,
  normalizeSliceStatus,
  normalizeStringIdList,
} from './campaign-normalize.mjs'

/**
 * @param {unknown} authority
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
function validateArchitectureAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    return { valid: false, reason: 'architecture_authority must be a mapping' }
  }
  const issue = normalizeNullableIssueRef(authority.issue)
  if (!issue.ok || issue.value == null) {
    return { valid: false, reason: 'architecture_authority.issue is required' }
  }
  if (typeof authority.comment_id !== 'string' || !/^[1-9]\d*$/.test(authority.comment_id)) {
    return { valid: false, reason: 'architecture_authority.comment_id must be a numeric comment id string' }
  }
  if (
    typeof authority.target_contract_path !== 'string' ||
    authority.target_contract_path !== 'scripts/architecture-contract.json'
  ) {
    return {
      valid: false,
      reason: 'architecture_authority.target_contract_path must be scripts/architecture-contract.json',
    }
  }
  return { valid: true }
}

/**
 * @param {unknown} blockers
 * @returns {{ valid: true, ids: Set<string> } | { valid: false, reason: string }}
 */
function validateCampaignBlockers(blockers) {
  if (!Array.isArray(blockers)) {
    return { valid: false, reason: 'campaign_blockers must be an array' }
  }

  const ids = new Set()
  for (const blocker of blockers) {
    if (!blocker || typeof blocker !== 'object' || Array.isArray(blocker)) {
      return { valid: false, reason: 'campaign blocker entries must be mappings' }
    }
    if (typeof blocker.id !== 'string' || blocker.id.length === 0) {
      return { valid: false, reason: 'campaign blocker id is required' }
    }
    if (ids.has(blocker.id)) {
      return { valid: false, reason: `duplicate campaign blocker id: ${blocker.id}` }
    }
    ids.add(blocker.id)
    if (typeof blocker.summary !== 'string' || blocker.summary.length === 0) {
      return { valid: false, reason: `campaign blocker ${blocker.id} requires a summary` }
    }
    if (!blocker.evidence || typeof blocker.evidence !== 'object' || Array.isArray(blocker.evidence)) {
      return { valid: false, reason: `campaign blocker ${blocker.id} requires evidence` }
    }
    const evidenceIssue = normalizeNullableIssueRef(blocker.evidence.issue)
    const evidencePr = normalizeNullablePrRef(blocker.evidence.pr)
    if (!evidenceIssue.ok) return { valid: false, reason: evidenceIssue.reason }
    if (!evidencePr.ok) return { valid: false, reason: evidencePr.reason }
    if (evidenceIssue.value == null && evidencePr.value == null) {
      return { valid: false, reason: `campaign blocker ${blocker.id} evidence requires issue or pr` }
    }
    const commentIds = normalizeStringIdList(blocker.evidence.comment_ids ?? [], 'blocker evidence.comment_ids')
    if (!commentIds.ok) return { valid: false, reason: commentIds.reason }
    if (typeof blocker.resolution_scope !== 'string' || blocker.resolution_scope.length === 0) {
      return { valid: false, reason: `campaign blocker ${blocker.id} requires resolution_scope` }
    }
  }

  return { valid: true, ids }
}

/**
 * @param {Record<string, unknown>} slice
 * @param {string} key
 * @param {Set<string>} blockerIds
 * @returns {{ valid: true, slice: Record<string, unknown> } | { valid: false, reason: string }}
 */
function validateSlice(slice, key, blockerIds) {
  if (!slice || typeof slice !== 'object' || Array.isArray(slice)) {
    return { valid: false, reason: `slice ${key} must be a mapping` }
  }

  const missing = SLICE_REQUIRED_KEYS.filter((field) => !Object.hasOwn(slice, field))
  if (missing.length > 0) {
    return { valid: false, reason: `slice ${key} missing required field(s): ${missing.join(', ')}` }
  }

  const status = normalizeSliceStatus(slice.status)
  if (!status.ok) return { valid: false, reason: `slice ${key}: ${status.reason}` }

  const issue = normalizeNullableIssueRef(slice.issue)
  const pr = normalizeNullablePrRef(slice.pr)
  const reviewedHead = normalizeNullableCommitSha(slice.reviewed_head)
  const mergedCommit = normalizeNullableCommitSha(slice.merged_commit)
  if (!issue.ok) return { valid: false, reason: `slice ${key}: ${issue.reason}` }
  if (!pr.ok) return { valid: false, reason: `slice ${key}: ${pr.reason}` }
  if (!reviewedHead.ok) return { valid: false, reason: `slice ${key}: ${reviewedHead.reason}` }
  if (!mergedCommit.ok) return { valid: false, reason: `slice ${key}: ${mergedCommit.reason}` }

  const authorityIds = normalizeStringIdList(slice.authority_comment_ids, `slice ${key} authority_comment_ids`)
  if (!authorityIds.ok) return { valid: false, reason: authorityIds.reason }
  const sliceBlockerIds = normalizeStringIdList(slice.blocker_ids, `slice ${key} blocker_ids`)
  if (!sliceBlockerIds.ok) return { valid: false, reason: sliceBlockerIds.reason }

  for (const blockerId of sliceBlockerIds.value) {
    if (!blockerIds.has(blockerId)) {
      return {
        valid: false,
        reason: `slice ${key} blocker_ids reference undeclared campaign blocker: ${blockerId}`,
      }
    }
  }

  const normalized = {
    ...slice,
    status: status.value,
    issue: issue.value,
    pr: pr.value,
    reviewed_head: reviewedHead.value,
    merged_commit: mergedCommit.value,
    authority_comment_ids: authorityIds.value,
    blocker_ids: sliceBlockerIds.value,
  }

  if (status.value === 'DONE') {
    if (
      normalized.issue == null ||
      normalized.pr == null ||
      normalized.reviewed_head == null ||
      normalized.merged_commit == null
    ) {
      return {
        valid: false,
        reason: `slice ${key} DONE requires issue, pr, reviewed_head, and merged_commit`,
      }
    }
    if (!FULL_COMMIT_SHA.test(normalized.merged_commit) || !FULL_COMMIT_SHA.test(normalized.reviewed_head)) {
      return { valid: false, reason: `slice ${key} DONE requires exact full commit SHAs` }
    }
  }

  if (status.value === 'ELIGIBLE_FOR_FOUNDER_REVIEW') {
    if (normalized.issue == null || normalized.pr == null || normalized.reviewed_head == null) {
      return {
        valid: false,
        reason: `slice ${key} ELIGIBLE_FOR_FOUNDER_REVIEW requires issue, pr, and reviewed_head`,
      }
    }
    if (normalized.authority_comment_ids.length === 0) {
      return {
        valid: false,
        reason: `slice ${key} ELIGIBLE_FOR_FOUNDER_REVIEW requires authoritative review verdict comment id(s)`,
      }
    }
  }

  if (status.value === 'BLOCKED' && normalized.blocker_ids.length === 0) {
    return { valid: false, reason: `slice ${key} BLOCKED requires at least one blocker id` }
  }

  if (status.value === 'NOT_STARTED') {
    const hasDeliveryEvidence =
      normalized.pr != null || normalized.reviewed_head != null || normalized.merged_commit != null
    if (hasDeliveryEvidence) {
      return {
        valid: false,
        reason: `slice ${key} NOT_STARTED must not carry delivery evidence unless explicitly planning-only`,
      }
    }
  }

  return { valid: true, slice: normalized }
}

/**
 * @param {unknown} slices
 * @param {Set<string>} blockerIds
 * @returns {{ valid: true, slices: Record<string, unknown> } | { valid: false, reason: string }}
 */
function validateSlices(slices, blockerIds, expansionAuthority) {
  if (!slices || typeof slices !== 'object' || Array.isArray(slices)) {
    return { valid: false, reason: 'slices must be a mapping' }
  }

  const range = inspectSliceRange(slices)
  if (!range.valid) {
    if (expansionAuthority.expanded) return range
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.SLICE_KEYS_NOT_CONTIGUOUS,
      reason: 'slices must contain keys "1" through "7" exactly once',
    }
  }
  if (!expansionAuthority.expanded && range.maxSlice > 7) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED,
      reason: 'campaign slice range exceeds Founder-authorized maximum',
    }
  }
  if (!expansionAuthority.expanded && range.maxSlice < 7) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.RANGE_SHRINK,
      reason: 'legacy campaign slice range must contain keys "1" through "7" exactly once',
    }
  }
  if (expansionAuthority.expanded && range.maxSlice < 8) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED,
      reason: 'campaign expansion authority requires an expanded slice range',
    }
  }
  if (expansionAuthority.expanded && range.maxSlice > expansionAuthority.maxSlice) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.RANGE_UNAUTHORIZED,
      reason: 'campaign slice range exceeds Founder-authorized maximum',
    }
  }

  const normalized = {}
  for (const key of range.keys) {
    const result = validateSlice(slices[key], key, blockerIds)
    if (!result.valid) return result
    normalized[key] = result.slice
  }
  return { valid: true, slices: normalized }
}

/**
 * @param {unknown} rootScriptMap
 * @returns {{ valid: true, root_script_map: Record<string, unknown> } | { valid: false, reason: string }}
 */
function validateRootScriptMap(rootScriptMap, expansionAuthority) {
  if (!rootScriptMap || typeof rootScriptMap !== 'object' || Array.isArray(rootScriptMap)) {
    return { valid: false, reason: 'root_script_map must be a mapping' }
  }
  if (rootScriptMap.contract_path !== 'scripts/architecture-contract.json') {
    return { valid: false, reason: 'root_script_map.contract_path must be scripts/architecture-contract.json' }
  }
  const status = normalizeRootScriptMapValidationStatus(rootScriptMap.validation_status)
  if (!status.ok) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID,
      reason: status.reason,
    }
  }
  if (expansionAuthority.expanded && status.value === 'PENDING_IMPLEMENTATION') {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID,
      reason: 'expanded campaign cannot use PENDING_IMPLEMENTATION root status',
    }
  }
  if (!expansionAuthority.expanded && status.value === 'PENDING_EXPANDED_IMPLEMENTATION') {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID,
      reason: 'PENDING_EXPANDED_IMPLEMENTATION requires an authority-backed expanded range',
    }
  }
  return {
    valid: true,
    root_script_map: {
      ...rootScriptMap,
      validation_status: status.value,
    },
  }
}

/**
 * Structural validation for architecture-contract root-script records.
 * @param {unknown} record
 * @returns {{ valid: true, record: Record<string, unknown> } | { valid: false, reason: string }}
 */
export function validateRootScriptMappingRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, reason: 'root script mapping must be a mapping' }
  }
  if (typeof record.path !== 'string' || !/^scripts\/[^/]+\.(mjs|sh)$/.test(record.path)) {
    return { valid: false, reason: 'root script path must be scripts/<file>.(mjs|sh)' }
  }
  const disposition = normalizeFacadeDisposition(record.facade_disposition)
  if (!disposition.ok) return { valid: false, reason: disposition.reason }
  if (typeof record.internal_destination !== 'string' || record.internal_destination.length === 0) {
    return { valid: false, reason: 'internal_destination is required' }
  }
  const allowedDestination = INTERNAL_DESTINATION_PREFIXES.some((prefix) =>
    record.internal_destination.startsWith(prefix),
  )
  if (!allowedDestination) {
    return {
      valid: false,
      reason: `internal_destination must use destination vocabulary: ${INTERNAL_DESTINATION_PREFIXES.join(', ')}`,
    }
  }
  const migration = normalizeMigrationStatus(record.migration_status)
  if (!migration.ok) return { valid: false, reason: migration.reason }
  if (!Number.isInteger(record.owning_slice) || record.owning_slice < 1 || record.owning_slice > 7) {
    return { valid: false, reason: 'owning_slice must be an integer 1–7' }
  }
  return {
    valid: true,
    record: {
      path: record.path,
      facade_disposition: disposition.value,
      internal_destination: record.internal_destination,
      owning_slice: record.owning_slice,
      migration_status: migration.value,
    },
  }
}

/**
 * Optional external evidence checks (still pure: caller injects evidence object).
 * @param {Record<string, unknown>} campaign
 * @param {{ approvedBaseMergedCommits?: Record<string, boolean>, contradictory?: boolean, stale?: boolean } | null} evidence
 * @returns {{ valid: true } | { valid: false, reason: string, classification?: string }}
 */
export function validateCampaignEvidence(campaign, evidence = null) {
  if (!evidence) return { valid: true }
  if (evidence.contradictory) {
    return { valid: false, reason: 'contradictory campaign evidence', classification: 'STATE_CONFLICT' }
  }
  if (evidence.stale) {
    return { valid: false, reason: 'stale campaign evidence', classification: 'STATE_CONFLICT' }
  }
  if (evidence.unavailable) {
    return { valid: false, reason: 'required campaign evidence unavailable', classification: 'BLOCKED_EXTERNAL' }
  }

  const slices = campaign.slices
  if (slices && typeof slices === 'object' && Object.hasOwn(evidence, 'approvedBaseMergedCommits')) {
    for (const key of Object.keys(slices).sort((left, right) => Number(left) - Number(right))) {
      const slice = slices[key]
      if (!slice || slice.status !== 'DONE') continue
      const proof = evidence.approvedBaseMergedCommits?.[slice.merged_commit]
      if (proof !== true) {
        return {
          valid: false,
          reason: `slice ${key} DONE lacks proof that merged_commit is on approved_base`,
          classification: 'STATE_CONFLICT',
        }
      }
    }
  }

  return { valid: true }
}

/**
 * @param {unknown} campaign
 * @param {{ evidence?: object } } [options]
 * @returns {{ valid: boolean, reason?: string, classification?: string, campaign: Record<string, unknown> | null }}
 */
export function validateCampaign(campaign, options = {}) {
  if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) {
    return { valid: false, reason: 'campaign root must be a mapping', campaign: null }
  }

  const missing = CAMPAIGN_REQUIRED_KEYS.filter((key) => !Object.hasOwn(campaign, key))
  if (missing.length > 0) {
    return { valid: false, reason: `missing required campaign key(s): ${missing.join(', ')}`, campaign: null }
  }

  if (campaign.schema_version !== 1) {
    return {
      valid: false,
      reason: 'unsupported campaign schema_version',
      classification: 'STATE_MIGRATION_REQUIRED',
      campaign: null,
    }
  }

  const lifecycle = normalizeCampaignLifecycle(campaign.campaign_lifecycle)
  if (!lifecycle.ok) return { valid: false, reason: lifecycle.reason, campaign: null }

  const campaignIssue = normalizeNullableIssueRef(campaign.campaign_issue)
  if (!campaignIssue.ok || campaignIssue.value == null) {
    return { valid: false, reason: 'campaign_issue is required', campaign: null }
  }

  if (typeof campaign.approved_base !== 'string' || campaign.approved_base.length === 0) {
    return { valid: false, reason: 'approved_base is required', campaign: null }
  }
  if (typeof campaign.next_permitted_action !== 'string' || campaign.next_permitted_action.trim().length === 0) {
    return { valid: false, reason: 'next_permitted_action must be exactly one non-empty action', campaign: null }
  }
  if (typeof campaign.updated_at !== 'string' || campaign.updated_at.length === 0) {
    return { valid: false, reason: 'updated_at is required', campaign: null }
  }
  if (typeof campaign.updated_by !== 'string' || campaign.updated_by.length === 0) {
    return { valid: false, reason: 'updated_by is required', campaign: null }
  }

  const authority = validateArchitectureAuthority(campaign.architecture_authority)
  if (!authority.valid) return { valid: false, reason: authority.reason, campaign: null }

  const expansionAuthority = validateCampaignExpansionAuthority(campaign.campaign_expansion_authority, options.evidence ?? null)
  if (!expansionAuthority.valid) {
    return {
      valid: false,
      code: expansionAuthority.code,
      reason: expansionAuthority.reason,
      classification: expansionAuthority.classification,
      campaign: null,
    }
  }

  const blockers = validateCampaignBlockers(campaign.campaign_blockers)
  if (!blockers.valid) return { valid: false, reason: blockers.reason, campaign: null }

  const slices = validateSlices(campaign.slices, blockers.ids, expansionAuthority)
  if (!slices.valid) return {
    valid: false,
    code: slices.code,
    reason: slices.reason,
    classification: slices.classification ?? 'STATE_CONFLICT',
    campaign: null,
  }

  const rootScriptMap = validateRootScriptMap(campaign.root_script_map, expansionAuthority)
  if (!rootScriptMap.valid) return {
    valid: false,
    code: rootScriptMap.code,
    reason: rootScriptMap.reason,
    classification: rootScriptMap.classification ?? 'STATE_CONFLICT',
    campaign: null,
  }

  const normalized = {
    ...campaign,
    schema_version: 1,
    campaign_issue: campaignIssue.value,
    campaign_lifecycle: lifecycle.value,
    slices: slices.slices,
    root_script_map: rootScriptMap.root_script_map,
  }

  const evidence = validateCampaignEvidence(normalized, options.evidence ?? null)
  if (!evidence.valid) {
    return {
      valid: false,
      reason: evidence.reason,
      classification: evidence.classification,
      campaign: null,
    }
  }

  return { valid: true, campaign: normalized }
}
