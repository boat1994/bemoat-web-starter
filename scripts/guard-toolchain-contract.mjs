#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export * from './guards/toolchain-contract.mjs'
import {
  formatToolchainContractViolations,
  getToolchainContractExitCode,
  scanToolchainContract,
} from './guards/toolchain-contract.mjs'

export function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

if (isDirectExecution()) {
  const violations = scanToolchainContract()
  for (const line of formatToolchainContractViolations(violations)) console.log(line)
  process.exit(getToolchainContractExitCode(violations))
}
