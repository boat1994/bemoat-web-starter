#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const BUILD_WRAPPER_PATH = 'scripts/build.ts'
export const BUILD_CONTEXT_ENV = 'BEMOAT_BUILD_CONTEXT'
export const OPENNEXT_NEXT_BUILD_CONTEXT = 'opennext-next-build'

export function resolveBuildScript(env: NodeJS.ProcessEnv = process.env): string {
  if (env[BUILD_CONTEXT_ENV] === OPENNEXT_NEXT_BUILD_CONTEXT) {
    return 'build:next'
  }

  return 'build:cloudflare'
}

export interface RunBuildScriptOptions {
  spawn?: typeof spawnSync
  env?: NodeJS.ProcessEnv
}

export function runBuildScript(scriptName: string, { spawn = spawnSync, env = process.env }: RunBuildScriptOptions = {}): number {
  const result = spawn('pnpm', ['run', scriptName], {
    stdio: 'inherit',
    env,
  })

  return result.status ?? 1
}

export function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function main(): void {
  const scriptName = resolveBuildScript()
  process.exit(runBuildScript(scriptName))
}

if (isDirectExecution()) main()
