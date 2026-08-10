#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export * from './guards/build-script-contract.mjs'

import {
  formatBuildScriptContractViolations,
  getBuildScriptContractExitCode,
  runBuildScriptContractGuard,
} from './guards/build-script-contract.mjs'

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runBuildScriptContractGuard()
  const lines = formatBuildScriptContractViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getBuildScriptContractExitCode(violations))
}

if (isDirectExecution()) main()
