export function getMissionControlContractExitCode(violations) {
  return violations.length > 0 ? 1 : 0
}

export function formatMissionControlContractViolations(violations) {
  if (violations.length === 0) {
    return ['Mission Control contract guard passed.']
  }

  const lines = [
    'Mission Control contract guard failed:',
    '',
    'Fix the violations below, then rerun `pnpm run guard:mission-control-contract` or `pnpm run bemoat:guard:safety`.',
    'See docs/guard-pack.md and docs/mission-control/README.md.',
    '',
  ]

  for (const item of violations) {
    lines.push(`- [${item.rule}] ${item.file}: ${item.message}`)
  }

  return lines
}
