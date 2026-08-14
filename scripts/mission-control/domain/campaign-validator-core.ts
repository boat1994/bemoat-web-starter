/**
 * Pure campaign schema validator.
 * No GitHub, filesystem, process, or command execution.
 */
import {
  FULL_COMMIT_SHA,
  INTERNAL_DESTINATION_PREFIXES,
  SLICE_REQUIRED_KEYS,
} from './campaign-enums.ts'
import {
  CAMPAIGN_DIAGNOSTIC_CODES as AUTHORITY_DIAGNOSTIC_CODES,
  inspectSliceRange,
} from './campaign-authority.ts'
import {
  normalizeFacadeDisposition,
  normalizeMigrationStatus,
  normalizeNullableCommitSha,
  normalizeNullableIssueRef,
  normalizeNullablePrRef,
  normalizeRootScriptMapValidationStatus,
  normalizeSliceStatus,
  normalizeStringIdList,
} from './campaign-normalize.ts'
import {
  architectureAuthoritySchema,
  blockerEvidenceSchema,
  campaignBlockerSchema,
  campaignBlockersSchema,
  rootScriptMapSchema,
  rootScriptMappingRecordSchema,
  sliceSchema,
  slicesSchema,
  type ArchitectureAuthority,
  type CampaignBlocker,
  type CampaignInput,
  type RootScriptMap,
  type RootScriptMappingRecord,
  type Slice,
} from './campaign-validator-schemas.ts'
import {
  architectureAuthorityShapeFailure,
  campaignBlockerShapeFailure,
  rootScriptMapShapeFailure,
  rootScriptMappingRecordShapeFailure,
  sliceShapeFailure,
} from './campaign-validator-boundary.ts'

export type CampaignExpansionAuthority = { valid: true; expanded: boolean; maxSlice: number }
export type ValidationSuccess = { valid: true }
export type ValidationFailure = { valid: false; reason: string; code?: string; classification?: string }
export type ValidationResult = ValidationSuccess | ValidationFailure
export { validateExpansionAuthority } from './campaign-validator-boundary.ts'
export const normalizationReason = (result: { ok: boolean; reason?: string }) => result.reason ?? 'invalid value'
export const validationReason = (result: { valid: boolean; reason?: string }) => result.reason ?? 'validation failed'
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')
export function validationFailure(result: unknown, fallback: string): ValidationFailure {
  if (!isRecord(result)) return { valid: false, reason: fallback }
  const candidate = result
  return { valid: false, reason: typeof candidate.reason === 'string' ? candidate.reason : fallback,
    ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}), ...(typeof candidate.classification === 'string' ? { classification: candidate.classification } : {}) }
}
export function inspectSliceRangeResult(slices: Record<string, unknown>): { valid: true; keys: string[]; maxSlice: number } | ValidationFailure {
  const result: unknown = inspectSliceRange(slices)
  if (!isRecord(result)) return { valid: false, reason: 'campaign slices must be contiguous starting at "1"' }
  const candidate = result
  if (candidate.valid !== true) return validationFailure(result, 'campaign slices must be contiguous starting at "1"')
  if (!isStringArray(candidate.keys) || typeof candidate.maxSlice !== 'number') return { valid: false, reason: 'campaign slices must be contiguous starting at "1"' }
  return { valid: true, keys: candidate.keys, maxSlice: candidate.maxSlice }
}
export type CampaignValidationResult = { valid: boolean; campaign: CampaignInput | null; reason?: string; code?: string; classification?: string }
export type RootScriptMappingValidationResult = { valid: true; record: RootScriptMappingRecord } | { valid: false; reason: string }
export function validateArchitectureAuthority(authority: unknown): ValidationResult {
  const parsed = architectureAuthoritySchema.safeParse(authority)
  if (!parsed.success) {
    return architectureAuthorityShapeFailure(authority)
  }
  const value: ArchitectureAuthority = parsed.data
  const issue = normalizeNullableIssueRef(value.issue)
  if (!issue.ok || issue.value == null) {
    return { valid: false, reason: 'architecture_authority.issue is required' }
  }
  if (typeof value.comment_id !== 'string' || !/^[1-9]\d*$/.test(value.comment_id)) {
    return { valid: false, reason: 'architecture_authority.comment_id must be a numeric comment id string' }
  }
  if (
    typeof value.target_contract_path !== 'string' ||
    value.target_contract_path !== 'scripts/architecture-contract.json'
  ) {
    return {
      valid: false,
      reason: 'architecture_authority.target_contract_path must be scripts/architecture-contract.json',
    }
  }
  return { valid: true }
}
export function validateCampaignBlockers(
  blockers: unknown,
): { valid: true; ids: Set<string> } | ValidationFailure {
  const parsed = campaignBlockersSchema.safeParse(blockers)
  if (!parsed.success) {
    if (!Array.isArray(blockers)) return { valid: false, reason: 'campaign_blockers must be an array' }
    for (const blockerInput of blockers) {
      const blockerResult = campaignBlockerSchema.safeParse(blockerInput)
      if (!blockerResult.success) return campaignBlockerShapeFailure(blockerInput)
    }
    return { valid: false, reason: 'campaign_blockers must be an array' }
  }
  const ids = new Set<string>()
  for (const blockerInput of parsed.data) {
    const blockerResult = campaignBlockerSchema.safeParse(blockerInput)
    if (!blockerResult.success) {
      return { valid: false, reason: 'campaign blocker entries must be mappings' }
    }
    const blocker: CampaignBlocker = blockerResult.data
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
    const evidenceResult = blockerEvidenceSchema.safeParse(blocker.evidence)
    if (!evidenceResult.success) {
      return { valid: false, reason: `campaign blocker ${blocker.id} requires evidence` }
    }
    const evidenceIssue = normalizeNullableIssueRef(evidenceResult.data.issue)
    const evidencePr = normalizeNullablePrRef(evidenceResult.data.pr)
    if (!evidenceIssue.ok) return { valid: false, reason: normalizationReason(evidenceIssue) }
    if (!evidencePr.ok) return { valid: false, reason: normalizationReason(evidencePr) }
    if (evidenceIssue.value == null && evidencePr.value == null) {
      return { valid: false, reason: `campaign blocker ${blocker.id} evidence requires issue or pr` }
    }
    const commentIds = normalizeStringIdList(evidenceResult.data.comment_ids ?? [], 'blocker evidence.comment_ids')
    if (!commentIds.ok) return { valid: false, reason: normalizationReason(commentIds) }
    if (typeof blocker.resolution_scope !== 'string' || blocker.resolution_scope.length === 0) {
      return { valid: false, reason: `campaign blocker ${blocker.id} requires resolution_scope` }
    }
  }
  return { valid: true, ids }
}
export function validateSlice(
  sliceInput: unknown,
  key: string,
  blockerIds: Set<string>,
): { valid: true; slice: Slice } | ValidationFailure {
  const parsed = sliceSchema.safeParse(sliceInput)
  if (!parsed.success) {
    return sliceShapeFailure(sliceInput, key)
  }
  const slice: Slice = parsed.data
  const missing = SLICE_REQUIRED_KEYS.filter((field) => !Object.hasOwn(slice, field))
  if (missing.length > 0) {
    return { valid: false, reason: `slice ${key} missing required field(s): ${missing.join(', ')}` }
  }
  const status = normalizeSliceStatus(slice.status)
  if (!status.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(status)}` }
  const issue = normalizeNullableIssueRef(slice.issue)
  const pr = normalizeNullablePrRef(slice.pr)
  const reviewedHead = normalizeNullableCommitSha(slice.reviewed_head)
  const mergedCommit = normalizeNullableCommitSha(slice.merged_commit)
  if (!issue.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(issue)}` }
  if (!pr.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(pr)}` }
  if (!reviewedHead.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(reviewedHead)}` }
  if (!mergedCommit.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(mergedCommit)}` }
  const authorityIds = normalizeStringIdList(slice.authority_comment_ids, `slice ${key} authority_comment_ids`)
  if (!authorityIds.ok) return { valid: false, reason: normalizationReason(authorityIds) }
  const sliceBlockerIds = normalizeStringIdList(slice.blocker_ids, `slice ${key} blocker_ids`)
  if (!sliceBlockerIds.ok) return { valid: false, reason: normalizationReason(sliceBlockerIds) }
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
export function validateSlices(
  slicesInput: unknown,
  blockerIds: Set<string>,
  expansionAuthority: CampaignExpansionAuthority,
): { valid: true; slices: Record<string, Slice> } | ValidationFailure {
  const parsed = slicesSchema.safeParse(slicesInput)
  if (!parsed.success && !isRecord(slicesInput)) return { valid: false, reason: 'slices must be a mapping' }
  const slices: Record<string, unknown> = parsed.success
    ? parsed.data
    : isRecord(slicesInput)
      ? slicesInput
      : {}
  const range = inspectSliceRangeResult(slices)
  if (range.valid !== true) {
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
  const normalized: Record<string, Slice> = {}
  for (const key of range.keys) {
    const result = validateSlice(slices[key], key, blockerIds)
    if (result.valid !== true) return result
    normalized[key] = result.slice
  }
  return { valid: true, slices: normalized }
}
export function validateRootScriptMap(
  rootScriptMapInput: unknown,
  expansionAuthority: CampaignExpansionAuthority,
): { valid: true; root_script_map: RootScriptMap } | ValidationFailure {
  const parsed = rootScriptMapSchema.safeParse(rootScriptMapInput)
  if (!parsed.success) {
    return rootScriptMapShapeFailure(rootScriptMapInput)
  }
  const rootScriptMap: RootScriptMap = parsed.data
  if (rootScriptMap.contract_path !== 'scripts/architecture-contract.json') {
    return { valid: false, reason: 'root_script_map.contract_path must be scripts/architecture-contract.json' }
  }
  const status = normalizeRootScriptMapValidationStatus(rootScriptMap.validation_status)
  if (!status.ok) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID,
      reason: normalizationReason(status),
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
/** Structural validation for architecture-contract root-script records. */
export function validateRootScriptMappingRecord(recordInput: unknown): RootScriptMappingValidationResult {
  const parsed = rootScriptMappingRecordSchema.safeParse(recordInput)
  if (!parsed.success) {
    return rootScriptMappingRecordShapeFailure(recordInput)
  }
  const record: RootScriptMappingRecord = parsed.data
  if (typeof record.path !== 'string' || !/^scripts\/[^/]+\.(mjs|sh)$/.test(record.path)) {
    return { valid: false, reason: 'root script path must be scripts/<file>.(mjs|sh)' }
  }
  const disposition = normalizeFacadeDisposition(record.facade_disposition)
  if (!disposition.ok) return { valid: false, reason: normalizationReason(disposition) }
  if (typeof record.internal_destination !== 'string' || record.internal_destination.length === 0) {
    return { valid: false, reason: 'internal_destination is required' }
  }
  const internalDestination = record.internal_destination
  const allowedDestination =
    typeof internalDestination === 'string' &&
    INTERNAL_DESTINATION_PREFIXES.some((prefix) => internalDestination.startsWith(prefix))
  if (!allowedDestination) {
    return {
      valid: false,
      reason: `internal_destination must use destination vocabulary: ${INTERNAL_DESTINATION_PREFIXES.join(', ')}`,
    }
  }
  const migration = normalizeMigrationStatus(record.migration_status)
  if (!migration.ok) return { valid: false, reason: normalizationReason(migration) }
  if (
    typeof record.owning_slice !== 'number' ||
    !Number.isInteger(record.owning_slice) ||
    record.owning_slice < 1 ||
    record.owning_slice > 7
  ) {
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
