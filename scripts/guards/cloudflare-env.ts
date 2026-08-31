#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from '../cli/command-help.ts'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
  type ParsedInvocation,
} from '../cli/command-invocation.ts'
import type { GuardViolation, ReadTextFile, WranglerBinding, WranglerConfig } from './types.ts'

export const PRODUCTION_ENV_ERROR =
  'Do not use CLOUDFLARE_ENV=production. Production deploy uses top-level wrangler.jsonc without --env. Run `pnpm run deploy` instead.'

/** Placeholder D1 IDs in starter templates — not compared for prod/dev isolation. */
export function isWranglerPlaceholderId(value: string | null | undefined): boolean {
  if (!value) return true
  const normalized = value.trim()
  if (/^(?:DEV_)?DATABASE_ID$/i.test(normalized)) return true
  if (/^<[^>]+>$/.test(normalized)) return true
  if (/^YOUR_[A-Z0-9_]+$/i.test(normalized)) return true
  return false
}

export function stripJsoncComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
}

export function parseWranglerJsonc(content: string): WranglerConfig {
  return JSON.parse(stripJsoncComments(content)) as WranglerConfig
}

export function collectD1DatabaseIds(d1Databases: WranglerBinding[] = []): string[] {
  return d1Databases
    .map((entry) => entry?.database_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export function collectR2BucketNames(r2Buckets: WranglerBinding[] = []): Set<string> {
  const names = new Set<string>()

  for (const entry of r2Buckets) {
    if (typeof entry?.bucket_name === 'string' && entry.bucket_name.length > 0) {
      names.add(entry.bucket_name)
    }
    if (typeof entry?.preview_bucket_name === 'string' && entry.preview_bucket_name.length > 0) {
      names.add(entry.preview_bucket_name)
    }
  }

  return names
}

export function assertCloudflareEnvNotProduction(cloudflareEnv = process.env.CLOUDFLARE_ENV): GuardViolation[] {
  if (cloudflareEnv === 'production') {
    return [
      {
        type: 'cloudflare-env',
        file: 'process.env',
        rule: 'no-production-env',
        message: PRODUCTION_ENV_ERROR,
      },
    ]
  }

  return []
}

export function scanWranglerEnvironmentIsolation(content: string, file = 'wrangler.jsonc'): GuardViolation[] {
  const violations: GuardViolation[] = []

  let config: WranglerConfig
  try {
    config = parseWranglerJsonc(content)
  } catch (error) {
    return [
      {
        type: 'wrangler-config',
        file,
        rule: 'invalid-jsonc',
        message: `Could not parse wrangler.jsonc: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]
  }

  if (config.env?.production) {
    violations.push({
      type: 'wrangler-config',
      file,
      rule: 'no-env-production',
      message:
        'wrangler.jsonc must not define env.production. Production uses the top-level config without --env.',
    })
  }

  const devEnv = config.env?.dev
  if (!devEnv) return violations

  const productionD1Ids = new Set(
    collectD1DatabaseIds(config.d1_databases).filter((id) => !isWranglerPlaceholderId(id)),
  )
  const devD1Ids = collectD1DatabaseIds(devEnv.d1_databases).filter((id) => !isWranglerPlaceholderId(id))

  for (const devId of devD1Ids) {
    if (productionD1Ids.has(devId)) {
      violations.push({
        type: 'wrangler-config',
        file,
        rule: 'dev-d1-isolated',
        message: `env.dev D1 database_id must not match production (${devId})`,
      })
    }
  }

  const productionR2 = collectR2BucketNames(config.r2_buckets)
  const devR2 = collectR2BucketNames(devEnv.r2_buckets)

  for (const bucketName of devR2) {
    if (productionR2.has(bucketName)) {
      violations.push({
        type: 'wrangler-config',
        file,
        rule: 'dev-r2-isolated',
        message: `env.dev R2 bucket must not match production (${bucketName})`,
      })
    }
  }

  return violations
}

export function runCloudflareDeployGuard({
  root = process.cwd(),
  cloudflareEnv = process.env.CLOUDFLARE_ENV,
  readFile = (filePath: string) => readFileSync(filePath, 'utf8'),
}: {
  root?: string
  cloudflareEnv?: string
  readFile?: ReadTextFile
} = {}): GuardViolation[] {
  const violations = [...assertCloudflareEnvNotProduction(cloudflareEnv)]

  const wranglerPath = resolve(root, 'wrangler.jsonc')
  try {
    const content = readFile(wranglerPath)
    violations.push(...scanWranglerEnvironmentIsolation(content))
  } catch {
    // Missing wrangler.jsonc is allowed outside Cloudflare projects.
  }

  return violations
}

export function getCloudflareDeployGuardExitCode(violations: readonly unknown[]): number {
  return violations.length > 0 ? 1 : 0
}

export function formatCloudflareDeployGuardViolations(violations: GuardViolation[]): string[] {
  if (violations.length === 0) {
    return ['Cloudflare deploy guard passed.']
  }

  const lines = ['Cloudflare deploy guard failed:', '']

  for (const violation of violations) {
    lines.push(`- [${violation.rule}] ${violation.message}`)
  }

  lines.push('')
  lines.push('See docs/cloudflare-environments.md.')

  return lines
}

export function isDirectExecution(callerModuleUrl = import.meta.url): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return callerModuleUrl === pathToFileURL(resolve(entrypoint)).href
}

function renderHelp(invocation: ParsedInvocation): void {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
}

function handleInvocationError(error: unknown): boolean {
  if (!(error instanceof CliInvocationError)) return false

  process.stderr.write(`INVALID_INVOCATION: ${error.details.reason}\n`)
  process.exitCode = error.exit_code
  return true
}

function resolveCloudflareGuardCommand() {
  const lifecycleEvent = process.env.npm_lifecycle_event
  const isRawAlias = lifecycleEvent === 'guard:cloudflare-env'
  const isUnrelatedLifecycle = lifecycleEvent && !lifecycleEvent.startsWith('bemoat:')
  const env = isRawAlias || isUnrelatedLifecycle
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env

  return resolveCommandIdentity({
    fallback: 'bemoat:guard:cloudflare-env',
    env,
    entrypoint: 'scripts/guard-cloudflare-env.ts',
  })
}

export function main(): void {
  let invocation: ParsedInvocation

  try {
    const command = resolveCloudflareGuardCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))
  } catch (error) {
    if (handleInvocationError(error)) return
    throw error
  }

  if (invocation.mode === 'help') {
    renderHelp(invocation)
    return
  }

  const violations = runCloudflareDeployGuard()
  const lines = formatCloudflareDeployGuardViolations(violations)

  for (const line of lines) console.log(line)

  process.exitCode = getCloudflareDeployGuardExitCode(violations)
}

if (isDirectExecution()) main()
