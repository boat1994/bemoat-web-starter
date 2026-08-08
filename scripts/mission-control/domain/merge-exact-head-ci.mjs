import { analyzeExactHeadCi, normalizeStatusChecks, isCheckSuccessful } from '../../agent-issue/exact-head-ci.mjs'

export function classifyRequiredExactHeadCi(pr, requiredChecks = ['ci']) {
  const analysis = analyzeExactHeadCi(pr)
  if (!analysis.exactHeadVerified) {
    return {
      valid: false,
      analysis,
      missing: [],
      reason: `required exact-head CI is not successful: ${analysis.summary}`,
    }
  }

  const checks = normalizeStatusChecks(pr.statusCheckRollup)
  const successfulNames = new Set(checks.filter(isCheckSuccessful).map((check) => check.name ?? check.context))
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
