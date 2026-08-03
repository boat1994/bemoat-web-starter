#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { formatMissionControlContractViolations, getMissionControlContractExitCode } from './guards/mission-control-contract/diagnostics.mjs'
import { runMissionControlContractGuard } from './guards/mission-control-contract/runner.mjs'

export * from './guards/mission-control-contract/inventory.mjs'
export { scanModuleContent } from './guards/mission-control-contract/scan-modules.mjs'
export { scanGuideContent } from './guards/mission-control-contract/scan-guide.mjs'
export { scanLoaderContent, scanAgentsPointer } from './guards/mission-control-contract/scan-loader.mjs'
export {
  scanHandoffTemplate,
  scanResultTemplate,
  scanRoleHandoffContract,
} from './guards/mission-control-contract/scan-transport.mjs'
export { scanManagedPathsContract } from './guards/mission-control-contract/managed-paths.mjs'
export { runMissionControlContractGuard } from './guards/mission-control-contract/runner.mjs'
export {
  formatMissionControlContractViolations,
  getMissionControlContractExitCode,
} from './guards/mission-control-contract/diagnostics.mjs'

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runMissionControlContractGuard()
  const lines = formatMissionControlContractViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getMissionControlContractExitCode(violations))
}

if (isDirectExecution()) main()
