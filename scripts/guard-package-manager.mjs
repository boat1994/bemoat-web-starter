#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export * from './guards/package-manager.mjs'
import {
  formatPackageManagerViolations,
  getPackageManagerGuardExitCode,
  runPackageManagerGuard,
} from './guards/package-manager.mjs'

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const violations = runPackageManagerGuard()
  const lines = formatPackageManagerViolations(violations)

  for (const line of lines) console.log(line)

  process.exit(getPackageManagerGuardExitCode(violations))
}

if (isDirectExecution()) main()
