import { classifyRequiredExactHeadCi } from './merge-exact-head-ci.ts'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const STARTER_REPOSITORY = 'boat1994/bemoat-web-starter'

type ManagedState = {
  approved_base?: unknown
  current_head?: unknown
  last_reviewed_head?: unknown
  guide_source_sha?: unknown
}

type PullRequest = {
  baseRefName?: unknown
  baseRefOid?: unknown
  headRefOid?: unknown
  statusCheckRollup?: unknown
}

type FounderAuthorization = {
  policy_source_sha?: unknown
  protected_base_sha?: unknown
  reviewed_head?: unknown
}

export type HeadBindingsClassification = {
  valid: boolean
  reviewedHead: unknown
  reason: string | null
}

export function classifyHeadBindings(
  state: ManagedState | null | undefined,
  pr: PullRequest | null | undefined,
  authorization: FounderAuthorization | null | undefined,
  repo: unknown,
): HeadBindingsClassification {
  const reviewedHead = state?.last_reviewed_head
  if (!state?.approved_base || pr!.baseRefName !== state.approved_base) {
    return {
      valid: false,
      reviewedHead,
      reason: 'live PR base differs from the managed protected base',
    }
  }
  if (!reviewedHead || state.current_head !== reviewedHead || pr!.headRefOid !== reviewedHead) {
    return {
      valid: false,
      reviewedHead,
      reason: 'current, reviewed, and live PR heads must match exactly',
    }
  }
  if (!FULL_SHA_RE.test(String(state?.guide_source_sha)) || authorization!.policy_source_sha !== state.guide_source_sha) {
    return {
      valid: false,
      reviewedHead,
      reason: 'merged policy source SHA does not match the managed policy evidence',
    }
  }
  if (!FULL_SHA_RE.test(String(pr?.baseRefOid)) || authorization!.protected_base_sha !== pr!.baseRefOid) {
    return {
      valid: false,
      reviewedHead,
      reason: 'protected base commit SHA does not match the live PR base evidence',
    }
  }
  if (authorization!.reviewed_head !== reviewedHead) {
    return {
      valid: false,
      reviewedHead,
      reason: 'Founder authorization reviewed head differs from managed/live head',
    }
  }

  const requiredChecks = repo === STARTER_REPOSITORY ? ['ci', 'starter-ci'] : ['ci']
  const ciClassification = classifyRequiredExactHeadCi(pr, requiredChecks)
  if (!ciClassification.valid) {
    return {
      valid: false,
      reviewedHead,
      reason: ciClassification.reason,
    }
  }

  return { valid: true, reviewedHead, reason: null }
}
