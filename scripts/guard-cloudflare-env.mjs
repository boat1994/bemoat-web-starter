#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { main } from './guards/cloudflare-env.mjs'

export {
  PRODUCTION_ENV_ERROR,
  assertCloudflareEnvNotProduction,
  collectD1DatabaseIds,
  collectR2BucketNames,
  formatCloudflareDeployGuardViolations,
  getCloudflareDeployGuardExitCode,
  isWranglerPlaceholderId,
  parseWranglerJsonc,
  runCloudflareDeployGuard,
  scanWranglerEnvironmentIsolation,
  stripJsoncComments,
} from './guards/cloudflare-env.mjs'

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

if (isDirectExecution()) main()
