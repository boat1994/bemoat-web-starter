import { createHash } from 'node:crypto'

import {
  CAMPAIGN_EXPANSION_POLICY_VERSION,
  LEGACY_MAX_SLICE,
  expectedSliceKeys,
} from './campaign-authority.ts'
import { blockedExternal, stateConflict } from './merge-errors.ts'

const BLOCKER_RESOLUTION_MAX_SLICE = 11

type Mapping = Record<string, unknown>

function isMapping(value: unknown): value is Mapping {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function field(value: unknown, key: string): unknown {
  return isMapping(value) ? value[key] : undefined
}

export function deriveCampaignExpansionAuthority(
  repo: string,
  campaignIssue: string | number,
  evidence: unknown,
): Mapping {
  const envelope = field(evidence, 'campaignExpansionAuthority')
  const comments = field(envelope, 'comments')
  if (!Array.isArray(comments)) {
    throw blockedExternal('live campaign expansion authority evidence is unavailable')
  }
  const source = comments.find((comment) =>
    /CAMPAIGN EXPANSION/i.test(String(field(comment, 'body') ?? '')) &&
    /APPEND SLICES/i.test(String(field(comment, 'body') ?? '')),
  )
  const sourceLogin = field(field(source, 'user'), 'login')
  const sourceBody = field(source, 'body')
  if (!source || !sourceLogin || !sourceBody) {
    throw blockedExternal('Founder campaign expansion authority comment is unavailable')
  }
  const range = String(sourceBody).match(/APPEND SLICES\s+(\d+)\s*[–-]\s*(\d+)/i)
  const startSlice = Number(range?.[1])
  const authorizedMaxSlice = Number(range?.[2])
  if (
    startSlice !== LEGACY_MAX_SLICE + 1 ||
    authorizedMaxSlice !== BLOCKER_RESOLUTION_MAX_SLICE
  ) {
    throw stateConflict('Founder campaign expansion authority does not bind the contiguous approved range')
  }
  const relatedAuthorityCommentIds = comments
    .filter((comment) => /FOUNDER_(?:DIRECTIVE|ARCHITECTURE_DIRECTIVE)/i.test(String(field(comment, 'body') ?? '')))
    .map((comment) => String(field(comment, 'id')))
    .filter((id) => /^[1-9]\d*$/.test(id))
  if (relatedAuthorityCommentIds.length === 0) {
    throw blockedExternal('related Founder campaign expansion authority comments are unavailable')
  }
  return {
    schema_version: 1,
    decision: 'APPROVED',
    scope: 'campaign_slice_range',
    action: 'append_only_expand',
    source: {
      kind: 'github_issue_comment',
      repository: repo,
      issue: `#${campaignIssue}`,
      comment_id: String(field(source, 'id')),
      author_login: sourceLogin,
      body_sha256: createHash('sha256').update(String(sourceBody), 'utf8').digest('hex'),
    },
    approved_base: 'main',
    protected_base_sha: String(field(envelope, 'currentProtectedBaseSha')).toLowerCase(),
    policy_version: CAMPAIGN_EXPANSION_POLICY_VERSION,
    legacy_max_slice: LEGACY_MAX_SLICE,
    authorized_max_slice: authorizedMaxSlice,
    authorized_append_keys: expectedSliceKeys(authorizedMaxSlice).slice(LEGACY_MAX_SLICE),
    append_only: true,
    related_authority_comment_ids: relatedAuthorityCommentIds,
  }
}
