#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ENV_EXAMPLE_PATH,
  formatEnvPlaceholderViolations,
  getEnvPlaceholderGuardExitCode,
  parseEnvAssignments,
  runEnvPlaceholderGuard,
  scanEnvExampleContent,
} from './guards/env-placeholder.mjs'
import { main } from './guards/env-placeholder.mjs'

export {
  ENV_EXAMPLE_PATH,
  formatEnvPlaceholderViolations,
  getEnvPlaceholderGuardExitCode,
  parseEnvAssignments,
  runEnvPlaceholderGuard,
  scanEnvExampleContent,
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

if (isDirectExecution()) main()
