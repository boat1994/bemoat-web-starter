import { COMMAND_REFERENCE_PATH, README_PATH, LOADER_PATH } from './inventory.mjs'
import { violation } from './violation.mjs'

export const UNMANAGED_GENESIS_REVIEW_COMMAND = 'bemoat:mission-control:unmanaged-genesis-review'
export const UNMANAGED_GENESIS_REVIEW_SCRIPT = 'scripts/mission-control-unmanaged-genesis-review.mjs'
export const UNMANAGED_GENESIS_REVIEW_FLAG = '--founder-authorization-comment-id'

/**
 * Command-discovery scanner for Mission Control package scripts and docs.
 * Keeps the unmanaged-genesis review transport discoverable without inventing
 * managed-state counters.
 */
export function scanCommandDiscovery({
  packageJson = null,
  commandReference = null,
  readme = null,
  loader = null,
} = {}) {
  const violations = []

  if (!packageJson) {
    violations.push(violation('MC014', 'package.json', 'package.json is required for command discovery'))
    return violations
  }

  let pkg
  try {
    pkg = typeof packageJson === 'string' ? JSON.parse(packageJson) : packageJson
  } catch {
    violations.push(violation('MC014', 'package.json', 'package.json could not be parsed'))
    return violations
  }

  const script = pkg?.scripts?.[UNMANAGED_GENESIS_REVIEW_COMMAND]
  if (script !== `node ${UNMANAGED_GENESIS_REVIEW_SCRIPT}`) {
    violations.push(violation(
      'MC014',
      'package.json',
      `${UNMANAGED_GENESIS_REVIEW_COMMAND} must map to node ${UNMANAGED_GENESIS_REVIEW_SCRIPT}`,
    ))
  }

  if (!String(commandReference ?? '').includes(UNMANAGED_GENESIS_REVIEW_COMMAND)) {
    violations.push(violation(
      'MC014',
      COMMAND_REFERENCE_PATH,
      `command reference must document ${UNMANAGED_GENESIS_REVIEW_COMMAND}`,
    ))
  }
  if (!String(commandReference ?? '').includes(UNMANAGED_GENESIS_REVIEW_FLAG)) {
    violations.push(violation(
      'MC014',
      COMMAND_REFERENCE_PATH,
      `command reference must document ${UNMANAGED_GENESIS_REVIEW_FLAG}`,
    ))
  }
  if (!String(readme ?? '').includes(UNMANAGED_GENESIS_REVIEW_COMMAND)) {
    violations.push(violation(
      'MC014',
      README_PATH,
      `README must discover ${UNMANAGED_GENESIS_REVIEW_COMMAND}`,
    ))
  }
  if (!String(loader ?? '').includes('unmanaged-genesis-review')) {
    violations.push(violation(
      'MC014',
      LOADER_PATH,
      'Project loader must mention unmanaged-genesis-review transport',
    ))
  }

  return violations
}
