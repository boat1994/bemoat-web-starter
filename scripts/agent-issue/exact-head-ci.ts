export interface StatusCheck {
  conclusion?: unknown
  state?: unknown
  targetUrl?: unknown
  detailsUrl?: unknown
  description?: unknown
  name?: unknown
  context?: unknown
}

export interface StatusCheckRollupObject {
  contexts?: StatusCheck[]
}

export interface PullRequestCiInput {
  headRefOid?: unknown
  statusCheckRollup?: unknown
}

export interface ExactHeadCiAnalysis {
  available: boolean
  exactHeadVerified: boolean
  headSha: unknown
  ciSha: unknown
  summary: string
  olderShaSuccess?: boolean
}

export function normalizeStatusChecks(statusCheckRollup: unknown): StatusCheck[] {
  if (!statusCheckRollup) return []
  if (Array.isArray(statusCheckRollup)) return statusCheckRollup as StatusCheck[]
  if (
    typeof statusCheckRollup === 'object' &&
    statusCheckRollup !== null &&
    'contexts' in statusCheckRollup &&
    Array.isArray(statusCheckRollup.contexts)
  ) {
    return statusCheckRollup.contexts as StatusCheck[]
  }
  return []
}

export function isCheckSuccessful(check: StatusCheck | null | undefined): boolean {
  if (!check) return false
  if (check.conclusion === 'SUCCESS') return true
  if (check.state === 'SUCCESS') return true
  return false
}

export function isCheckFailed(check: StatusCheck | null | undefined): boolean {
  if (!check) return false
  if (check.conclusion === 'FAILURE' || check.conclusion === 'CANCELLED') return true
  if (check.state === 'FAILURE') return true
  return false
}

export function checkReferencesHeadSha(check: StatusCheck | null | undefined, headSha: string): boolean {
  if (!check || !headSha) return false
  const headShort = headSha.slice(0, 7)
  const haystack = [
    check.targetUrl,
    check.detailsUrl,
    check.description,
    check.name,
    check.context,
  ]
    .filter(Boolean)
    .join(' ')

  return haystack.includes(headSha) || haystack.includes(headShort)
}

export function analyzeExactHeadCi(pr: PullRequestCiInput | null | undefined): ExactHeadCiAnalysis {
  if (!pr) {
    return {
      available: false,
      exactHeadVerified: false,
      headSha: null,
      ciSha: null,
      summary: 'PR evidence unavailable.',
    }
  }

  const headSha = pr.headRefOid ?? null
  const checks = normalizeStatusChecks(pr.statusCheckRollup)
  const successfulChecks = checks.filter(isCheckSuccessful)
  const failedChecks = checks.filter(isCheckFailed)
  const latestSuccessful = successfulChecks[0] ?? null
  const usesProductionRollup = Array.isArray(pr.statusCheckRollup)

  if (!headSha) {
    return {
      available: false,
      exactHeadVerified: false,
      headSha: null,
      ciSha: null,
      summary: 'Current PR head SHA could not be determined.',
    }
  }

  if (checks.length === 0) {
    return {
      available: true,
      exactHeadVerified: false,
      headSha,
      ciSha: null,
      summary: 'No CI checks reported for the active PR.',
      olderShaSuccess: false,
    }
  }

  // @ts-expect-error legacy preserves native TypeError for non-string truthy headRefOid
  const headShort = headSha.slice(0, 7)
  const explicitHeadMatch = successfulChecks.some((check) =>
    // @ts-expect-error legacy passes headSha through without string coercion
    checkReferencesHeadSha(check, headSha),
  )
  const explicitOlderShaSuccess = successfulChecks.some(
    (check) =>
      // @ts-expect-error legacy passes headSha through without string coercion
      !checkReferencesHeadSha(check, headSha),
  )
  const anySuccess = successfulChecks.length > 0

  // gh pr view returns statusCheckRollup as an array scoped to the current PR head.
  const exactHeadSuccess =
    failedChecks.length === 0 &&
    anySuccess &&
    (usesProductionRollup || explicitHeadMatch)

  const description = latestSuccessful?.description
  const ciSha =
    (description == null
      ? undefined
      : // @ts-expect-error legacy optional-call semantics invoke .match on non-nullish description
        description.match(/\b[a-f0-9]{7,40}\b/i)?.[0]) ?? headSha

  return {
    available: true,
    exactHeadVerified: exactHeadSuccess,
    headSha,
    ciSha,
    summary: exactHeadSuccess
      ? `Exact-head CI verified for ${headShort} (${successfulChecks.length} successful check(s)).`
      : failedChecks.length > 0
        ? 'CI checks failed for the current PR head.'
        : anySuccess
          ? 'Successful CI exists, but exact-head verification is not confirmed for the current PR head SHA.'
          : 'CI has not succeeded for the current PR head.',
    olderShaSuccess: anySuccess && !exactHeadSuccess && explicitOlderShaSuccess,
  }
}
