/**
 * Pure campaign schema validator.
 * No GitHub, filesystem, process, or command execution.
 */

import {
  CAMPAIGN_REQUIRED_KEYS,
} from './campaign-enums.ts'
import {
  normalizeCampaignLifecycle,
  normalizeNullableIssueRef,
} from './campaign-normalize.ts'
import {
  normalizationReason,
  validationReason,
  validateArchitectureAuthority,
  validateCampaignBlockers,
  validateExpansionAuthority,
  validateRootScriptMap,
  validateSlices,
  type CampaignValidationResult,
  type ValidationResult,
} from './campaign-validator-core.ts'
import {
  approvedBaseMergedCommitsSchema,
  campaignAuthorityEvidenceSchema,
  campaignBoundarySchema,
  campaignBlockersSchema,
  campaignEvidenceSchema,
  campaignExpansionAuthoritySchema,
  campaignOptionsSchema,
  sliceSchema,
  slicesSchema,
  type CampaignEvidence,
  type CampaignInput,
} from './campaign-validator-schemas.ts'

export type { CampaignValidationResult, RootScriptMappingValidationResult } from './campaign-validator-core.ts'
export { validateRootScriptMappingRecord } from './campaign-validator-core.ts'
export {
  campaignBoundarySchema,
  campaignAuthorityEvidenceSchema,
  campaignEvidenceSchema,
  campaignExpansionAuthoritySchema,
  campaignBlockersSchema,
  sliceSchema,
  slicesSchema,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function campaignFailure(result: {
  valid: false
  reason: string
  code?: string
  classification?: string
}): CampaignValidationResult {
  return {
    valid: false,
    reason: result.reason,
    ...(result.code ? { code: result.code } : {}),
    ...(result.classification ? { classification: result.classification } : {}),
    campaign: null,
  }
}

function boundaryFailure(
  campaignInput: unknown,
  optionsInput: unknown,
  path: readonly PropertyKey[],
): CampaignValidationResult {
  if (!isRecord(campaignInput)) return { valid: false, reason: 'campaign root must be a mapping', campaign: null }
  const field = String(path[0] ?? '')
  if (field === 'schema_version') {
    return {
      valid: false,
      reason: 'unsupported campaign schema_version',
      classification: 'STATE_MIGRATION_REQUIRED',
      campaign: null,
    }
  }
  if (field === 'campaign_lifecycle') {
    return { valid: false, reason: 'campaign_lifecycle must be PLANNING, ACTIVE, BLOCKED, or COMPLETE', campaign: null }
  }
  if (field === 'campaign_issue') return { valid: false, reason: 'campaign_issue is required', campaign: null }
  if (field === 'approved_base') return { valid: false, reason: 'approved_base is required', campaign: null }
  if (field === 'next_permitted_action') {
    return { valid: false, reason: 'next_permitted_action must be exactly one non-empty action', campaign: null }
  }
  if (field === 'updated_at') return { valid: false, reason: 'updated_at is required', campaign: null }
  if (field === 'updated_by') return { valid: false, reason: 'updated_by is required', campaign: null }
  if (field === 'architecture_authority') {
    const result = validateArchitectureAuthority(campaignInput.architecture_authority)
    return result.valid === true ? { valid: false, reason: 'architecture_authority must be a mapping', campaign: null } : campaignFailure(result)
  }

  const optionsResult = campaignOptionsSchema.safeParse(optionsInput)
  if (!optionsResult.success) {
    return { valid: false, reason: 'campaign validation options must be a mapping', campaign: null }
  }
  const evidenceInput = optionsResult.data.evidence ?? null

  if (field === 'campaign_expansion_authority') {
    const result = validateExpansionAuthority(campaignInput.campaign_expansion_authority, evidenceInput)
    return result.valid === true
      ? { valid: false, reason: 'campaign expansion authority validation failed', campaign: null }
      : campaignFailure(result)
  }

  const blockers = validateCampaignBlockers(campaignInput.campaign_blockers)
  if (blockers.valid !== true) return campaignFailure(blockers)
  const expansionAuthority = validateExpansionAuthority(campaignInput.campaign_expansion_authority, evidenceInput)
  if (expansionAuthority.valid !== true) return campaignFailure(expansionAuthority)

  if (field === 'campaign_blockers') {
    return { valid: false, reason: 'campaign_blockers must be an array', campaign: null }
  }
  if (field === 'slices') {
    const result = validateSlices(campaignInput.slices, blockers.ids, expansionAuthority)
    return result.valid === true
      ? { valid: false, reason: 'slices must be a mapping', classification: 'STATE_CONFLICT', campaign: null }
      : { ...campaignFailure(result), classification: result.classification ?? 'STATE_CONFLICT' }
  }
  if (field === 'root_script_map') {
    const result = validateRootScriptMap(campaignInput.root_script_map, expansionAuthority)
    return result.valid === true
      ? { valid: false, reason: 'root_script_map must be a mapping', classification: 'STATE_CONFLICT', campaign: null }
      : { ...campaignFailure(result), classification: result.classification ?? 'STATE_CONFLICT' }
  }
  return { valid: false, reason: 'campaign root must be a mapping', campaign: null }
}

/** Optional external evidence checks (still pure: caller injects evidence object). */
export function validateCampaignEvidence(campaignInput: unknown, evidenceInput: unknown = null): ValidationResult {
  const evidenceResult = campaignEvidenceSchema.safeParse(evidenceInput)
  if (!evidenceInput) return { valid: true }
  if (!evidenceResult.success) {
    return { valid: false, reason: 'campaign evidence must be a mapping', classification: 'STATE_CONFLICT' }
  }
  const evidence: CampaignEvidence = evidenceResult.data
  if (evidence.contradictory) {
    return { valid: false, reason: 'contradictory campaign evidence', classification: 'STATE_CONFLICT' }
  }
  if (evidence.stale) {
    return { valid: false, reason: 'stale campaign evidence', classification: 'STATE_CONFLICT' }
  }
  if (evidence.unavailable) {
    return { valid: false, reason: 'required campaign evidence unavailable', classification: 'BLOCKED_EXTERNAL' }
  }

  const campaignResult = campaignBoundarySchema.safeParse(campaignInput)
  if (!campaignResult.success) {
    return { valid: false, reason: 'campaign evidence root must be a mapping', classification: 'STATE_CONFLICT' }
  }

  const slicesResult = slicesSchema.safeParse(campaignResult.data.slices)
  if (slicesResult.success && Object.hasOwn(evidence, 'approvedBaseMergedCommits')) {
    const approvedCommitsResult = approvedBaseMergedCommitsSchema.safeParse(evidence.approvedBaseMergedCommits)
    for (const key of Object.keys(slicesResult.data).sort((left, right) => Number(left) - Number(right))) {
    const sliceResult = sliceSchema.safeParse(slicesResult.data[key])
      if (!sliceResult.success || sliceResult.data.status !== 'DONE') continue
      const mergedCommit = sliceResult.data.merged_commit
      const proof =
        approvedCommitsResult.success && typeof mergedCommit === 'string'
          ? approvedCommitsResult.data[mergedCommit]
          : undefined
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

export function validateCampaign(campaignInput: unknown, optionsInput: unknown = {}): CampaignValidationResult {
  const parsed = campaignBoundarySchema.safeParse(campaignInput)
  if (!parsed.success) {
    return boundaryFailure(campaignInput, optionsInput, parsed.error.issues[0]?.path ?? [])
  }
  const campaign: CampaignInput = parsed.data

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
  if (!lifecycle.ok) return { valid: false, reason: normalizationReason(lifecycle), campaign: null }

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
  if (authority.valid !== true) return { valid: false, reason: validationReason(authority), campaign: null }

  const optionsResult = campaignOptionsSchema.safeParse(optionsInput)
  if (!optionsResult.success) {
    return { valid: false, reason: 'campaign validation options must be a mapping', campaign: null }
  }
  const evidenceInput = optionsResult.data.evidence ?? null

  const expansionAuthority = validateExpansionAuthority(
    campaign.campaign_expansion_authority,
    evidenceInput,
  )
  if (expansionAuthority.valid !== true) {
    return {
      valid: false,
      code: expansionAuthority.code,
      reason: expansionAuthority.reason,
      classification: expansionAuthority.classification,
      campaign: null,
    }
  }

  const blockers = validateCampaignBlockers(campaign.campaign_blockers)
  if (blockers.valid !== true) return { valid: false, reason: validationReason(blockers), campaign: null }

  const slices = validateSlices(campaign.slices, blockers.ids, expansionAuthority)
  if (slices.valid !== true) return {
    valid: false,
    code: slices.code,
    reason: validationReason(slices),
    classification: slices.classification ?? 'STATE_CONFLICT',
    campaign: null,
  }

  const rootScriptMap = validateRootScriptMap(campaign.root_script_map, expansionAuthority)
  if (rootScriptMap.valid !== true) return {
    valid: false,
    code: rootScriptMap.code,
    reason: validationReason(rootScriptMap),
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

  const evidence = validateCampaignEvidence(normalized, evidenceInput)
  if (evidence.valid !== true) {
    return {
      valid: false,
      reason: validationReason(evidence),
      classification: evidence.classification,
      campaign: null,
    }
  }

  return { valid: true, campaign: normalized }
}
