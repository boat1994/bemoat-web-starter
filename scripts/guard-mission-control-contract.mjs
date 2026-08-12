#!/usr/bin/env node

import { isDirectExecution, main } from './guards/mission-control-contract/cli.mjs'

export { isDirectExecution } from './guards/mission-control-contract/cli.mjs'

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

if (isDirectExecution(import.meta.url)) main()
