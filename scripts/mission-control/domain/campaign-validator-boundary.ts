import {
  CAMPAIGN_DIAGNOSTIC_CODES as AUTHORITY_DIAGNOSTIC_CODES,
  validateCampaignExpansionAuthority,
} from './campaign-authority.mjs'
import {
  INTERNAL_DESTINATION_PREFIXES,
  SLICE_REQUIRED_KEYS,
} from './campaign-enums.ts'
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
  blockerEvidenceSchema,
  campaignAuthorityEvidenceSchema,
  campaignExpansionAuthoritySchema,
} from './campaign-validator-schemas.ts'

export type BoundaryFailure = {
  valid: false
  reason: string
  code?: string
  classification?: string
}

export type ExpansionAuthorityResult =
  | { valid: true; expanded: boolean; maxSlice: number }
  | BoundaryFailure

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const normalizationReason = (result: { ok: boolean; reason?: string }) => result.reason ?? 'invalid value'

export function architectureAuthorityShapeFailure(authority: unknown): BoundaryFailure {
  if (!isRecord(authority)) return { valid: false, reason: 'architecture_authority must be a mapping' }
  const issue = normalizeNullableIssueRef(authority.issue)
  if (!issue.ok || issue.value == null) return { valid: false, reason: 'architecture_authority.issue is required' }
  if (typeof authority.comment_id !== 'string' || !/^[1-9]\d*$/.test(authority.comment_id)) {
    return { valid: false, reason: 'architecture_authority.comment_id must be a numeric comment id string' }
  }
  if (authority.target_contract_path !== 'scripts/architecture-contract.json') {
    return {
      valid: false,
      reason: 'architecture_authority.target_contract_path must be scripts/architecture-contract.json',
    }
  }
  return { valid: false, reason: 'architecture_authority must be a mapping' }
}

export function blockerEvidenceShapeFailure(value: unknown, blockerId: string): BoundaryFailure {
  if (!isRecord(value)) return { valid: false, reason: `campaign blocker ${blockerId} requires evidence` }
  const issue = normalizeNullableIssueRef(value.issue)
  const pr = normalizeNullablePrRef(value.pr)
  if (!issue.ok) return { valid: false, reason: normalizationReason(issue) }
  if (!pr.ok) return { valid: false, reason: normalizationReason(pr) }
  const commentIds = normalizeStringIdList(value.comment_ids ?? [], 'blocker evidence.comment_ids')
  if (!commentIds.ok) return { valid: false, reason: normalizationReason(commentIds) }
  return { valid: false, reason: `campaign blocker ${blockerId} requires evidence` }
}

export function campaignBlockerShapeFailure(value: unknown): BoundaryFailure {
  if (!isRecord(value)) return { valid: false, reason: 'campaign blocker entries must be mappings' }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    return { valid: false, reason: 'campaign blocker id is required' }
  }
  if (typeof value.summary !== 'string' || value.summary.length === 0) {
    return { valid: false, reason: `campaign blocker ${value.id} requires a summary` }
  }
  const evidence = value.evidence
  const evidenceResult = blockerEvidenceSchema.safeParse(evidence)
  if (!evidenceResult.success) return blockerEvidenceShapeFailure(evidence, value.id)
  if (typeof value.resolution_scope !== 'string' || value.resolution_scope.length === 0) {
    return { valid: false, reason: `campaign blocker ${value.id} requires resolution_scope` }
  }
  return { valid: false, reason: 'campaign blocker entries must be mappings' }
}

export function sliceShapeFailure(sliceInput: unknown, key: string): BoundaryFailure {
  if (!isRecord(sliceInput)) return { valid: false, reason: `slice ${key} must be a mapping` }
  const missing = SLICE_REQUIRED_KEYS.filter((field) => !Object.hasOwn(sliceInput, field))
  if (missing.length > 0) {
    return { valid: false, reason: `slice ${key} missing required field(s): ${missing.join(', ')}` }
  }
  const status = normalizeSliceStatus(sliceInput.status)
  if (!status.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(status)}` }
  const issue = normalizeNullableIssueRef(sliceInput.issue)
  const pr = normalizeNullablePrRef(sliceInput.pr)
  const reviewedHead = normalizeNullableCommitSha(sliceInput.reviewed_head)
  const mergedCommit = normalizeNullableCommitSha(sliceInput.merged_commit)
  if (!issue.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(issue)}` }
  if (!pr.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(pr)}` }
  if (!reviewedHead.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(reviewedHead)}` }
  if (!mergedCommit.ok) return { valid: false, reason: `slice ${key}: ${normalizationReason(mergedCommit)}` }
  const authorityIds = normalizeStringIdList(sliceInput.authority_comment_ids, `slice ${key} authority_comment_ids`)
  if (!authorityIds.ok) return { valid: false, reason: normalizationReason(authorityIds) }
  const blockerIds = normalizeStringIdList(sliceInput.blocker_ids, `slice ${key} blocker_ids`)
  if (!blockerIds.ok) return { valid: false, reason: normalizationReason(blockerIds) }
  return { valid: false, reason: `slice ${key} must be a mapping` }
}

export function rootScriptMapShapeFailure(rootScriptMapInput: unknown): BoundaryFailure {
  if (!isRecord(rootScriptMapInput)) return { valid: false, reason: 'root_script_map must be a mapping' }
  if (rootScriptMapInput.contract_path !== 'scripts/architecture-contract.json') {
    return { valid: false, reason: 'root_script_map.contract_path must be scripts/architecture-contract.json' }
  }
  const status = normalizeRootScriptMapValidationStatus(rootScriptMapInput.validation_status)
  if (!status.ok) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.ROOT_SCRIPT_MAP_STATUS_INVALID,
      reason: normalizationReason(status),
    }
  }
  return { valid: false, reason: 'root_script_map must be a mapping' }
}

export function rootScriptMappingRecordShapeFailure(recordInput: unknown): BoundaryFailure {
  if (!isRecord(recordInput)) return { valid: false, reason: 'root script mapping must be a mapping' }
  if (typeof recordInput.path !== 'string' || !/^scripts\/[^/]+\.(mjs|sh)$/.test(recordInput.path)) {
    return { valid: false, reason: 'root script path must be scripts/<file>.(mjs|sh)' }
  }
  const disposition = normalizeFacadeDisposition(recordInput.facade_disposition)
  if (!disposition.ok) return { valid: false, reason: normalizationReason(disposition) }
  if (typeof recordInput.internal_destination !== 'string' || recordInput.internal_destination.length === 0) {
    return { valid: false, reason: 'internal_destination is required' }
  }
  const internalDestination = recordInput.internal_destination
  if (!INTERNAL_DESTINATION_PREFIXES.some((prefix) => internalDestination.startsWith(prefix))) {
    return {
      valid: false,
      reason: `internal_destination must use destination vocabulary: ${INTERNAL_DESTINATION_PREFIXES.join(', ')}`,
    }
  }
  const migration = normalizeMigrationStatus(recordInput.migration_status)
  if (!migration.ok) return { valid: false, reason: normalizationReason(migration) }
  if (
    typeof recordInput.owning_slice !== 'number' ||
    !Number.isInteger(recordInput.owning_slice) ||
    recordInput.owning_slice < 1 ||
    recordInput.owning_slice > 7
  ) {
    return { valid: false, reason: 'owning_slice must be an integer 1–7' }
  }
  return { valid: false, reason: 'root script mapping must be a mapping' }
}

function authorityRelatedShapeFailure(value: unknown): BoundaryFailure {
  if (!Array.isArray(value) || value.length === 0) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      reason: 'related_authority_comment_ids must be a non-empty array',
    }
  }
  if (value.some((entry) => typeof entry !== 'string' || !/^[1-9]\d*$/.test(entry))) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      reason: 'related_authority_comment_ids entries must be decimal id strings',
    }
  }
  if (new Set(value).size !== value.length) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      reason: 'related_authority_comment_ids entries must be unique',
    }
  }
  return {
    valid: false,
    code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
    reason: 'related_authority_comment_ids entries must be decimal id strings',
  }
}

export function expansionAuthorityShapeFailure(
  authority: unknown,
  issues: readonly { path: readonly PropertyKey[] }[],
): BoundaryFailure {
  if (!isRecord(authority)) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      reason: 'campaign_expansion_authority must be a mapping',
      classification: 'STATE_CONFLICT',
    }
  }
  const path = issues[0]?.path ?? []
  if (path[0] === 'source') {
    const source = authority.source
    if (!isRecord(source) || source.kind !== 'github_issue_comment') {
      return {
        valid: false,
        code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
        reason: 'campaign expansion authority source must be a GitHub issue comment',
      }
    }
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      reason: 'campaign expansion authority source provenance is invalid',
    }
  }
  if (path[0] === 'authorized_max_slice') {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      reason: 'campaign expansion authority must authorize a slice beyond the legacy maximum',
    }
  }
  if (path[0] === 'authorized_append_keys') {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      reason: 'campaign expansion authority append keys must equal the authorized contiguous range',
    }
  }
  if (path[0] === 'related_authority_comment_ids') return authorityRelatedShapeFailure(authority.related_authority_comment_ids)
  if (['approved_base', 'policy_version', 'legacy_max_slice', 'append_only', 'protected_base_sha'].includes(String(path[0]))) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
      reason: 'campaign expansion authority base or policy binding is invalid',
    }
  }
  return {
    valid: false,
    code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_INVALID,
    reason: 'campaign expansion authority decision lineage is invalid',
  }
}

const validationFailure = (result: unknown, fallback: string): BoundaryFailure => {
  if (!isRecord(result)) return { valid: false, reason: fallback }
  return {
    valid: false,
    reason: typeof result.reason === 'string' ? result.reason : fallback,
    ...(typeof result.code === 'string' ? { code: result.code } : {}),
    ...(typeof result.classification === 'string' ? { classification: result.classification } : {}),
  }
}

export function validateExpansionAuthority(authority: unknown, evidence: unknown): ExpansionAuthorityResult {
  const parsedAuthority = campaignExpansionAuthoritySchema.safeParse(authority)
  if (!parsedAuthority.success) {
    const failure = expansionAuthorityShapeFailure(authority, parsedAuthority.error.issues)
    return failure.valid === false && failure.classification === undefined
      ? { ...failure, classification: 'STATE_CONFLICT' }
      : failure
  }
  if (parsedAuthority.data == null) {
    const result: unknown = validateCampaignExpansionAuthority(parsedAuthority.data, null)
    if (!isRecord(result)) return { valid: false, reason: 'campaign expansion authority validation failed' }
    if (result.valid !== true) return validationFailure(result, 'campaign expansion authority validation failed')
    if (typeof result.expanded !== 'boolean' || typeof result.maxSlice !== 'number') {
      return { valid: false, reason: 'campaign expansion authority validation failed' }
    }
    return { valid: true, expanded: result.expanded, maxSlice: result.maxSlice }
  }

  const parsedEvidence = campaignAuthorityEvidenceSchema.safeParse(evidence)
  if (!parsedEvidence.success) {
    return {
      valid: false,
      code: AUTHORITY_DIAGNOSTIC_CODES.AUTHORITY_UNAVAILABLE,
      reason: 'required live campaign expansion authority evidence is unavailable',
      classification: 'BLOCKED_EXTERNAL',
    }
  }

  const result: unknown = validateCampaignExpansionAuthority(parsedAuthority.data, parsedEvidence.data)
  if (!isRecord(result)) return { valid: false, reason: 'campaign expansion authority validation failed' }
  if (result.valid !== true) return validationFailure(result, 'campaign expansion authority validation failed')
  if (typeof result.expanded !== 'boolean' || typeof result.maxSlice !== 'number') {
    return { valid: false, reason: 'campaign expansion authority validation failed' }
  }
  return { valid: true, expanded: result.expanded, maxSlice: result.maxSlice }
}
