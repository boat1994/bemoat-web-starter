#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { createHelpEnvelopeV1, formatTextHelp } from './cli/command-help.ts'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from './cli/command-invocation.ts'
import { parseSyncMode, SYNC_MODES } from './sync-boilerplate.mjs'
import {
  compareBoilerplateDrift,
  compareBoilerplateDriftByMode,
  compareFullBoilerplateDrift,
  compareMergeKeepDrift,
  comparePackageProposalDrift,
  compareSeedOnlyDrift,
  compareToolchainContractDrift,
  getDriftExitCode,
  stripJsoncComments,
} from './boilerplate/workflows/check-boilerplate-drift.mjs'

export {
  compareBoilerplateDrift,
  compareBoilerplateDriftByMode,
  compareFullBoilerplateDrift,
  compareMergeKeepDrift,
  comparePackageProposalDrift,
  compareSeedOnlyDrift,
  compareToolchainContractDrift,
  getDriftExitCode,
  stripJsoncComments,
}
export { SYNC_MODES }

const repo = process.env.BEMOAT_BOILERPLATE_REPO || 'boat1994/bemoat-web-starter'
const ref = process.env.BEMOAT_BOILERPLATE_REF || 'main'
const targetRoot = process.cwd()
const tempRoot = resolve(targetRoot, '.bemoat-check-tmp')
const sourceRoot = join(tempRoot, 'source')

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isGitRepositoryRoot(cwd) {
  try {
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

    return resolve(topLevel) === resolve(cwd)
  } catch {
    return false
  }
}

function getGitOriginRepo(cwd) {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

  return remote
    .replace(/\.git$/, '')
    .replace(/^git@github.com:/, 'https://github.com/')
    .replace(/^https:\/\/github.com\//, '')
    .toLowerCase()
}

export function isBoilerplateSourceRepository(cwd = process.cwd(), boilerplateRepo = repo) {
  const packagePath = join(cwd, 'package.json')
  if (!existsSync(packagePath)) return false

  try {
    const pkg = readJSON(packagePath)
    if (pkg.name !== 'bemoat-web-starter') return false
  } catch {
    return false
  }

  if (!isGitRepositoryRoot(cwd)) return true

  try {
    const originRepo = getGitOriginRepo(cwd)
    return originRepo.endsWith(boilerplateRepo.toLowerCase())
  } catch {
    return true
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

function printReport(report) {
  const hasManagedDrift = report.managed.missing.length > 0 || report.managed.changed.length > 0
  const hasMissingSeed = !report.seedOnlyPathsSkipped && report.seed.missingSeed.length > 0
  const hasCustomizedSeed = !report.seedOnlyPathsSkipped && report.seed.customized.length > 0
  const hasMergeKeepDrift = report.mergeKeep.missing.length > 0 || report.mergeKeep.changed.length > 0

  console.log(`Checking boilerplate drift against ${repo}#${ref}`)
  console.log(`Sync mode: ${report.syncMode}`)
  if (report.seedOnlyPathsSkipped) console.log('Seed-only starter modules skipped in harness-only mode')
  console.log('')

  if (!hasManagedDrift && !hasMissingSeed && !hasCustomizedSeed && !hasMergeKeepDrift && !report.packageProposal) {
    console.log('No drift found.')
    console.log(`Identical managed paths: ${report.managed.identical.length}`)
    if (!report.seedOnlyPathsSkipped) console.log(`Identical seed files: ${report.seed.identical.length}`)
    return
  }

  const managedDrift = [...report.managed.missing, ...report.managed.changed]
  if (managedDrift.length > 0) {
    console.log('Managed drift:')
    for (const path of managedDrift) console.log(`- ${path}`)
    console.log('')
  }
  if (hasMissingSeed) {
    console.log('Missing seed files:')
    for (const path of report.seed.missingSeed) console.log(`- ${path}`)
    console.log('')
  }
  if (hasCustomizedSeed) {
    console.log('Customized seed files ignored:')
    for (const path of report.seed.customized) console.log(`- ${path}`)
    console.log('')
  }
  if (hasMergeKeepDrift) {
    console.log('Merge-keep drift (child content preserved; starter adds missing entries):')
    for (const path of [...report.mergeKeep.missing, ...report.mergeKeep.changed]) console.log(`- ${path}`)
    console.log('')
  }
  if (report.packageProposal) {
    console.log('Package sync proposal (informational; package.json is child-owned):')
    console.log('Review script and dependency drift in .bemoat/package-sync-proposal.md (human review only)')
    console.log('')
  }
  if (hasManagedDrift || hasMissingSeed || hasMergeKeepDrift) {
    console.log('Suggested next command:')
    console.log(`pnpm run boilerplate:sync -- --${report.syncMode}`)
    console.log('\nAfter sync, run:')
    console.log('pnpm install')
  }
}

export function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return import.meta.url === pathToFileURL(resolve(entrypoint)).href
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }
  process.stdout.write(formatTextHelp(invocation.contract))
}

function handleInvocationError(error) {
  if (!(error instanceof CliInvocationError)) return false
  process.stderr.write(`INVALID_INVOCATION: ${error.details.reason}\n`)
  process.exitCode = error.exit_code
  return true
}

function resolveBoilerplateCheckCommand() {
  const lifecycleEvent = process.env.npm_lifecycle_event
  const isRawAlias = lifecycleEvent === 'boilerplate:check'
  const isUnrelatedLifecycle = lifecycleEvent && !lifecycleEvent.startsWith('bemoat:')
  const env = isRawAlias || isUnrelatedLifecycle
    ? { ...process.env, npm_lifecycle_event: undefined }
    : process.env

  return resolveCommandIdentity({
    fallback: 'bemoat:boilerplate:check',
    env,
    entrypoint: 'scripts/check-boilerplate-drift.mjs',
  })
}

function main() {
  let invocation
  try {
    const command = resolveBoilerplateCheckCommand()
    invocation = parseCommandInvocation(command, process.argv.slice(2))
  } catch (error) {
    if (handleInvocationError(error)) return
    throw error
  }

  if (invocation.mode === 'help') {
    renderHelp(invocation)
    return
  }
  if (isBoilerplateSourceRepository(targetRoot, repo)) {
    console.log('Skipping boilerplate drift check in bemoat-web-starter (source repository).')
    console.log('This command compares child projects against upstream boilerplate.')
    console.log('In the starter repo, use git diff and CI instead of boilerplate:check.')
    process.exitCode = 0
    return
  }

  const syncMode = parseSyncMode(invocation.values, process.env)
  let exitCode = 0
  try {
    rmSync(tempRoot, { recursive: true, force: true })
    mkdirSync(tempRoot, { recursive: true })
    run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, sourceRoot], { cwd: targetRoot })
    const report = compareBoilerplateDriftByMode({ sourceRoot, targetRoot, mode: syncMode })
    printReport(report)
    exitCode = getDriftExitCode(report)
  } catch (error) {
    console.error('Unable to fetch or compare boilerplate source.')
    if (error instanceof Error) console.error(error.message)
    exitCode = 2
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
  process.exitCode = exitCode
}

if (isDirectExecution()) main()
