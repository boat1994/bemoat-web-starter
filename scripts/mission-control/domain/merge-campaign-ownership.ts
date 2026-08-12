import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

import { CAMPAIGN_PROJECTION_KINDS } from './merge-campaign-projection.ts'

const OWNERSHIP_EVIDENCE_KINDS = new Set(['campaign-projection', 'task-ownership-registry'])

type Mapping = Record<string, unknown>
type CampaignRoute = {
  projectionKind: string
  campaignIssue: number | null
  campaignSlice: number | null
  blockerBinding?: { campaignBlockerId?: string | null } | null
}
type OwnershipClassification =
  | { valid: false; ownership: null; reason: string }
  | { valid: true; ownership: Mapping; reason: null }

function normalizeIssueNumber(value: unknown): number | null {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value: unknown): number | null {
  return resolvePrNumber(value)
}

function invalid(reason: string): { valid: false; ownership: null; reason: string } {
  return { valid: false, ownership: null, reason }
}

function isMapping(value: unknown): value is Mapping {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function field(value: Mapping, key: string): unknown {
  return value[key]
}

export function classifyCampaignOwnershipEvidence({
  ownership,
  route,
  issueNumber,
  prNumber,
}: {
  ownership: unknown
  route: CampaignRoute
  issueNumber: number
  prNumber: number
}): OwnershipClassification {
  if (!isMapping(ownership) || field(ownership, 'verified') !== true) {
    return invalid('campaign merge route requires verified durable ownership evidence')
  }
  const ownershipKindValue = field(ownership, 'projectionKind') ?? field(ownership, 'projection_kind')
  const ownershipKind = typeof ownershipKindValue === 'string' ? ownershipKindValue : null
  if (ownershipKind !== route.projectionKind) {
    return invalid('campaign ownership evidence projection kind differs from authorization')
  }
  if (normalizeIssueNumber(field(ownership, 'campaignIssue')) !== route.campaignIssue) {
    return invalid('campaign ownership evidence campaign Issue differs from managed state')
  }
  if (normalizeIssueNumber(field(ownership, 'taskIssue')) !== issueNumber ||
    normalizePrNumber(field(ownership, 'prNumber') ?? field(ownership, 'pr')) !== prNumber) {
    return invalid('campaign ownership evidence does not bind the exact task and PR')
  }
  if (ownershipKind === CAMPAIGN_PROJECTION_KINDS.SLICE) {
    if (Number(field(ownership, 'campaignSlice')) !== route.campaignSlice) {
      return invalid('campaign ownership evidence slice differs from managed state')
    }
  } else if (field(ownership, 'campaignBlockerId') !== route.blockerBinding?.campaignBlockerId) {
    return invalid('campaign ownership evidence blocker differs from authorization')
  }
  const evidenceKind = field(ownership, 'evidence_kind')
  if (typeof evidenceKind !== 'string' || !OWNERSHIP_EVIDENCE_KINDS.has(evidenceKind)) {
    return invalid('campaign merge route requires canonical allocation or ownership-registry evidence')
  }
  return { valid: true, ownership, reason: null }
}
