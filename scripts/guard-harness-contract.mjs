#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export {
  CHILD_FACING_HARNESS_PATHS,
  FORBIDDEN_RAW_SCRIPTS,
  extractPnpmRunScripts,
  findForbiddenRawScriptCalls,
  scanChildFacingHarnessFile,
  runHarnessContractGuard,
  getHarnessContractExitCode,
  formatHarnessContractViolations,
} from './harness-contract/child-script-policy.mjs'

export { parseRuntimeImportSpecifiers } from './harness-contract/runtime-import-parser.mjs'

export {
  MANAGED_RUNTIME_ROOT_PREFIX,
  ManagedRuntimeDeliveryClosureError,
  isManagedPath,
  isBuiltinOrPackageSpecifier,
  resolveRelativeRuntimeCallee,
  collectManagedRuntimeScriptRoots,
  collectExplicitManagedRuntimeScriptPaths,
  scanManagedRuntimeDeliveryClosure,
  formatManagedRuntimeDeliveryViolations,
  assertManagedRuntimeDeliveryClosure,
} from './harness-contract/managed-runtime-closure.mjs'

export { loadManagedPathsFromManifest } from './harness-contract/manifest.mjs'

import {
  runHarnessContractGuard,
  getHarnessContractExitCode,
  formatHarnessContractViolations,
} from './harness-contract/child-script-policy.mjs'
import {
  scanManagedRuntimeDeliveryClosure,
  formatManagedRuntimeDeliveryViolations,
} from './harness-contract/managed-runtime-closure.mjs'
import { loadManagedPathsFromManifest } from './harness-contract/manifest.mjs'

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const root = process.cwd()
  const childFacingViolations = runHarnessContractGuard({ root })
  const managedPaths = loadManagedPathsFromManifest(root)
  const runtimeViolations = managedPaths
    ? scanManagedRuntimeDeliveryClosure({ root, managedPaths })
    : []

  const lines =
    runtimeViolations.length > 0
      ? formatManagedRuntimeDeliveryViolations(runtimeViolations)
      : formatHarnessContractViolations(childFacingViolations)

  for (const line of lines) console.log(line)

  const exitCode =
    runtimeViolations.length > 0
      ? 1
      : getHarnessContractExitCode(childFacingViolations)

  process.exit(exitCode)
}

if (isDirectExecution()) main()
