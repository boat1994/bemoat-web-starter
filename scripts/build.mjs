#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const BUILD_WRAPPER_PATH = 'scripts/build.mjs'
export const BUILD_CONTEXT_ENV = 'BEMOAT_BUILD_CONTEXT'
export const OPENNEXT_NEXT_BUILD_CONTEXT = 'opennext-next-build'

export function resolveBuildScript(env = process.env) {
  if (env[BUILD_CONTEXT_ENV] === OPENNEXT_NEXT_BUILD_CONTEXT) {
    return 'build:next'
  }

  return 'build:cloudflare'
}

export function runBuildScript(scriptName, { spawn = spawnSync, env = process.env } = {}) {
  const result = spawn('pnpm', ['run', scriptName], {
    stdio: 'inherit',
    env,
  })

  return result.status ?? 1
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main() {
  const scriptName = resolveBuildScript()
  process.exit(runBuildScript(scriptName))
}

if (isDirectExecution()) main()
