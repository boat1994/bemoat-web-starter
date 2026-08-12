import { z } from 'zod'

const optionalString = z.string().nullable().optional()
const optionalNumber = z.number().nullable().optional()
const optionalBoolean = z.boolean().nullable().optional()
const optionalStringArray = z.array(z.string()).nullable().optional()
const unconstrainedJson = z.json().nullable().optional()

export const architectureAuthoritySchema = z.looseObject({
  issue: optionalString,
  comment_id: optionalString,
  target_contract_path: optionalString,
})

export const blockerEvidenceSchema = z.looseObject({
  issue: optionalString,
  pr: optionalString,
  comment_ids: optionalStringArray,
})

export const campaignBlockerSchema = z.looseObject({
  id: optionalString,
  summary: optionalString,
  evidence: blockerEvidenceSchema.nullable().optional(),
  resolution_scope: optionalString,
})

export const campaignBlockersSchema = z.array(campaignBlockerSchema)

export const sliceSchema = z.looseObject({
  status: optionalString,
  issue: optionalString,
  pr: optionalString,
  reviewed_head: optionalString,
  merged_commit: optionalString,
  authority_comment_ids: optionalStringArray,
  blocker_ids: optionalStringArray,
})

/** Dynamic slice keys are shape-checked here; each record is checked by sliceSchema. */
export const slicesSchema = z.record(z.string(), sliceSchema)

export const rootScriptMapSchema = z.looseObject({
  contract_path: optionalString,
  validation_status: optionalString,
})

export const rootScriptMappingRecordSchema = z.looseObject({
  path: optionalString,
  facade_disposition: optionalString,
  internal_destination: optionalString,
  owning_slice: optionalNumber,
  migration_status: optionalString,
})

const campaignExpansionAuthoritySourceSchema = z.looseObject({
  kind: optionalString,
  repository: optionalString,
  issue: optionalString,
  comment_id: optionalString,
  author_login: optionalString,
  body_sha256: optionalString,
})

const campaignExpansionAuthorityMappingSchema = z.looseObject({
  schema_version: optionalNumber,
  decision: optionalString,
  scope: optionalString,
  action: optionalString,
  source: campaignExpansionAuthoritySourceSchema.nullable().optional(),
  approved_base: optionalString,
  policy_version: optionalString,
  legacy_max_slice: optionalNumber,
  append_only: optionalBoolean,
  protected_base_sha: optionalString,
  authorized_max_slice: optionalNumber,
  authorized_append_keys: optionalStringArray,
  related_authority_comment_ids: optionalStringArray,
})

export const campaignExpansionAuthoritySchema = campaignExpansionAuthorityMappingSchema.nullable().optional()

const campaignAuthorityCommentUserSchema = z.looseObject({
  login: optionalString,
})

const campaignAuthorityCommentSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).nullable().optional(),
  body: optionalString,
  issue_url: optionalString,
  issue_url_html: optionalString,
  user: campaignAuthorityCommentUserSchema.nullable().optional(),
  author_login: optionalString,
})

const campaignExpansionAuthorityEvidenceEnvelopeSchema = z.looseObject({
  comments: z.array(campaignAuthorityCommentSchema).nullable().optional(),
  comment: campaignAuthorityCommentSchema.nullable().optional(),
  trustedFounderLogins: z.array(z.string()).nullable().optional(),
  currentProtectedBaseSha: optionalString,
  // Canonical behavior treats only the literal true as active; other JSON values
  // are therefore intentionally preserved for semantic evaluation.
  contradictory: unconstrainedJson,
  superseded: unconstrainedJson,
})

/** External evidence used by the authority domain validator. */
export const campaignAuthorityEvidenceSchema = z.looseObject({
  campaignExpansionAuthority: campaignExpansionAuthorityEvidenceEnvelopeSchema.nullable().optional(),
}).nullable().optional()

export const campaignEvidenceSchema = z.looseObject({
  approvedBaseMergedCommits: z.record(z.string(), z.boolean()).nullable().optional(),
  campaignExpansionAuthority: unconstrainedJson,
  // These flags are truthiness-based in the existing public contract.
  contradictory: unconstrainedJson,
  stale: unconstrainedJson,
  unavailable: unconstrainedJson,
})

export const campaignOptionsSchema = z.looseObject({
  evidence: z.json().nullable().optional(),
})

/** Named campaign fields are shape-owned here; semantic field validation remains in the domain functions. */
export const campaignBoundarySchema = z.looseObject({
  schema_version: optionalNumber,
  campaign_lifecycle: optionalString,
  campaign_issue: optionalString,
  approved_base: optionalString,
  next_permitted_action: optionalString,
  updated_at: optionalString,
  updated_by: optionalString,
  architecture_authority: architectureAuthoritySchema.nullable().optional(),
  campaign_expansion_authority: campaignExpansionAuthoritySchema,
  campaign_blockers: campaignBlockersSchema.nullable().optional(),
  slices: slicesSchema.nullable().optional(),
  root_script_map: rootScriptMapSchema.nullable().optional(),
})

export const approvedBaseMergedCommitsSchema = z.record(z.string(), z.boolean())

export type ArchitectureAuthority = z.infer<typeof architectureAuthoritySchema>
export type BlockerEvidence = z.infer<typeof blockerEvidenceSchema>
export type CampaignBlocker = z.infer<typeof campaignBlockerSchema>
export type CampaignEvidence = z.infer<typeof campaignEvidenceSchema>
export type CampaignExpansionAuthorityInput = z.infer<typeof campaignExpansionAuthoritySchema>
export type CampaignInput = z.infer<typeof campaignBoundarySchema>
export type CampaignOptions = z.infer<typeof campaignOptionsSchema>
export type RootScriptMap = z.infer<typeof rootScriptMapSchema>
export type RootScriptMappingRecord = z.infer<typeof rootScriptMappingRecordSchema>
export type Slice = z.infer<typeof sliceSchema>
export type Slices = z.infer<typeof slicesSchema>
