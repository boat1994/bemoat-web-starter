import { analyzeExactHeadCi, normalizeStatusChecks, isCheckSuccessful } from '../../agent-issue/exact-head-ci.mjs'

type PullRequestInput = {
  headRefOid?: unknown
  statusCheckRollup?: unknown
}

type StatusCheck = {
  name?: unknown
  context?: unknown
}

type ExactHeadAnalysis = {
  exactHeadVerified: boolean
  summary: string
}

export type ExactHeadCiClassification = {
  valid: boolean
  analysis: ExactHeadAnalysis
  missing: string[]
  reason: string | null
}

export function classifyRequiredExactHeadCi(
  pr: PullRequestInput | null | undefined,
  requiredChecks: string[] = ['ci'],
): ExactHeadCiClassification {
  const analysis: ExactHeadAnalysis = analyzeExactHeadCi(pr)
  if (!analysis.exactHeadVerified) {
    return {
      valid: false,
      analysis,
      missing: [],
      reason: `required exact-head CI is not successful: ${analysis.summary}`,
    }
  }

  const checks: StatusCheck[] = normalizeStatusChecks(pr?.statusCheckRollup)
  const successfulNames = new Set(
    checks.filter(isCheckSuccessful).map((check) => check.name ?? check.context),
  )
  const missing = requiredChecks.filter((name) => !successfulNames.has(name))
  return {
    valid: missing.length === 0,
    analysis,
    missing,
    reason: missing.length > 0
      ? `required exact-head CI checks are missing or unsuccessful: ${missing.join(', ')}`
      : null,
  }
}
